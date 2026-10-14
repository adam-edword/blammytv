/**
 * The page's side of a Jellyfin server of your own (plan 027): thin wrappers
 * over jf.rs's commands, as aiojf/client.ts is for AIOStreams'. The page never
 * holds the token; it names a Jellyfin path and gets the server's answer back
 * as data, a 4xx included. Native refuses any path the app does not make
 * (jf.rs `on_the_list`) and any credential in a query.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";
import type { JfSource } from "./sources";

export interface JfStatus {
  /** The build has the commands. False on a native build from before them
   * (the frontend ships apart from the binary), or in a stub that answers
   * nothing: the row says it needs the app update. */
  supported: boolean;
  /** A session is kept. */
  connected: boolean;
  userName?: string;
  userId?: string;
  /** The server's address as signed in to, `https://host[:port][/prefix]`.
   * Item art is fetched from here; images need no token. */
  base?: string;
  serverName?: string;
  version?: string;
}

/** What `jf_quick_connect` answers: the code to type into Jellyfin's own page. */
export interface JfQuickConnect {
  code: string;
  serverName?: string;
}

export type JfPoll = "approved" | "pending" | "expired" | "error";

export interface JfReply {
  status: number;
  /** The raw text. */
  body: string;
}

const OFF: JfStatus = { supported: false, connected: false };

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const lacksCommand = (e: unknown): boolean =>
  /not found|unknown command/i.test(e instanceof Error ? e.message : String(e));

/** The text a build without the Jellyfin commands is answered with. */
export const NO_JF = "unsupported-build: this BlammyTV needs its update to sign in to Jellyfin";

function readStatus(s: Record<string, unknown> | null | undefined): JfStatus {
  // A stub that answers nothing is a build that cannot.
  if (!s || typeof s !== "object") return OFF;
  return {
    supported: true,
    connected: !!s.connected,
    userName: text(s.userName),
    userId: text(s.userId),
    base: text(s.base),
    serverName: text(s.serverName),
    version: text(s.version),
  };
}

export async function jfStatus(): Promise<JfStatus> {
  if (!isTauri()) return OFF;
  try {
    return readStatus(await invoke<Record<string, unknown> | null | undefined>("jf_status"));
  } catch (e) {
    // Tauri says "Command … not found" for one the binary lacks. Any other
    // failure is a build that has it and could not answer just now.
    return { supported: !lacksCommand(e), connected: false };
  }
}

/**
 * Sign in by user name and password. The password goes to native once and is
 * not kept. Rejects with a string starting `unsupported:` (not a Jellyfin, an
 * AIOStreams, too old), `denied:` (wrong login) or a plain reason.
 */
export async function jfSignIn(address: string, user: string, password: string): Promise<JfStatus> {
  try {
    return readStatus(
      await invoke<Record<string, unknown> | null | undefined>("jf_sign_in", { address, user, password }),
    );
  } catch (e) {
    if (lacksCommand(e)) throw new Error(NO_JF, { cause: e });
    throw e;
  }
}

/** Start Quick Connect. Same rejections as `jfSignIn`, plus `unsupported:`
 * when an admin turned Quick Connect off. */
export async function jfQuickConnect(address: string): Promise<JfQuickConnect> {
  let r: Record<string, unknown> | null | undefined;
  try {
    r = await invoke<Record<string, unknown> | null | undefined>("jf_quick_connect", { address });
  } catch (e) {
    if (lacksCommand(e)) throw new Error(NO_JF, { cause: e });
    throw e;
  }
  const code = text(r?.code);
  if (!code) throw new Error(NO_JF);
  return { code, serverName: text(r?.serverName) };
}

export async function jfPoll(): Promise<JfPoll> {
  const r = await invoke<string>("jf_poll");
  return r === "approved" || r === "pending" || r === "expired" ? r : "error";
}

/** Sign out here and on the server. True when the server confirmed the token
 * is revoked, false when it could not be reached (it still stands there). */
export async function jfDisconnect(): Promise<boolean> {
  const r = await invoke<unknown>("jf_disconnect");
  return r !== false;
}

