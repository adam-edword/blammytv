import { peekLive, loadLive } from "./source";
import { resolveStreamUrl } from "./stream";
import { isTauri, tauriMvProxyClose, tauriMvProxyOpen } from "../../lib/tauri";
import {
  findHitches,
  getMvProfile,
  liveTiles,
  setMvProfile,
  type MvProfile,
} from "./multiviewTuning";

/**
 * Console probe for the multiview player question (plan 013).
 *
 *   await btvMultiview()              // the first live channel
 *   await btvMultiview("CBS 4K UHD")  // by name, or part of one
 *   await btvMultiview("<id>")        // or by id
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
 * before a single tile can render. It does since v0.9.101 (mvproxy.rs),
 * because Adam's panel stopped sending the header, so in the shell the
 * probe also reads the stream the way the tiles do: through the proxy.
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
  btvMultiview?: (channel?: string) => Promise<void>;
  btvMultiviewStats?: (seconds?: number) => Promise<void>;
  btvMultiviewTune?: (profile: MvProfile) => void;
}

/**
 * THE STUTTER PROBE, for whatever multi-view tiles are playing:
 *
 *   await btvMultiviewStats()      // 60 seconds
 *   btvMultiviewTune("chase")      // v0.9.101's settings, tiles restart
 *   await btvMultiviewStats()      // the same window, compared
 *   btvMultiviewTune("smooth")     // back to the default
 *
 * Each tile gets a summary: jumps (seeks, which the "chase" setting does on
 * purpose), stalls and time frozen, frames dropped against shown, buffer
 * ahead of the playhead, playback rate, download speed. Then a TIMELINE,
 * because Adam's stutter comes every 20 to 30 seconds and a count cannot
 * say what it coincides with:
 * - hitches: a gap between two presented frames (requestVideoFrameCallback)
 *   over 100ms and three times the typical interval. That is the stutter as
 *   seen, whether or not the element ever said it was waiting;
 * - rate changes (the smooth profile's 1.1x catch-up switching on and off),
 *   stalls and jumps, each with its second;
 * and once, for the whole page, main-thread tasks over 100ms.
 * A hitch at the same second as a rate change, a stall, a long task, or on
 * every tile at once each points somewhere different.
 */
