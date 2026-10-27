import { useSyncExternalStore } from "react";
import {
  isTauri,
  onRecUpdate,
  tauriRecDelete,
  tauriRecList,
  tauriRecStart,
  tauriRecStop,
  type RecRecord,
} from "../../lib/tauri";

/**
 * The recordings, as native keeps them (rec.rs, plan 029), for every screen
 * that shows one: the player's Record button, the Guide's dot, the Live TV
 * list and Library's.
 *
 * Loaded once with `rec_list`, then kept by `rec-update` events (every status
 * change, and every 5s of growth). Nothing polls. A recording runs in Rust
 * whatever the page is doing, so this outlives every screen: it is started by
 * the first one that asks and never stopped.
 *
 * Times are Unix ms, newest started first.
 */
export type Recording = RecRecord;

// ---- the pure half ----

/** Newest started first; the id breaks a tie so the order is stable. */
const newest = (a: Recording, b: Recording): number =>
  b.startedAt - a.startedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** `rec` put in the list: replacing the one with its id, else added. */
export function upsert(list: readonly Recording[], rec: Recording): Recording[] {
  return [...list.filter((r) => r.id !== rec.id), rec].sort(newest);
}

/** `incoming` put in the list the same way, sorted once. */
export function merge(list: readonly Recording[], incoming: readonly Recording[]): Recording[] {
  const ids = new Set(incoming.map((r) => r.id));
  return [...list.filter((r) => !ids.has(r.id)), ...incoming].sort(newest);
}

/** A recording is of a channel by its playlist and its name: the record keeps
 * the name the channel had, with no link to the channel list (which changes). */
export const recKey = (playlistId: string, channel: string): string => `${playlistId}\n${channel}`;

/** The playlist a channel id names (`${playlistId}:${streamId}`). */
export const playlistOf = (channelId: string): string => {
  const sep = channelId.indexOf(":");
  return sep < 0 ? "" : channelId.slice(0, sep);
};

/** The running recording of this channel, if there is one. */
export function findRunning(
  list: readonly Recording[],
  playlistId: string,
  channel: string,
): Recording | undefined {
  return list.find(
    (r) => r.status === "recording" && r.playlistId === playlistId && r.channel === channel,
  );
}

/** The keys of every channel being recorded. */
export const runningKeys = (list: readonly Recording[]): Set<string> =>
  new Set(list.filter((r) => r.status === "recording").map((r) => recKey(r.playlistId, r.channel)));

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((k) => b.has(k));

// ---- the stateful half ----

let list: readonly Recording[] = [];
let keys: ReadonlySet<string> = new Set();
let started = false;
/** Ids an event has spoken for. A `rec_list` answer that lands after one is
 * older than it, and must not put the old row back. */
const spoken = new Set<string>();
const subs = new Set<() => void>();

function set(next: readonly Recording[]): void {
  list = next;
  // The Guide listens to the keys alone: a 5s size update must not re-render it.
  const k = runningKeys(next);
  if (!sameKeys(k, keys)) keys = k;
  subs.forEach((f) => f());
}

function apply(rec: Recording): void {
  if (typeof rec?.id !== "string") return; // not a record: nothing to keep
  spoken.add(rec.id);
  set(upsert(list, rec));
}

/** What `rec_list` answered, as a list: anything else is no recordings. */
const fromList = (all: unknown): Recording[] =>
  Array.isArray(all) ? all.filter((r) => typeof r?.id === "string" && !spoken.has(r.id)) : [];

/** Begin listening and load, once. Only where there is a native side to ask. */
function start(): void {
  if (started || !isTauri()) return;
  started = true;
  // Listening, and only then loading, so nothing said in between is lost.
  void onRecUpdate(apply)
    .then(() => tauriRecList())
    .then(
      (all) => set(merge(list, fromList(all))),
      () => {}, // a native build from before recording: an empty list, as it is
    );
}

/** Listen for a change, starting the store if this is the first. What the
 * hooks below hand to useSyncExternalStore, and what the tests call. */
export const watch = (cb: () => void): (() => void) => {
  start();
  subs.add(cb);
  return () => void subs.delete(cb);
};
export const listNow = (): readonly Recording[] => list;
export const keysNow = (): ReadonlySet<string> => keys;

/** Every recording, newest first. Re-renders on each update. */
export const useRecordings = (): readonly Recording[] => useSyncExternalStore(watch, listNow);

/** One recording, or none. Only a change to it re-renders. */
export const useRecording = (id: string | null): Recording | undefined =>
  useSyncExternalStore(watch, () => (id ? list.find((r) => r.id === id) : undefined));

/** Which channels are being recorded, as `recKey`s. The same set until a
 * recording starts or ends. */
export const useRunningKeys = (): ReadonlySet<string> => useSyncExternalStore(watch, keysNow);

/** Record. Answers the id; rejects with native's reason. */
export async function startRecording(a: Parameters<typeof tauriRecStart>[0]): Promise<string> {
  start();
  const id = await tauriRecStart(a);
  // The event normally came first. If it has not, one look, so the button
  // never sits on a recording it cannot find.
  if (!list.some((r) => r.id === id))
    await tauriRecList().then(
      (all) => set(merge(list, fromList(all))),
      () => {},
    );
  return id;
}

/** Stop and wait for the file to be finished; the final record is kept. */
export async function stopRecording(id: string): Promise<Recording> {
  const rec = await tauriRecStop(id);
  apply(rec);
  return rec;
}

/** Delete a finished recording's file and entry. Rejects with native's reason
 * (a running one is refused). */
export async function deleteRecording(id: string): Promise<void> {
  await tauriRecDelete(id);
  set(list.filter((r) => r.id !== id));
}
