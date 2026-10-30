import { useSyncExternalStore } from "react";
import { scheduleKey } from "./schedule";
import {
  isTauri,
  onRecUpdate,
  tauriRecBufferStart,
  tauriRecDelete,
  tauriRecList,
  tauriRecSchedule,
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
 *
 * A programme scheduled from the Guide (Phase 3) is a record here too, with the
 * status "scheduled". Native keeps its clock; when the start comes the record
 * arrives as `due` and this hands it to claim.ts, which finds the link and
 * starts it. That is the only thing a due record needs from the page.
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

/**
 * The connections the app's own recordings hold (plan 029). A stream recording
 * is a connection of its own on its playlist's line; one that reads the
 * player's buffer (D3) opens none. `ids` is what changed means: the sorted ids
 * of the running ones, so a start or an end is a new value and a 5s size
 * update is not. `lines` is how many hold each playlist's line.
 */
export interface StreamRecs {
  ids: string;
  lines: ReadonlyMap<string, number>;
}

export function streamRecs(list: readonly Recording[]): StreamRecs {
  const mine = list.filter((r) => r.status === "recording" && !r.buffer);
  const lines = new Map<string, number>();
  for (const r of mine) lines.set(r.playlistId, (lines.get(r.playlistId) ?? 0) + 1);
  return { ids: mine.map((r) => r.id).sort().join(","), lines };
}

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((k) => b.has(k));

// ---- the stateful half ----

let list: readonly Recording[] = [];
let keys: ReadonlySet<string> = new Set();
let planned: ReadonlySet<string> = new Set();
let streams: StreamRecs = streamRecs([]);
let running = false;
let working = false;
let started = false;
/** Ids an event has spoken for. A `rec_list` answer that lands after one is
 * older than it, and must not put the old row back. */
const spoken = new Set<string>();
const subs = new Set<() => void>();
/** Due records already handed to claim.ts, so an event and a list that both
 * carry one start it once. */
const handed = new Set<string>();

function set(next: readonly Recording[]): void {
  list = next;
  // The Guide listens to the keys alone: a 5s size update must not re-render it.
  const k = runningKeys(next);
  if (!sameKeys(k, keys)) keys = k;
  const sk = new Set(
    next
      .filter((r) => r.status === "scheduled" && r.channelId)
      .map((r) => scheduleKey(r.channelId as string, r.startedAt)),
  );
  if (!sameKeys(sk, planned)) planned = sk;
  for (const r of next) {
    if (r.status !== "scheduled" || !r.due || handed.has(r.id)) continue;
    handed.add(r.id);
    // Loaded when first needed: it brings the playlists' code with it.
    void import("./claim").then((m) => m.claimDue(r)).catch(() => {});
  }
  const s = streamRecs(next);
  if (s.ids !== streams.ids) streams = s;
  running = next.some((r) => r.status === "recording");
  working = next.some((r) => r.job != null);
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
export const streamsNow = (): StreamRecs => streams;
export const plannedNow = (): ReadonlySet<string> => planned;
export const runningNow = (): boolean => running;
/** Whether any finished recording has a job, waiting or running (plan 029,
 * Phase 4): native is repackaging or shrinking, and a restart would end it. */
export const workingNow = (): boolean => working;
/** Which of the two holds Install and Restart, as bits, so a change from one
 * to the other is a new value and the words that say why are drawn again. */
const busyNow = (): number => (running ? 1 : 0) | (working ? 2 : 0);

/** Every recording, newest first. Re-renders on each update. */
export const useRecordings = (): readonly Recording[] => useSyncExternalStore(watch, listNow);

/** One recording, or none. Only a change to it re-renders. */
export const useRecording = (id: string | null): Recording | undefined =>
  useSyncExternalStore(watch, () => (id ? list.find((r) => r.id === id) : undefined));

/** Which channels are being recorded, as `recKey`s. The same set until a
 * recording starts or ends. */
export const useRunningKeys = (): ReadonlySet<string> => useSyncExternalStore(watch, keysNow);

/** The programmes with a recording scheduled, as `scheduleKey`s. The same set
 * until one is scheduled, cancelled or settles. */
export const useScheduledKeys = (): ReadonlySet<string> => useSyncExternalStore(watch, plannedNow);

/** The running recordings that hold a connection, for the grid's room and the
 * counts. Re-renders only when one starts or ends. */
export const useStreamRecs = (): StreamRecs => useSyncExternalStore(watch, streamsNow);

/** Whether any recording runs (buffer ones too) or has a job: Install and
 * Restart wait for either. Draws again when either starts or ends. */
export const useRecordingBusy = (): number => useSyncExternalStore(watch, busyNow);

/** The event normally came first. If it has not, one look, so the button
 * never sits on a recording it cannot find. */
async function seen(id: string): Promise<void> {
  if (!list.some((r) => r.id === id))
    await tauriRecList().then(
      (all) => set(merge(list, fromList(all))),
      () => {},
    );
}

/** Record. Answers the id; rejects with native's reason. */
export async function startRecording(a: Parameters<typeof tauriRecStart>[0]): Promise<string> {
  start();
  const id = await tauriRecStart(a);
  await seen(id);
  return id;
}

/** Keep a programme to record. Answers the Scheduled record; rejects with
 * native's reason. */
export async function scheduleRecording(a: Parameters<typeof tauriRecSchedule>[0]): Promise<Recording> {
  start();
  const rec = await tauriRecSchedule(a);
  apply(rec);
  return rec;
}

/** Record the player's own buffer (D3). Answers the id; rejects with native's
 * reason. It holds no connection of its own, which the record says (`buffer`). */
export async function startBufferRecording(a: Parameters<typeof tauriRecBufferStart>[0]): Promise<string> {
  start();
  const id = await tauriRecBufferStart(a);
  await seen(id);
  return id;
}

/** Stop and wait for the file to be finished; the final record is kept. */
export async function stopRecording(id: string): Promise<Recording> {
  const rec = await tauriRecStop(id);
  apply(rec);
  return rec;
}

/** Delete a finished recording's file and entry, or cancel a scheduled one.
 * Rejects with native's reason (a running one is refused). */
export async function deleteRecording(id: string): Promise<void> {
  await tauriRecDelete(id);
  set(list.filter((r) => r.id !== id));
}
