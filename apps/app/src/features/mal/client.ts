/**
 * The page's side of MyAnimeList (plan 021): thin wrappers over mal.rs's
 * commands, as features/trakt/client.ts is for Trakt. The page never holds
 * a token; it names a MAL path and gets MAL's answer back as data.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";

export interface MalStatus {
  /** The build carries a MAL client id. */
  configured: boolean;
  /** A session is kept. */
  connected: boolean;
}

/** Where the browser sign-in is. */
export type SignIn =
  | { at: "idle" }
  | { at: "waiting" }
  | { at: "approved" }
  | { at: "denied" }
  | { at: "expired" }
  | { at: "failed"; note: string };

export interface Reply {
  status: number;
  body: string;
}

const OFF: MalStatus = { configured: false, connected: false };

export async function malStatus(): Promise<MalStatus> {
  if (!isTauri()) return OFF;
  try {
    // Read field by field: a build from before mal.rs (or a harness's
    // stub) answers nothing at all.
    const s = await invoke<Partial<MalStatus> | null | undefined>("mal_status");
    return s && typeof s === "object" ? { configured: !!s.configured, connected: !!s.connected } : OFF;
  } catch {
    return OFF;
  }
}

/** Listen for MAL's redirect; the link to open in the browser. */
export const malSignInStart = () => invoke<string>("mal_sign_in_start");
export const malSignInCancel = () => invoke<void>("mal_sign_in_cancel");
export const malDisconnect = () => invoke<void>("mal_disconnect");

export async function malSignInPoll(): Promise<SignIn> {
  const s = await invoke<SignIn | null | undefined>("mal_sign_in_poll");
  return s && typeof s === "object" && "at" in s ? s : { at: "idle" };
}

type Method = "GET" | "PATCH" | "PUT" | "DELETE";

/** `form` is the query on a GET and the form-encoded body on anything
 * else, which is how MAL takes a list update. */
export function malRequest(method: Method, path: string, form?: Record<string, string>): Promise<Reply> {
  return invoke<Reply>("mal_request", { method, path, form: form ?? null });
}

/** A request whose 2xx body is JSON. Anything else comes back with its
 * status and a null `data`, never a throw. */
export async function malJson<T>(
  method: Method,
  path: string,
  form?: Record<string, string>,
): Promise<{ status: number; data: T | null; reply: Reply }> {
  const reply = await malRequest(method, path, form);
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

/** What a failed answer means, in words for the Settings row. MAL bans a
 * client with an HTML page, not JSON. */
export function describe(reply: Reply): string {
  if (reply.status === 403 && !reply.body.trimStart().startsWith("{"))
    return "MyAnimeList is refusing this app right now";
  if (reply.status === 401) return "signed out";
  return `MyAnimeList answered ${reply.status}`;
}
