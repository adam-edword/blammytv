/**
 * The page's side of AIOStreams' Jellyfin sync (plan 023): thin wrappers over
 * aiojf.rs's commands, as trakt/client.ts is for Trakt. The page never holds
 * the token; it names a Jellyfin path and gets AIOStreams' answer back as
 * data, a 4xx included. The native side refuses the paths that would start
 * AIOStreams' whole stream search (`GET /Items/{id}` without `Fields`), but
 * nothing here asks for one.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";
import type { SourceItem } from "./browse";

export interface AiojfStatus {
  /** The build has the commands. False on a native build from before them
   * (the frontend ships apart from the binary), or in a stub that answers
   * nothing: the row says it needs the app update. */
  supported: boolean;
  /** A session is kept. */
  connected: boolean;
  userName?: string;
  userId?: string;
  /** `https://host[/prefix]/jellyfin`. Item art is fetched from here; images
   * need no token. */
  base?: string;
}

/** What `aiojf_start` answers: the code to approve, and the page to do it on. */
export interface QuickConnect {
  code: string;
  /** Seconds the code is good for. */
  expiresIn: number;
  configureUrl: string;
}

export type Poll = "approved" | "pending" | "expired" | "error";

export interface Reply {
  status: number;
  /** The raw text. */
  body: string;
}

const OFF: AiojfStatus = { supported: false, connected: false };

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export async function aiojfStatus(): Promise<AiojfStatus> {
  if (!isTauri()) return OFF;
  try {
    // Read field by field: a build from before aiojf.rs (or a harness's
    // stub) answers nothing at all.
    const s = await invoke<Record<string, unknown> | null | undefined>("aiojf_status");
    if (!s || typeof s !== "object") return OFF;
    return {
      supported: true,
      connected: !!s.connected,
      userName: text(s.userName),
      userId: text(s.userId),
      base: text(s.base),
    };
  } catch (e) {
    // Tauri says "Command … not found" for one the binary lacks. Any other
    // failure is a build that has it and could not answer just now.
    return { supported: !/not found|unknown command/i.test(String(e)), connected: false };
  }
}

/** Rejects with a string starting `unsupported:` when the instance has no
 * Jellyfin side (or is older than 2.35), any other string otherwise. */
export const aiojfStart = (manifestUrl: string) => invoke<QuickConnect>("aiojf_start", { manifestUrl });

export async function aiojfPoll(): Promise<Poll> {
  const r = await invoke<string>("aiojf_poll");
  return r === "approved" || r === "pending" || r === "expired" ? r : "error";
}

export const aiojfDisconnect = () => invoke<void>("aiojf_disconnect");

type Method = "GET" | "POST" | "DELETE";

/** Rejects with `refused:` when the native guard will not send a path. */
export function aiojfRequest(
  method: Method,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  return invoke<Reply>("aiojf_request", { method, path, query: query ?? null, body: body ?? null });
}

/** What `aiojf_sources` answers: AIOStreams' status for the search, and the
 * sources cut down to the fields `SourceItem` reads (the full answer carries
 * the token in its subtitle URLs, so the native side drops them). */
export interface SourcesReply {
  status: number;
  sources: SourceItem[];
  /** `NoCompatibleStream` or `NotAllowed` when AIOStreams gave one. */
  errorCode?: string;
}

/** Rejects with `refused:` for an id that is not 32 lower case hex, and with
 * `unsupported-build:` when this native build has no such command (the
 * frontend ships apart from the binary). The only call that starts
 * AIOStreams' stream search: `aiojfRequest` refuses that path. `refresh`
 * searches again; without it a list from the last 3 minutes is taken as it
 * is. */
export async function aiojfSources(itemId: string, refresh: boolean): Promise<SourcesReply> {
  let r: Record<string, unknown> | null | undefined;
  try {
    r = await invoke<Record<string, unknown> | null | undefined>("aiojf_sources", { itemId, refresh });
  } catch (e) {
    if (lacksCommand(e)) throw new Error(NO_SOURCES, { cause: e });
    throw e;
  }
  // A stub that answers nothing is a build that cannot, as for the status.
  if (!r || typeof r !== "object") throw new Error(NO_SOURCES);
  return {
    status: typeof r.status === "number" ? r.status : 0,
    sources: Array.isArray(r.sources) ? (r.sources as SourceItem[]) : [],
    ...(typeof r.errorCode === "string" ? { errorCode: r.errorCode } : {}),
  };
}

/** The text a build without `aiojf_sources` is answered with. */
export const NO_SOURCES =
  "unsupported-build: this BlammyTV needs its update to open AIOStreams sources by sign-in";

const lacksCommand = (e: unknown): boolean => /not found|unknown command/i.test(e instanceof Error ? e.message : String(e));

let canSource: Promise<boolean> | null = null;

/**
 * Whether this native build has `aiojf_sources`. Asked once, by calling it
 * with an id it refuses before any request goes out: a build that has the
 * command rejects with `refused:`, one that lacks it says so, and a stub that
 * answers nothing is a build that cannot. Sign-in only carries Stream when
 * the build can open sources too (conn.ts), else the manifest does.
 */
export function aiojfCanSource(): Promise<boolean> {
  canSource ??= (async () => {
    if (!isTauri()) return false;
    try {
      const r = await invoke<unknown>("aiojf_sources", { itemId: "", refresh: false });
      return !!r && typeof r === "object";
    } catch (e) {
      return !lacksCommand(e);
    }
  })();
  return canSource;
}

/** A request whose 2xx body is JSON. Anything else comes back with its
 * status and a null `data`, never a throw, so a caller branches on it. */
export async function aiojfJson<T>(
  method: Method,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; data: T | null; reply: Reply }> {
  const reply = await aiojfRequest(method, path, opts.query, opts.body);
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
