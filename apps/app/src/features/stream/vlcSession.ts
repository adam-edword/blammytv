/**
 * A film or an episode playing in VLC (plan 032): the title the app follows,
 * and what it does with each `vlc-progress` native sends.
 *
 * The in-app player is closed by then, so nothing on a screen can hold this.
 * It is a module, with one listener for the life of the app and one title
 * followed at a time (native follows one VLC: a second open replaces the
 * first, and the first says nothing more). `useVlcFollow` (App) hands the
 * title to the Trakt, AIOStreams and Jellyfin reports, which keep their own
 * rules; this file only does what the player's own 5s tick does.
 *
 * Each report is the player's tick: the position goes to Continue Watching
 * (updateWatchingProgress), and the title counts as watched at the same 90%
 * line (watching.ts `isFinished`), by the same two calls, an episode in the
 * ledger and a film to MyAnimeList. "gone" is the last report: the position
 * VLC last gave is saved, and the session ends, which is what lets the
 * reports above send their stop (they read that saved position).
 */

import { onVlcProgress, tauriVlcOpen, VLC_NOT_INSTALLED, type VlcProgress } from "../../lib/tauri";
import { scrubbedMessage } from "../../lib/errors";
import { TRAKT_SYNCED } from "../trakt/store";
import type { VodFrom } from "./model";
import { filmWatched, markWatched } from "./watched";
import { isFinished, updateWatchingProgress } from "./watching";

/** What the reports need to name the title. */
export interface VlcTarget {
  itemId: string;
  kind: "movie" | "series";
  title: string;
  year?: number;
  episodeId?: string;
  /** The season the episode sits in (AIOStreams' id for it needs it). */
  season?: number;
  /** Not the addon's: a Jellyfin or a playlist (StreamScreen `playing.item.from`). */
  from?: VodFrom;
  /** The address VLC plays: a Jellyfin report names the file by it. */
  streamUrl: string;
}

let current: VlcTarget | null = null;
const watchers = new Set<() => void>();
let listening = false;

const changed = () => watchers.forEach((fn) => fn());

/** The title being followed, or null. Stable between changes, for
 * useSyncExternalStore. */
export const currentVlc = (): VlcTarget | null => current;

/** Told when a title starts or stops being followed (not on each report). */
export function onVlcSession(fn: () => void): () => void {
  watchers.add(fn);
  return () => void watchers.delete(fn);
}

/** Follow `t` from now on, in place of any title before it. */
export function followVlc(t: VlcTarget): void {
  current = t;
  changed();
  if (listening) return;
  listening = true;
  // A listener that never came up (no native side) is tried again by the next.
  onVlcProgress(applyVlcProgress).catch(() => {
    listening = false;
  });
}

/** The name on VLC's window: the film, or "Show · S1 E4 · Episode". */
export function vlcTitle(title: string, ep?: { season: number; episode: number; title: string }): string {
  return ep ? `${title} · S${ep.season} E${ep.episode} · ${ep.title}` : title;
}

/** What the page says about a VLC that did not start. */
export type VlcOpenFailure = { missing: true } | { missing: false; why: string };

/**
 * Start `t` in VLC, from `start` seconds in, and follow it. Null once it has
 * started; else why it did not, with nothing followed. The playlist's own
 * User-Agent (plan 028) goes with it, as it goes to mpv.
 */
export async function openInVlc(
  t: VlcTarget,
  name: string,
  userAgent?: string,
  start?: number,
): Promise<VlcOpenFailure | null> {
  try {
    await tauriVlcOpen(t.streamUrl, name, userAgent, start);
  } catch (e) {
    const why = scrubbedMessage(e);
    return why === VLC_NOT_INSTALLED ? { missing: true } : { missing: false, why };
  }
  followVlc(t);
  return null;
}

/** One report from VLC. Anything with no title being followed is dropped. */
export function applyVlcProgress(p: VlcProgress): void {
  const t = current;
  if (!t) return;
  // A stopped VLC reads 0 (the player's tick skips the same): not a position.
  if (p.pos > 0) {
    const entry = updateWatchingProgress(t.itemId, p.pos, p.len > 0 ? p.len : undefined).find((e) => e.id === t.itemId);
    window.dispatchEvent(new Event(TRAKT_SYNCED));
    if (entry && isFinished(entry)) {
      if (t.episodeId) markWatched(t.itemId, t.episodeId);
      else if (t.kind === "movie") filmWatched(t.itemId);
    }
  }
  if (p.state === "gone") {
    current = null;
    changed();
  }
}
