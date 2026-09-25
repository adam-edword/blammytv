import type { Programme } from "./model";

/**
 * What a multi-view tile says about itself (plan 017, P2): why it failed,
 * whether the browser can play what it carries, what is on, how far behind
 * live it has fallen.
 *
 * Pure, so the wording can be tested against the exact strings the proxy
 * and the demuxer produce, without a stream.
 */

/** What went wrong, in the tile's words. */
export interface Failure {
  kind: "offair" | "refused" | "decode" | "unreachable" | "unknown";
  /** The headline. */
  title: string;
  /** What happened, in one sentence. */
  reason: string;
  /** Whether trying again could help. A codec will not change on a retry. */
  retry: boolean;
}

/** Everything the tile learned on the way to failing. */
export interface FailureFacts {
  /** The HTTP status that came back, when one did. */
  code?: number;
  /** Its status text. On a 502 from the proxy this is the reason: mvproxy.rs
   * answers "Bad Gateway: {what} ({route}): {cause}". */
  statusText?: string;
  /** Nothing answered at all: the fetch threw, or the connection timed out. */
  network?: boolean;
  /** It was playing and the connection ended under it. */
  cut?: boolean;
  /** The line was full when it failed: every connection it allows in use,
   * this grid's and any elsewhere. */
  atCap?: boolean;
  /** The browser refused the media (MSE or the decoder). */
  media?: boolean;
  /** What the stream carries, as mpegts.js reports it, "avc1.64001f + mp4a.40.2". */
  codecs?: string;
  /** Whether that can be played here. Null when nobody has looked. */
  playable?: boolean | null;
}

/** A codec string's family, as people know it. */
export function codecName(codec: string): string {
  const c = codec.toLowerCase();
  if (c.startsWith("hvc1") || c.startsWith("hev1")) return "HEVC";
  if (c.startsWith("avc")) return "H.264";
  if (c.startsWith("av01")) return "AV1";
  if (c.startsWith("vp09") || c === "vp9") return "VP9";
  if (c.startsWith("mp4a")) return "AAC";
  if (c === "ac-3") return "AC-3";
  if (c === "ec-3") return "E-AC-3";
  if (c === "mp3" || c.startsWith("mp4a.6b") || c.startsWith("mp4a.69")) return "MP3";
  return codec;
}

/**
 * Whether the browser can play these codecs through Media Source, and if
 * not, which one it cannot.
 *
 * Asked BEFORE the first frame, from what the demuxer found in the stream,
 * rather than waiting for the decoder to give up. Adam's machine measured
 * (2026-09-13): H.264 and AAC play, AC-3 and E-AC-3 play, HEVC does not,
 * and an HEVC tile used to just sit black.
 */
export function unplayable(
  video: string | undefined,
  audio: string | undefined,
  supports: (mime: string) => boolean,
): string | null {
  if (video && !supports(`video/mp4; codecs="${video}"`)) return video;
  if (audio && !supports(`audio/mp4; codecs="${audio}"`)) return audio;
  return null;
}

/**
 * The HEVC question mpegts.js asks itself (core/features.js). WebView2 says
 * no unless Windows' HEVC Video Extensions are installed, and then the
 * stream proxy converts HEVC to H.264 for the tile (mvconvert.rs).
 */
export const HEVC_MIME = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

export function explainFailure(channel: string, f: FailureFacts): Failure {
  const offair = (reason: string): Failure => ({
    kind: "offair",
    title: `${channel} is off the air`,
    reason,
    retry: true,
  });

  if (f.playable === false) {
    const [video] = (f.codecs ?? "").split(" + ");
    const what = video ? codecName(video) : "a format";
    return {
      kind: "decode",
      title: "This one needs the main player",
      reason: `It’s ${what}, which multi-view can’t play. The Guide’s player can.`,
      retry: false,
    };
  }

  // The proxy's own 502: the provider never gave it a stream. The words
  // after "Bad Gateway:" are its reason, so the tile can say which of the
  // ways it went wrong. (A provider's own 502 has no such prefix and falls
  // through to the codes below.)
  const proxied = f.code === 502 && f.statusText?.startsWith("Bad Gateway:");
  if (proxied) {
    const why = f.statusText!.toLowerCase();
    // The stream came, and was HEVC, and turning it into H.264 did not
    // work (mvconvert.rs). The reason after it is ffmpeg's, for the console.
    if (why.includes("can't convert hevc"))
      return {
        kind: "decode",
        title: "Couldn’t convert this one",
        reason: "It’s HEVC, and converting it for multi-view failed here. The Guide’s player can play it.",
        retry: true,
      };
    if (/dns|lookup|no such host|name or service not known|nodename/.test(why))
      return offair("Your provider sends it to a server that doesn’t exist.");
    if (why.includes("timed out"))
      return offair("Your provider’s server for it didn’t answer in time.");
    if (why.includes("could not connect"))
      return offair("Your provider’s server for it isn’t answering.");
    if (why.includes("too many redirects"))
      return offair("Your provider keeps redirecting it and never sends it.");
    return offair("The request to your provider failed.");
  }

  if (f.code === 404 || f.code === 410)
    return offair(`Your provider says it doesn’t exist (${f.code}).`);

  if (f.code !== undefined && f.code >= 400) {
    // A refusal on a full line is most likely the line saying no, and that
    // is the one a person can fix (plan 017, "A refusal says it is the
    // limit"). On a line with room, the code is all we can honestly say.
    if (f.atCap) {
      return {
        kind: "refused",
        title: "Your line is at its limit",
        reason: `Your provider refused it (${f.code}). Close a stream here or on another device, then retry.`,
        retry: true,
      };
    }
    return {
      kind: "refused",
      title: "Your provider refused this one",
      reason: `It answered ${f.code}.`,
      retry: true,
    };
  }

  if (f.network) {
    return {
      kind: "unreachable",
      title: "Can’t reach your provider",
      reason: "The connection didn’t go through.",
      retry: true,
    };
  }

  return {
    kind: "unknown",
    title: `${channel} stopped`,
    reason: f.cut
      ? "The stream cut out."
      : f.media
        ? "The picture stopped decoding."
        : "Something went wrong playing it.",
    retry: true,
  };
}

/** The programme on at `now`, and the one after it. */
export function airing(
  list: Programme[] | undefined,
  now: Date,
): { now: Programme | null; next: Programme | null } {
  if (!list?.length) return { now: null, next: null };
  const t = now.getTime();
  const i = list.findIndex((p) => p.start.getTime() <= t && t < p.end.getTime());
  if (i >= 0) return { now: list[i], next: list[i + 1] ?? null };
  return { now: null, next: list.find((p) => p.start.getTime() > t) ?? null };
}

/**
 * "Behind live" for a tile, from the time it has spent stalled.
 *
 * There is no catch-up since v0.9.104 (it flipped the rate 11 times a
 * minute for nothing), so a tile falls behind live by exactly the time it
 * has spent waiting on data, and stays there. That makes the stall total
 * the honest number to show. Under three seconds is noise: a tile that has
 * hiccupped once is still live to anyone watching it.
 */
export const BEHIND_MIN_S = 3;

export function behindLabel(stalledS: number): string | null {
  if (stalledS < BEHIND_MIN_S) return null;
  const s = Math.round(stalledS);
  if (s < 60) return `${s}s behind live`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")} behind live`;
}
