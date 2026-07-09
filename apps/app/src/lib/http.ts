import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

/**
 * GET a URL's body as text. In the Tauri app this goes through Rust (so it
 * isn't blocked by browser CORS — Xtream panels send none — and uses the
 * Windows-native TLS stack some CDNs require). In the browser it falls back
 * to a normal fetch (dev only; CORS-permitting servers like AIOStreams and
 * the fake fixtures work).
 *
 * `headers` is for header-authenticated providers (Stalker portals send
 * Cookie/Authorization/a MAG User-Agent on every call). Rust merges them
 * over its browser-default headers; the browser fallback passes them to
 * fetch verbatim (forbidden ones like User-Agent/Cookie are silently
 * dropped by the browser — fixture servers don't enforce those, the real
 * portals are only ever reached through Rust).
 */
export async function httpGetText(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  if (isTauri()) {
    // http_get returns RAW BYTES (tauri::ipc::Response) — the string return
    // path JSON-escapes the whole body across the IPC bridge, which for a
    // ~95MB xmltv document was a multi-second tax. Decode here instead
    // (~100ms). The string check keeps us working if the command ever
    // reverts to a String return.
    const raw = await invoke<unknown>("http_get", { url, headers });
    if (typeof raw === "string") return raw;
    return new TextDecoder().decode(raw as ArrayBuffer);
  }
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** GET and parse JSON. A non-JSON body (a proxy/captive-portal HTML page, a
 * panel error page served with 200) throws a named error naming the real
 * failure instead of an opaque "Unexpected token '<'" SyntaxError. */
export async function httpGetJson<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  const body = await httpGetText(url, headers);
  try {
    return JSON.parse(body) as T;
  } catch {
    const head = body.slice(0, 80).replace(/\s+/g, " ").trim();
    throw new Error(`the server returned a non-JSON response (starts: "${head}")`);
  }
}
