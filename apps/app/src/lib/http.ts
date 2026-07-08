import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

/**
 * GET a URL's body as text. In the Tauri app this goes through Rust (so it
 * isn't blocked by browser CORS — Xtream panels send none — and uses the
 * Windows-native TLS stack some CDNs require). In the browser it falls back
 * to a normal fetch (dev only; CORS-permitting servers like AIOStreams work).
 */
export async function httpGetText(url: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>("http_get", { url });
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** GET and parse JSON. A non-JSON body (a proxy/captive-portal HTML page, a
 * panel error page served with 200) throws a named error naming the real
 * failure instead of an opaque "Unexpected token '<'" SyntaxError. */
export async function httpGetJson<T>(url: string): Promise<T> {
  const body = await httpGetText(url);
  try {
    return JSON.parse(body) as T;
  } catch {
    const head = body.slice(0, 80).replace(/\s+/g, " ").trim();
    throw new Error(`the server returned a non-JSON response (starts: "${head}")`);
  }
}
