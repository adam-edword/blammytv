import { describe, expect, it } from "vitest";
import {
  airing,
  behindLabel,
  codecName,
  explainFailure,
  unplayable,
} from "./mvTile";

const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m);

describe("explainFailure", () => {
  // The proxy's 502s, worded the way mvproxy.rs words them.
  it("says a channel sent to a host that does not exist is off the air", () => {
    // Paramount+ 01 on Adam's line: a redirect to a hostname that does not
    // resolve. Windows words the DNS miss one way, Linux another.
    for (const text of [
      "Bad Gateway: could not connect (provider.tv -> xyakqielska.net): No such host is known. (os error 11001)",
      "Bad Gateway: could not connect (provider.tv -> xyakqielska.net): failed to lookup address information: Name or service not known",
    ]) {
      const f = explainFailure("Paramount+ 01", { code: 502, statusText: text });
      expect(f.kind).toBe("offair");
      expect(f.title).toBe("Paramount+ 01 is off the air");
      expect(f.reason).toMatch(/server that doesn.t exist/);
    }
  });

  it("tells a server that is down from one that is slow", () => {
    const down = explainFailure("CN", {
      code: 502,
      statusText: "Bad Gateway: could not connect (provider.tv): Connection refused (os error 111)",
    });
    const slow = explainFailure("CN", {
      code: 502,
      statusText: "Bad Gateway: timed out (provider.tv)",
    });
    expect(down.reason).toMatch(/isn.t answering/);
    expect(slow.reason).toMatch(/didn.t answer in time/);
    expect(down.kind).toBe("offair");
    expect(slow.kind).toBe("offair");
  });

  it("names a redirect loop", () => {
    const f = explainFailure("CN", {
      code: 502,
      statusText: "Bad Gateway: too many redirects (a.tv -> b.tv)",
    });
    expect(f.reason).toMatch(/redirecting/);
  });

  it("says a conversion that failed is one, and that a retry may help", () => {
    // mvconvert.rs's reasons: ffmpeg's own last line, or its silence.
    for (const cause of ["pipe:0: Invalid data found when processing input", "ffmpeg produced nothing for 20 seconds"]) {
      const f = explainFailure("GAME PASS 1", { code: 502, statusText: `Bad Gateway: can't convert HEVC: ${cause}` });
      expect(f.kind).toBe("decode");
      expect(f.title).toBe("Couldn’t convert this one");
      expect(f.reason).toMatch(/HEVC/);
      expect(f.retry).toBe(true);
    }
  });

  it("treats the provider's own 502 as a refusal, not the proxy's", () => {
    const f = explainFailure("CN", { code: 502, statusText: "Bad Gateway" });
    expect(f.kind).toBe("refused");
    expect(f.reason).toBe("It answered 502.");
  });

  it("passes the provider's refusals through with the code", () => {
    for (const code of [401, 403, 458, 503, 509]) {
      const f = explainFailure("CN", { code, statusText: "" });
      expect(f.kind).toBe("refused");
      expect(f.reason).toBe(`It answered ${code}.`);
      expect(f.retry).toBe(true);
    }
  });

  it("says a refusal on a full line is the limit, and how to get past it", () => {
    const f = explainFailure("CN", { code: 403, atCap: true });
    expect(f.kind).toBe("refused");
    expect(f.title).toBe("Your line is at its limit");
    expect(f.reason).toMatch(/\(403\)/);
    expect(f.reason).toMatch(/Close a stream/);
  });

  it("does not blame the limit for a 404, even on a full line", () => {
    expect(explainFailure("CN", { code: 404, atCap: true }).kind).toBe("offair");
  });

  it("calls a 404 off the air", () => {
    const f = explainFailure("CN", { code: 404 });
    expect(f.kind).toBe("offair");
    expect(f.reason).toMatch(/doesn.t exist \(404\)/);
  });

  it("says when nothing answered at all", () => {
    const f = explainFailure("CN", { network: true });
    expect(f.kind).toBe("unreachable");
    expect(f.title).toBe("Can’t reach your provider");
  });

  it("sends a codec the browser cannot play to the main player, with no retry", () => {
    const f = explainFailure("CBS 4K", {
      codecs: "hvc1.2.4.L153.B0 + mp4a.40.2",
      playable: false,
      media: true,
    });
    expect(f.kind).toBe("decode");
    expect(f.reason).toMatch(/HEVC/);
    expect(f.retry).toBe(false);
  });

  it("does not blame the codec when it plays here", () => {
    const f = explainFailure("CN", {
      codecs: "avc1.64001f + mp4a.40.2",
      playable: true,
      media: true,
    });
    expect(f.kind).toBe("unknown");
    expect(f.reason).toMatch(/decoding/);
  });

  it("tells a stream that cut out from one that never connected", () => {
    const f = explainFailure("CN", { cut: true });
    expect(f.kind).toBe("unknown");
    expect(f.reason).toBe("The stream cut out.");
  });

  it("falls back to something honest", () => {
    const f = explainFailure("CN", {});
    expect(f.kind).toBe("unknown");
    expect(f.title).toBe("CN stopped");
  });
});

