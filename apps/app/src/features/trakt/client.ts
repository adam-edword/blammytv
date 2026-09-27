/**
 * The page's side of Trakt (plan 015): thin wrappers over trakt.rs's
 * commands. The page never holds a token or the client secret; it names a
 * Trakt path and gets Trakt's answer back as data, a 4xx included.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";

export interface TraktStatus {
  /** The build carries Trakt keys. */
  configured: boolean;
  /** A session is kept. */
  connected: boolean;
}

export interface DeviceCode {
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export type Poll = "approved" | "pending" | "invalid" | "used" | "expired" | "denied" | "slow_down" | "idle";

export interface Reply {
  status: number;
  body: string;
  retry_after?: number | null;
  account_limit?: number | null;
  upgrade_url?: string | null;
}

const OFF: TraktStatus = { configured: false, connected: false };

export async function traktStatus(): Promise<TraktStatus> {
  if (!isTauri()) return OFF;
  try {
    // Whatever comes back is read field by field: a build from before
    // trakt.rs (or a harness's stub) answers nothing at all.
    const s = await invoke<Partial<TraktStatus> | null | undefined>("trakt_status");
    return s && typeof s === "object" ? { configured: !!s.configured, connected: !!s.connected } : OFF;
  } catch {
    return OFF;
  }
}

export const traktDeviceStart = () => invoke<DeviceCode>("trakt_device_start");
export const traktDevicePoll = () => invoke<Poll>("trakt_device_poll");
export const traktDisconnect = () => invoke<void>("trakt_disconnect");

export function traktRequest(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Reply> {
  return invoke<Reply>("trakt_request", {
    method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
  });
}

/** A request whose 2xx body is JSON. Anything else comes back with its
 * status and a null `data`, never a throw, so a caller branches on it. */
export async function traktJson<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; reply: Reply }> {
  const reply = await traktRequest(method, path, body);
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
