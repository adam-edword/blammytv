import { useEffect } from "react";
import { ensureIndex, ensureKitsuIndex, looksAnime, malEpisodeOf, malFilmOf } from "../stream/animemap";
import type { VodItem } from "../stream/model";
import { EPISODE_WATCHED, FILM_WATCHED } from "../stream/watched";
import { describe, malJson, malRequest, malStatus } from "./client";
import { loadMal, MAL_SYNCED, saveMal } from "./store";

/**
 * MyAnimeList, both ways (plan 021):
 * - Out (D1): when an anime episode counts as watched here, its MAL entry's
 *   episode count goes up to it, "watching", or "completed" at the last
 *   episode. Never down. An anime film the same way: its entry has one
 *   episode, so finishing it marks it completed (Adam, v0.10.44).
 * - In (D2 b): your list's counts, read at launch and on coming back after
 *   a while; a series page turns them into ticks (ticks.ts).
 * Nothing runs until MAL is connected.
 */

interface ListPage {
  data?: { node?: { id?: number }; list_status?: { num_episodes_watched?: number } }[];
  paging?: { next?: string };
}

interface AnimeStatus {
  num_episodes?: number;
  my_list_status?: { num_episodes_watched?: number };
}

/** Titles seen playing here this run, for what a tick needs to be placed:
 * whether it is anime, and a series' seasons (One Piece-style numbering
 * counts across them). */
const seen = new Map<string, Pick<VodItem, "genres" | "seasons">>();

export function rememberForMal(item: Pick<VodItem, "id" | "kind" | "genres" | "seasons">): void {
  // A series without its seasons yet is the light copy: keep the full one.
  if (item.kind === "movie" || item.seasons.length) seen.set(item.id, { genres: item.genres, seasons: item.seasons });
}

const isKitsu = (id: string) => id.startsWith("kitsu:");

/** Whether a series is anime enough to look up, and the indexes it needs. */
export async function indexesFor(seriesId: string, item?: Pick<VodItem, "genres">) {
  if (isKitsu(seriesId)) return { imdb: null, kitsu: await ensureKitsuIndex() };
  if (!item || !looksAnime(item)) return null;
  return { imdb: await ensureIndex(), kitsu: null };
}

/** Sends worth trying again later: no answer, MAL busy or down, or its
 * ban page. A plain refusal (no such entry) is not retried. */
const retryable = (status: number) => status === 429 || status === 403 || status >= 500;

function queue(mal: number, ep: number): void {
  const { pending } = loadMal();
  if ((pending[mal] ?? 0) >= ep) return;
  saveMal({ pending: { ...pending, [mal]: ep } });
}

function noteCount(mal: number, n: number): void {
  const { counts } = loadMal();
  if ((counts[mal] ?? 0) >= n) return;
  saveMal({ counts: { ...counts, [mal]: n } });
  window.dispatchEvent(new Event(MAL_SYNCED));
}

/**
 * Move one entry's count up to `ep`, never down. MAL's own copy is read
 * first, so a count raised elsewhere is never lowered from a stale one here.
 * True once it is settled (sent, not needed, or refused for good).
 */
export async function pushProgress(mal: number, ep: number): Promise<boolean> {
  const cur = await malJson<AnimeStatus>("GET", `/anime/${mal}`, { fields: "num_episodes,my_list_status" }).catch(() => null);
  if (!cur || !cur.data) {
    if (!cur || retryable(cur.status)) queue(mal, ep);
    return !!cur && !retryable(cur.status);
  }
  const total = cur.data.num_episodes ?? 0;
  const have = cur.data.my_list_status?.num_episodes_watched ?? 0;
  // Past the entry's last episode: the mapping is off for this title, and
  // writing it would be wrong. Nothing is sent.
  if (total > 0 && ep > total) return true;
  if (have >= ep) {
    noteCount(mal, have);
    return true;
  }
  const r = await malRequest("PATCH", `/anime/${mal}/my_list_status`, {
    status: total > 0 && ep >= total ? "completed" : "watching",
    num_watched_episodes: String(ep),
  }).catch(() => null);
  if (!r || retryable(r.status)) {
    queue(mal, ep);
    return false;
  }
  if (r.status >= 200 && r.status < 300) noteCount(mal, ep);
  return true;
}

/** Episodes and films settled this run: the 90% tick repeats every 5s, and
 * only a settled one stops being looked at. */
const handled = new Set<string>();
/** Being worked on now, so the next tick does not start a second pass. */
const working = new Set<string>();