describe("unplayable", () => {
  const only = (ok: string[]) => (mime: string) => ok.some((c) => mime.includes(c));

  it("names the video codec the browser refuses", () => {
    expect(unplayable("hvc1.1.6.L120", "mp4a.40.2", only(["mp4a"]))).toBe("hvc1.1.6.L120");
  });

  it("names the audio codec when the picture is fine", () => {
    expect(unplayable("avc1.64001f", "ec-3", only(["avc1"]))).toBe("ec-3");
  });

  it("is null when everything plays, or nothing is known yet", () => {
    expect(unplayable("avc1.64001f", "mp4a.40.2", only(["avc1", "mp4a"]))).toBeNull();
    expect(unplayable(undefined, undefined, only([]))).toBeNull();
  });

  it("asks in the shape MediaSource.isTypeSupported takes", () => {
    const asked: string[] = [];
    unplayable("avc1.64001f", "mp4a.40.2", (m) => (asked.push(m), true));
    expect(asked).toEqual(['video/mp4; codecs="avc1.64001f"', 'audio/mp4; codecs="mp4a.40.2"']);
  });
});

describe("codecName", () => {
  it("says what people call them", () => {
    expect(codecName("hev1.1.6.L93.B0")).toBe("HEVC");
    expect(codecName("avc1.64001f")).toBe("H.264");
    expect(codecName("mp4a.40.2")).toBe("AAC");
    expect(codecName("ec-3")).toBe("E-AC-3");
    expect(codecName("weird.1")).toBe("weird.1");
  });
});

describe("airing", () => {
  const list = [
    { title: "A", start: at(14), end: at(14, 30) },
    { title: "B", start: at(14, 30), end: at(15) },
    { title: "C", start: at(16), end: at(17) },
  ];

  it("finds what is on and what follows", () => {
    const r = airing(list, at(14, 40));
    expect(r.now?.title).toBe("B");
    expect(r.next?.title).toBe("C");
  });

  it("starts a programme on its first minute and ends it before its last", () => {
    expect(airing(list, at(14, 30)).now?.title).toBe("B");
    expect(airing(list, at(15)).now).toBeNull();
  });

  it("offers what is next in a gap, and nothing without a guide", () => {
    const gap = airing(list, at(15, 20));
    expect(gap.now).toBeNull();
    expect(gap.next?.title).toBe("C");
    expect(airing(undefined, at(14))).toEqual({ now: null, next: null });
  });
});

describe("behindLabel", () => {
  it("stays quiet for a hiccup", () => {
    expect(behindLabel(0)).toBeNull();
    expect(behindLabel(2.9)).toBeNull();
  });

  it("counts seconds, then minutes", () => {
    expect(behindLabel(12.4)).toBe("12s behind live");
    expect(behindLabel(75)).toBe("1:15 behind live");
  });
});
