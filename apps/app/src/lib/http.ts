import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

/**
 * GET a URL's body as text. In the Tauri app this goes through Rust (so it
 * isn't blocked by browser CORS — Xtream panels send none, and we want to talk
 * to AIOStreams directly with no backend). In the browser it falls back to a
 * normal fetch (demo/dev only).
 */
export async function httpGetText(url: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>("http_get", { url });
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** GET and parse JSON. */
export async function httpGetJson<T>(url: string): Promise<T> {
  return JSON.parse(await httpGetText(url)) as T;
}