async function measure(seconds: number): Promise<void> {
  const tiles = liveTiles();
  if (!tiles.length) {
    console.warn("[mv] no multi-view tiles are playing");
    return;
  }
  console.info(
    `[mv] measuring ${tiles.length} tile(s) for ${seconds}s on the "${getMvProfile()}" profile...`,
  );
  const t0 = performance.now();
  const at = () => ((performance.now() - t0) / 1000).toFixed(1);
  let done = false;

  const longTasks: string[] = [];
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration > 100)
          longTasks.push(`${((e.startTime - t0) / 1000).toFixed(1)}s (${e.duration.toFixed(0)}ms)`);
      }
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    /* no longtask entries in this engine; the tiles still report */
  }

  const runs = tiles.map((t) => {
    const v = t.video;
    const r = {
      jumps: 0,
      stalls: 0,
      stalledMs: 0,
      since: 0,
      ahead: [] as number[],
      rates: new Set<number>(),
      speeds: [] as number[],
      q0: v.getVideoPlaybackQuality(),
      events: [] as string[],
      frameTimes: [] as number[],
    };
    const onSeeking = () => {
      r.jumps++;
      r.events.push(`${at()}s jump`);
    };
    const onWaiting = () => {
      r.stalls++;
      if (!r.since) r.since = performance.now();
      r.events.push(`${at()}s stall`);
    };
    const onPlaying = () => {
      if (r.since) r.stalledMs += performance.now() - r.since;
      r.since = 0;
    };
    const onRate = () => r.events.push(`${at()}s rate ${v.playbackRate}`);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("ratechange", onRate);
    const onFrame: VideoFrameRequestCallback = (now) => {
      if (done) return;
      r.frameTimes.push(now);
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    const off = () => {
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("ratechange", onRate);
    };
    return { t, r, off };
  });
  const sample = window.setInterval(() => {
    for (const { t, r } of runs) {
      const b = t.video.buffered;
      if (b.length) r.ahead.push(b.end(b.length - 1) - t.video.currentTime);
      r.rates.add(t.video.playbackRate);
      const sp = t.speed();
      if (sp !== undefined) r.speeds.push(sp);
    }
  }, 250);
  await new Promise((finish) => window.setTimeout(finish, seconds * 1000));
  done = true;
  window.clearInterval(sample);
  observer?.disconnect();
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  for (const { t, r, off } of runs) {
    off();
    if (r.since) r.stalledMs += performance.now() - r.since;
    const q1 = t.video.getVideoPlaybackQuality();
    const shown = q1.totalVideoFrames - r.q0.totalVideoFrames;
    const dropped = q1.droppedVideoFrames - r.q0.droppedVideoFrames;
    const hitches = findHitches(r.frameTimes).map(
      (h) => `${((h.at - t0) / 1000).toFixed(1)}s (${h.gap.toFixed(0)}ms)`,
    );
    console.info(
      `[mv] "${t.name}": ${r.jumps} jumps, ${r.stalls} stalls ` +
        `(${(r.stalledMs / 1000).toFixed(1)}s frozen), ` +
        `${dropped}/${shown} frames dropped (${(shown / seconds).toFixed(0)} fps), ` +
        (r.ahead.length
          ? `buffer ahead avg ${avg(r.ahead).toFixed(2)}s min ${Math.min(...r.ahead).toFixed(2)}s max ${Math.max(...r.ahead).toFixed(2)}s, `
          : "buffer ahead: nothing buffered, ") +
        `rate ${[...r.rates].join("/")}` +
        (r.speeds.length ? `, download ${avg(r.speeds).toFixed(0)} KB/s` : ""),
    );
    console.info(
      `[mv]   hitches: ${hitches.length ? hitches.join(", ") : "none"}` +
        ` | events: ${r.events.length ? r.events.join(", ") : "none"}`,
    );
  }
  console.info(
    `[mv] main-thread tasks over 100ms: ${
      observer ? (longTasks.length ? longTasks.join(", ") : "none") : "not measurable here"
    }`,
  );
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

  w.btvMultiviewStats = (seconds = 60) => measure(seconds);
  w.btvMultiviewTune = (p: MvProfile) => {
    if (p !== "smooth" && p !== "chase") {
      console.warn('[mv] profiles are "smooth" and "chase"');
      return;
    }
    setMvProfile(p);
    console.info(`[mv] profile: ${p}. Playing tiles restart with it.`);
  };

  w.btvMultiview = async (which?: string) => {
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
      // A name, because the id is nothing anyone can see: the tile shows
      // the name, so that is what gets typed in here. An exact id still wins.
      const needle = which?.toLowerCase();
      const channel = !needle
        ? live.channels[0]
        : (live.channels.find((c) => c.id === which) ??
          live.channels.find((c) => c.name.toLowerCase() === needle) ??
          live.channels.find((c) => c.name.toLowerCase().includes(needle)));
      if (!channel) {
        console.warn(`[mv] no channel matches "${which}"`);
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
            "missing Access-Control-Allow-Origin. In the app, tiles go through " +
            "the native proxy instead, checked next.",
        );
      } finally {
        window.clearTimeout(timer);
        ctl.abort();
      }

      // THE PATH THE TILES USE. Same rules: headers only, then abort, and the
      // loopback URL is not printed either (it is a token, but a live one).
      if (isTauri()) {
        const local = await tauriMvProxyOpen(url).catch(() => "");
        if (!local) {
          console.info("[mv] proxy: not in this build (rebuild with v0.9.101+)");
          return;
        }
        const ctl2 = new AbortController();
        const timer2 = window.setTimeout(() => ctl2.abort(), 15000);
        try {
          const res = await fetch(local, { signal: ctl2.signal });
          console.info(
            `[mv] through the proxy: ${res.status} ${res.headers.get("content-type") ?? "(no content-type)"}` +
              (res.ok
                ? ", so a tile can read this"
                : ", refused by the provider (the code is theirs)"),
          );
        } catch (e) {
          console.info(
            `[mv] through the proxy: failed (${e instanceof Error ? e.name : "unknown"})`,
          );
        } finally {
          window.clearTimeout(timer2);
          ctl2.abort();
          void tauriMvProxyClose(local).catch(() => {});
        }
      }
    } catch (e) {
      console.error("[mv] probe failed:", e);
    }
  };
}
