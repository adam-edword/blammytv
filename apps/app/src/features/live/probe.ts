import { peekLive, loadLive } from "./source";
import { resolveStreamUrl } from "./stream";

/**
 * Console probe for the multiview player question (plan 013).
 *
 *   await btvMultiview()          // the first live channel
 *   await btvMultiview("<id>")    // a particular one
 *
 * THE QUESTION IT SETTLES. Telly's own multiview modal says it "uses a
 * web-based player instead of the native player", and warns about HEVC and
 * "certain audio formats" — which is the fingerprint of a transmuxer
 * feeding Media Source Extensions rather than a native decoder. Going the
 * same way costs us two things Telly already had: a TS demuxer, and a way
 * past CORS.
 *
 * The demuxer is a known quantity (mpegts.js transmuxes MPEG2-TS to
 * fragmented MP4 and feeds MSE). CORS is NOT: mpegts.js fetches the stream
 * over XHR, so the panel has to send Access-Control-Allow-Origin or the
 * request never lands, and whether a given panel does is not something
 * anyone here can know from the outside. If it does, the web player needs
 * no proxy at all. If it does not, a local proxy in Rust has to exist
 * before a single tile can render.
 *
 * So this asks the browser directly, on the machine that has the playlist:
 * what container is the stream, will fetch reach it, and which codecs can
 * this WebView2 actually feed MSE.
 *
 * NEVER PRINTS THE URL. An Xtream live URL carries the username and
 * password in its path — see channelStreamUrl. The extension and the
 * outcome are what matter and neither is a secret; the same rule the
 * discover probe follows for addon manifests.
 */

interface Probes {
  btvMultiview?: (channelId?: string) => Promise<void>;
}

/**
 * What a transmuxer would hand MSE, and what that costs on this machine.
 *
 * mpegts.js turns MPEG2-TS into fragmented MP4, so the question is never
 * "can the browser play TS" (it cannot, that is the whole point) but "can
 * it play what comes out". Each row below is a real IPTV combination.
 */
const CODECS: [string, string][] = [
  ["H.264 + AAC", 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'],
  ["H.264 + MP3", 'video/mp4; codecs="avc1.42E01E,mp4a.69"'],
  ["HEVC + AAC", 'video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"'],
  ["AC-3 audio", 'audio/mp4; codecs="ac-3"'],
  ["E-AC-3 audio", 'audio/mp4; codecs="ec-3"'],
];

export function installPlayerProbes(): void {
  const w = window as unknown as Probes;

  w.btvMultiview = async (channelId?: string) => {
    try {
      // MSE FIRST, because it needs no playlist and no network: if this
      // WebView2 cannot take fragmented MP4 at all, nothing else matters.
      const mse = typeof MediaSource !== "undefined";
      console.info(`[mv] MediaSource: ${mse ? "available" : "MISSING"}`);
      if (mse) {
        for (const [label, type] of CODECS) {
          console.info(
            `[mv]   ${MediaSource.isTypeSupported(type) ? "yes" : "NO "}  ${label}`,
          );
        }
      }

      if (!peekLive()) {
        console.info("[mv] loading your playlist...");
        await loadLive(new Date());
      }
      const live = peekLive();
      if (!live) {
        console.warn("[mv] no playlist, so no stream to test");
        return;
      }
      const channel = channelId
        ? live.channels.find((c) => c.id === channelId)
        : live.channels[0];
      if (!channel) {
        console.warn("[mv] no such channel");
        return;
      }
      const url = await resolveStreamUrl(channel);
      if (!url) {
        console.warn(`[mv] could not resolve a URL for "${channel.name}"`);
        return;
      }
      // The EXTENSION, never the URL: the credentials are in the path.
      const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
      console.info(
        `[mv] "${channel.name}" is .${ext ?? "(no extension)"} — ` +
          (ext === "m3u8"
            ? "HLS, so hls.js"
            : "MPEG-TS, so mpegts.js (no browser can demux this natively)"),
      );

      // THE CORS ANSWER. Aborted as soon as the headers land: this is a
      // LIVE stream, and leaving it open would hold a provider connection
      // and pull video for as long as the probe ran.
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(url, { signal: ctl.signal });
        console.info(
          `[mv] fetch reached it: ${res.status} ${res.headers.get("content-type") ?? "(no content-type)"}`,
        );
        console.info(
          "[mv] CORS: ALLOWED — mpegts.js could read this directly, no proxy needed",
        );
      } catch (e) {
        // A CORS refusal and a dead server both land here as TypeError, and
        // they need opposite fixes, so say which is which rather than
        // printing one word.
        console.info(
          `[mv] fetch failed (${e instanceof Error ? e.name : "unknown"}): ${e}`,
        );
        console.info(
          "[mv] CORS: BLOCKED or unreachable. If the panel is up, this is the " +
            "missing Access-Control-Allow-Origin, and the web player needs a " +
            "local proxy in Rust before any tile can render.",
        );
      } finally {
        window.clearTimeout(timer);
        ctl.abort();
      }
    } catch (e) {
      console.error("[mv] probe failed:", e);
    }
  };
}