type Method = "GET" | "POST" | "DELETE";

/** Rejects with `refused:` when the native guard will not send a path. */
export function jfRequest(
  method: Method,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<JfReply> {
  return invoke<JfReply>("jf_request", { method, path, query: query ?? null, body: body ?? null });
}

/** A request whose 2xx body is JSON. Anything else comes back with its
 * status and a null `data`, never a throw, so a caller branches on it. */
export async function jfJson<T>(
  method: Method,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; data: T | null; reply: JfReply }> {
  const reply = await jfRequest(method, path, opts.query, opts.body);
  let data: T | null = null;
  if (reply.status >= 200 && reply.status < 300 && reply.body) {
    try {
      data = JSON.parse(reply.body) as T;
    } catch {
      data = null;
    }
  }
  return { status: reply.status, data, reply };
}

/** What `jf_sources` answers: the server's status, its media sources cut down
 * to the fields `JfSource` reads, and the play session it minted. */
export interface JfSourcesReply {
  status: number;
  sources: JfSource[];
  playSessionId?: string;
  errorCode?: string;
}

/** Rejects with `refused:` for an id that is not 32 lower case hex, and with
 * `unsupported-build:` when this native build has no such command. */
export async function jfSources(itemId: string): Promise<JfSourcesReply> {
  let r: Record<string, unknown> | null | undefined;
  try {
    r = await invoke<Record<string, unknown> | null | undefined>("jf_sources", { itemId });
  } catch (e) {
    if (lacksCommand(e)) throw new Error(NO_JF, { cause: e });
    throw e;
  }
  if (!r || typeof r !== "object") throw new Error(NO_JF);
  return {
    status: typeof r.status === "number" ? r.status : 0,
    sources: Array.isArray(r.sources) ? (r.sources as JfSource[]) : [],
    ...(typeof r.playSessionId === "string" ? { playSessionId: r.playSessionId } : {}),
    ...(typeof r.errorCode === "string" ? { errorCode: r.errorCode } : {}),
  };
}

/** What `jf_prepare_stream` answers (jf.rs `Prepared`). */
export interface JfPrepared {
  ok: boolean;
  needsAuth: boolean;
  status: number;
  offOrigin: boolean;
}

/**
 * The check before a Jellyfin stream is given to the player (native decides
 * whether mpv needs the token as a header for it). Resolves to null on a build
 * that does not have the command: the stream is played as it is, which is
 * what a server that serves it to anyone wants anyway. Rejects with
 * `refused:` for an address that is not a direct stream of the signed-in
 * server.
 */
export async function jfPrepareStream(url: string): Promise<JfPrepared | null> {
  try {
    const r = await invoke<Record<string, unknown> | null | undefined>("jf_prepare_stream", { url });
    if (!r || typeof r !== "object") return null;
    return {
      ok: r.ok === true,
      needsAuth: r.needsAuth === true,
      status: typeof r.status === "number" ? r.status : 0,
      offOrigin: r.offOrigin === true,
    };
  } catch (e) {
    if (lacksCommand(e)) return null;
    throw e;
  }
}

/** The subtitles of one source, named by its stream address (jf.rs `SubsFor`).
 * Never an address for a subtitle: native makes that from the stream. */
export interface JfSubtitlesFor {
  streamUrl: string;
  subtitles: { index: number; title: string; language?: string }[];
}

/**
 * Tell native which external subtitle files go with which streams, so the
 * player can add them once it has the file (mpvsubs.rs). Resolves to how many
 * subtitles native now knows, or null on a build that does not have the
 * command: the file plays without them. Rejects for anything else, and with
 * `not signed in` when no server is.
 */
export async function jfSetSubtitles(entries: JfSubtitlesFor[]): Promise<number | null> {
  try {
    const n = await invoke<unknown>("jf_set_subtitles", { entries });
    return typeof n === "number" ? n : null;
  } catch (e) {
    if (lacksCommand(e)) return null;
    throw e;
  }
}
