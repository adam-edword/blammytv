import type { XtreamConfig } from "../env.js";
import type {
  XtreamAuth,
  XtreamCategory,
  XtreamLiveStream,
} from "./types.js";

/** Thin HTTP client for an Xtream Codes panel. */
export class XtreamClient {
  constructor(private readonly cfg: XtreamConfig) {}

  /** Verify the account; throws if the panel rejects the credentials. */
  async authenticate(): Promise<XtreamAuth> {
    const auth = await this.getJson<XtreamAuth>(this.playerApi());
    if (auth?.user_info?.auth !== 1) {
      throw new Error(
        `Xtream auth failed: ${auth?.user_info?.message ?? auth?.user_info?.status ?? "rejected"}`,
      );
    }
    return auth;
  }

  getLiveCategories(): Promise<XtreamCategory[]> {
    return this.getJson(this.playerApi({ action: "get_live_categories" }));
  }

  getLiveStreams(): Promise<XtreamLiveStream[]> {
    return this.getJson(this.playerApi({ action: "get_live_streams" }));
  }

  /** Full XMLTV EPG for the account (one document covering all channels). */
  async getXmltv(): Promise<string> {
    const url = new URL(`${this.cfg.baseUrl}/xmltv.php`);
    url.searchParams.set("username", this.cfg.username);
    url.searchParams.set("password", this.cfg.password);
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Xtream xmltv ${res.status}`);
    return res.text();
  }

  /**
   * Playable live URL. Xtream embeds the account credentials in the path —
   * that's how its playback works, so the device receives a creds-bearing URL.
   * (A future option is to proxy playback through the backend to keep the
   * credentials server-side; see the integration notes.)
   */
  liveStreamUrl(streamId: number | string): string {
    const u = encodeURIComponent(this.cfg.username);
    const p = encodeURIComponent(this.cfg.password);
    return `${this.cfg.baseUrl}/live/${u}/${p}/${streamId}.${this.cfg.liveExt}`;
  }

  private playerApi(params: Record<string, string> = {}): string {
    const url = new URL(`${this.cfg.baseUrl}/player_api.php`);
    url.searchParams.set("username", this.cfg.username);
    url.searchParams.set("password", this.cfg.password);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Xtream ${res.status} for ${stripCreds(url)}`);
    return res.json() as Promise<T>;
  }
}

/** Keep credentials out of error messages / logs. */
function stripCreds(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("username");
    u.searchParams.delete("password");
    return u.toString();
  } catch {
    return "<url>";
  }
}
