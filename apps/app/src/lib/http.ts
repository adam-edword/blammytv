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
  /** Per-request timeout override (seconds; Rust default is 30). The xmltv
   * guide download is the one legit long fetch. Ignored in the browser. */
  timeoutSecs?: number,
): Promise<string> {
  if (isTauri()) {
    // http_get returns RAW BYTES (tauri::ipc::Response) — the string return
    // path JSON-escapes the whole body across the IPC bridge, which for a
    // ~95MB xmltv document was a multi-second tax. Decode here instead
    // (~100ms). The string check keeps us working if the command ever
    // reverts to a String return.
    const raw = await invoke<unknown>("http_get", { url, headers, timeoutSecs });
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
  opts?: {
    /** On a Rust-side 403, retry the request from the WEBVIEW: our Rust
     * client presents as a browser but its TLS fingerprint isn't really
     * Chrome's, and some proxies/bot walls 403 on that alone. WebView2 IS
     * Chrome — genuine fingerprint and headers. Only safe for endpoints
     * that send ACAO:* (Stremio addons do, by spec; Xtream panels don't,
     * so their callers must not set this). */
    browserRetryOn403?: boolean;
  },
): Promise<T> {
  let body: string;
  try {
    body = await httpGetText(url, headers);
  } catch (e) {
    const is403 = e instanceof Error && /HTTP 403/.test(e.message);
    if (!is403 || !opts?.browserRetryOn403 || !isTauri()) throw e;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.text();
    } catch (retryErr) {
      // Diagnosable from a screenshot: real Chrome was ALSO rejected, so
      // it's the config/instance, not the client.
      throw new Error("HTTP 403 (browser-engine retry was also rejected)", {
        cause: retryErr,
      });
    }
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    const head = body.slice(0, 80).replace(/\s+/g, " ").trim();
    throw new Error(`the server returned a non-JSON response (starts: "${head}")`);
  }
}
