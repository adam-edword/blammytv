/**
 * Where you left off, from Trakt into Continue Watching (plan 015, T4).
 *
 * Trakt keeps a paused position for anything stopped between 1% and 80%
 * (`/sync/playback`), from any app. Each one meets this app's entry for the
 * same title, and the newest position wins, by when it was paused (D3).
 * Continue Watching keeps one entry per title (an episode replaces its
 * sibling), so a series' entry moves to the episode paused most recently.
 *
 * Pure: Trakt's list and the app's entries in, the new entries out.
 */

import type { WatchEntry } from "../stream/watching";
import { episodeId, imdbOf, type TraktIds } from "./ids";

/** `/sync/playback?extended=full`, the fields used. */
export interface Playback {
  /** Trakt's id for this paused position, to clear it by. */
  id: number;
  /** Percent, 0 to 100. */
  progress: number;
  paused_at: string;
  type: "movie" | "episode";
  movie?: { title?: string; year?: number; runtime?: number; ids: TraktIds };
  episode?: { season: number; number: number; title?: string; runtime?: number; ids: TraktIds };
  show?: { title?: string; year?: number; runtime?: number; ids: TraktIds };
}

/** Same cap as the store's (watching.ts). */
const CAP = 20;

export function mergeProgress(local: readonly WatchEntry[], playback: readonly Playback[]): WatchEntry[] {
  const byId = new Map(local.map((e) => [e.id, e]));
  // Newest first, so a series with two paused episodes takes the later.
  const items = [...playback].sort((a, b) => Date.parse(b.paused_at) - Date.parse(a.paused_at));
  const seen = new Set<string>();
  for (const p of items) {
    const at = Date.parse(p.paused_at);
    if (!Number.isFinite(at)) continue;
    const isEp = p.type === "episode";
    const imdb = isEp ? p.show?.ids.imdb : p.movie?.ids.imdb;
    const id = imdb ? imdbOf(imdb) : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ep = isEp ? p.episode : undefined;
    if (isEp && !ep) continue;
    const epId = ep ? episodeId(id, ep.season, ep.number) : undefined;
    const prev = byId.get(id);
    if (prev && prev.at >= at) {
      // This side is newer. Still learn Trakt's id for it when it is the
      // same thing, so clearing the card here clears it there.
      if (prev.episodeId === epId) byId.set(id, { ...prev, trakt: p.id });
      continue;
    }
    const sameThing = prev && prev.episodeId === epId;
    const runtimeMin = (ep ? ep.runtime ?? p.show?.runtime : p.movie?.runtime) ?? undefined;
    const durSec = (sameThing ? prev.durSec : undefined) ?? (runtimeMin ? runtimeMin * 60 : undefined);
    const posSec = durSec ? Math.round((p.progress / 100) * durSec) : undefined;
    const title = (isEp ? p.show?.title : p.movie?.title) ?? prev?.title ?? id;
    const next: WatchEntry = {
      ...(prev ?? {}),
      id,
      title,
      kind: isEp ? "series" : "movie",
      at,
      trakt: p.id,
      ...(prev?.year == null && (isEp ? p.show?.year : p.movie?.year) != null
        ? { year: isEp ? p.show?.year : p.movie?.year }
        : {}),
      ...(!isEp && runtimeMin && prev?.runtimeMin == null ? { runtimeMin } : {}),
      ...(ep
        ? {
            episodeId: epId,
            season: ep.season,
            episode: ep.number,
            ...(ep.title ? { epTitle: ep.title, label: `S${ep.season} · E${ep.number}: ${ep.title}` } : {}),
          }
        : {}),
      posSec,
      durSec,
    };
    if (posSec == null) delete next.posSec;
    if (durSec == null) delete next.durSec;
    byId.set(id, next);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, CAP);
}