/**
 * Run `settle` for `key` until it answers true, one pass at a time. An
 * episode is settled once it is pushed (or queued by pushProgress for the
 * next sync), once there is nothing to push, or once the mapping loaded and
 * says it has no MAL entry. A mapping that could not load settles nothing,
 * so a later tick asks again (animemap holds a failed download off for a
 * minute, so those asks do not each hit the network).
 */
async function once(key: string, settle: () => Promise<boolean>): Promise<void> {
  if (handled.has(key) || working.has(key)) return;
  working.add(key);
  try {
    if (await settle()) handled.add(key);
  } finally {
    working.delete(key);
  }
}

/** Neither index in hand: indexesFor answers a null for the one the title
 * needs, so both null says the download failed. */
const unmapped = (idx: { imdb: unknown; kitsu: unknown }) => !idx.imdb && !idx.kitsu;

export function onEpisodeWatched(seriesId: string, episodeId: string): Promise<void> {
  return once(`${seriesId}|${episodeId}`, async () => {
    // Connected first: the index is a download, and only MAL needs it here.
    if (!(await malStatus()).connected) return true;
    const item = seen.get(seriesId);
    const idx = await indexesFor(seriesId, item);
    if (!idx) return true;
    if (unmapped(idx)) return false;
    const hit = malEpisodeOf(seriesId, episodeId, item?.seasons ?? [], idx);
    if (hit) await pushProgress(hit.mal, hit.ep);
    return true;
  });
}

export function onFilmWatched(filmId: string): Promise<void> {
  return once(`${filmId}|film`, async () => {
    if (!(await malStatus()).connected) return true;
    const idx = await indexesFor(filmId, seen.get(filmId));
    if (!idx) return true;
    if (unmapped(idx)) return false;
    const hit = malFilmOf(filmId, idx);
    if (hit) await pushProgress(hit.mal, hit.ep);
    return true;
  });
}

let running: Promise<void> | null = null;

/** One sync at a time: what waits goes first, then the list is read. */
export function syncMal(): Promise<void> {
  running ??= (async () => {
    if (!(await malStatus()).connected) return;
    try {
      for (const [mal, ep] of Object.entries(loadMal().pending)) {
        if (await pushProgress(Number(mal), ep)) {
          // Only what went: a later episode queued while this one was out
          // stays for the next sync.
          const { pending } = loadMal();
          if ((pending[mal] ?? 0) > ep) continue;
          delete pending[mal];
          saveMal({ pending });
        }
      }
      const counts: Record<string, number> = {};
      for (let offset = 0; ; offset += 1000) {
        const r = await malJson<ListPage>("GET", "/users/@me/animelist", {
          fields: "list_status",
          limit: "1000",
          offset: String(offset),
          // Your own list, all of it: MAL leaves out adult entries unless
          // asked.
          nsfw: "true",
        });
        if (!r.data) throw new Error(describe(r.reply));
        for (const e of r.data.data ?? []) {
          const n = e.list_status?.num_episodes_watched ?? 0;
          if (e.node?.id && n > 0) counts[e.node.id] = n;
        }
        if (!r.data.paging?.next || offset > 50_000) break;
      }
      saveMal({ counts, lastSync: Date.now(), problem: null });
    } catch (err) {
      saveMal({ problem: err instanceof Error ? err.message : String(err) });
    }
    window.dispatchEvent(new Event(MAL_SYNCED));
  })().finally(() => {
    running = null;
  });
  return running;
}

/** How long away before coming back syncs again. */
const AWAY_MS = 15 * 60_000;

/** Sync at launch and when the window comes back after a while, and send
 * each episode and film watched here. Mounted once, at the root. */
export function useMalSync(): void {
  useEffect(() => {
    void syncMal();
    const onFocus = () => {
      if (Date.now() - (loadMal().lastSync ?? 0) > AWAY_MS) void syncMal();
    };
    const onWatched = (e: Event) => {
      const d = (e as CustomEvent<{ seriesId: string; episodeId: string }>).detail;
      if (d) void onEpisodeWatched(d.seriesId, d.episodeId).catch(() => {});
    };
    const onFilm = (e: Event) => {
      const d = (e as CustomEvent<{ filmId: string }>).detail;
      if (d) void onFilmWatched(d.filmId).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(EPISODE_WATCHED, onWatched);
    window.addEventListener(FILM_WATCHED, onFilm);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(EPISODE_WATCHED, onWatched);
      window.removeEventListener(FILM_WATCHED, onFilm);
    };
  }, []);
}
