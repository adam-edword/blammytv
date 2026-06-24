import { httpGetJson, httpGetText } from "../http";
import type {
  XtreamAuth,
  XtreamCategory,
  XtreamConfig,
  XtreamLiveStream,
} from "./types";

/** Thin client for an Xtream Codes panel. Fetches go through Rust (`http_get`)
 * since panels send no CORS headers. */
export class XtreamClient {
  constructor(private readonly cfg: XtreamConfig) {}

  /** Verify the account; throws if the panel rejects the credentials. */
  async authenticate(): Promise<XtreamAuth> {
    const auth = await httpGetJson<XtreamAuth>(this.playerApi());
    if (auth?.user_info?.auth !== 1) {
      throw new Error(
        `Xtream auth failed: ${auth?.user_info?.message ?? auth?.user_info?.status ?? "rejected"}`,
      );
    }
    return auth;
  }

  getLiveCategories(): Promise<XtreamCategory[]> {
    return httpGetJson(this.playerApi({ action: "get_live_categories" }));
  }

  getLiveStreams(): Promise<XtreamLiveStream[]> {
    return httpGetJson(this.playerApi({ action: "get_live_streams" }));
  }

  /** Full XMLTV EPG for the account (one document covering all channels). */
  getXmltv(): Promise<string> {
    const url = new URL(`${this.cfg.baseUrl}/xmltv.php`);
    url.searchParams.set("username", this.cfg.username);
    url.searchParams.set("password", this.cfg.password);
    return httpGetText(url.toString());
  }

  /** Playable live URL — Xtream embeds the account credentials in the path. */
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
}
