import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Season } from "./model";
import {
  isFinished,
  keptProgress,
  loadWatching,
  recordWatching,
  resumePoint,
  retiredFromContinue,
  rolledForward,
  updateWatchingProgress,
  updateWatchingSource,
  type WatchEntry,
} from "./watching";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const entry = (over: Partial<WatchEntry>): WatchEntry => ({
  id: "tt1",
  title: "Movie",
  at: 1,
  ...over,
});

beforeEach(() => store.clear());

describe("retiredFromContinue", () => {
  it("retires finished movies, keeps everything else", () => {
    // Movie ≥90% → retired from the CW row.
    expect(retiredFromContinue(entry({ posSec: 5400, durSec: 5700 }))).toBe(
      true,
    );
    // Movie mid-way → stays.
    expect(retiredFromContinue(entry({ posSec: 1200, durSec: 5700 }))).toBe(
      false,
    );
    // Series entry (even a finished episode) → stays; smart resume
    // rolls it to the next episode instead.
    expect(
      retiredFromContinue(
        entry({ episodeId: "tt1:1:2", posSec: 5400, durSec: 5700 }),
      ),
    ).toBe(false);
    // No clocks yet → stays.
    expect(retiredFromContinue(entry({}))).toBe(false);
  });
});

describe("resumePoint", () => {
  it("resumes a meaningful position, rewound a few seconds", () => {
    expect(resumePoint(entry({ posSec: 600, durSec: 6000 }))).toBe(597);
  });
  it("starts over when barely started or effectively finished", () => {
    expect(resumePoint(entry({ posSec: 45 }))).toBeUndefined();
    expect(resumePoint(entry({ posSec: 5900, durSec: 6000 }))).toBeUndefined();
    // 90% is the ledger/retirement threshold — resumePoint must agree,
    // or a "finished" movie resumes into its own credits on rewatch.
    expect(resumePoint(entry({ posSec: 5500, durSec: 6000 }))).toBeUndefined();
    expect(resumePoint(entry({ posSec: 5300, durSec: 6000 }))).toBe(5297);
    expect(resumePoint(undefined)).toBeUndefined();
    expect(resumePoint(entry({}))).toBeUndefined();
  });
  it("only resumes the SAME episode of a series", () => {
    const e = entry({ episodeId: "tt1:1:4", posSec: 600, durSec: 2400 });
    expect(resumePoint(e, "tt1:1:4")).toBe(597);
    expect(resumePoint(e, "tt1:1:5")).toBeUndefined();
  });
  it("trusts a long position even without a known duration", () => {
    expect(resumePoint(entry({ posSec: 600 }))).toBe(597);
  });
});

describe("updateWatchingProgress", () => {
  it("updates position in place without reordering", () => {
    recordWatching(entry({ id: "a", at: 1 }));
    recordWatching(entry({ id: "b", at: 2 }));
    const list = updateWatchingProgress("a", 120, 6000);
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(list[1]).toMatchObject({ posSec: 120, durSec: 6000 });
    expect(loadWatching()[1].posSec).toBe(120);
  });
});

const season = (n: number, count: number): Season => ({
  id: `s${n}`,
  number: n,
  name: n === 0 ? "Specials" : `Season ${n}`,
  episodes: Array.from({ length: count }, (_, i) => ({
    id: `tt1:${n}:${i + 1}`,
    number: i + 1,
    title: `E${i + 1}`,
  })),
});
const SEASONS = [season(0, 2), season(1, 3), season(2, 2)];
const episodic = (episodeId: string, posSec: number, durSec: number) =>
  entry({ id: "tt1", episodeId, kind: "series", posSec, durSec });

describe("isFinished", () => {
  it("draws the line at 90% of a known duration, as resumePoint does", () => {
    expect(isFinished({ posSec: 2160, durSec: 2400 })).toBe(true);
    expect(isFinished({ posSec: 2159, durSec: 2400 })).toBe(false);
    expect(isFinished({ posSec: 2400, durSec: 2400 })).toBe(true);
    // No clocks, no answer.
    expect(isFinished({ posSec: 2400 })).toBe(false);
    expect(isFinished({ durSec: 2400 })).toBe(false);
    expect(isFinished({})).toBe(false);
  });
});

describe("the source an entry was on", () => {
  it("is kept with the entry, and an entry from before it existed loads as it was", () => {
    recordWatching(entry({ id: "tt1", fileName: "Show.S01E01.1080p.mkv", bingeGroup: "g|1080p" }));
    recordWatching(entry({ id: "tt2" }));
    const [old, kept] = [loadWatching().find((e) => e.id === "tt2"), loadWatching().find((e) => e.id === "tt1")];
    expect(kept?.fileName).toBe("Show.S01E01.1080p.mkv");
    expect(kept?.bingeGroup).toBe("g|1080p");
    expect(old && "fileName" in old).toBe(false);
    expect(old && "bingeGroup" in old).toBe(false);
  });

  it("is replaced by the next play of the title, which may be on another source", () => {
    recordWatching(entry({ id: "tt1", fileName: "A.mkv", bingeGroup: "g1" }));
    recordWatching(entry({ id: "tt1", fileName: "B.mkv" }));
    const [only] = loadWatching();
    expect(only.fileName).toBe("B.mkv");
    expect(only.bingeGroup).toBeUndefined();
  });
});

describe("updateWatchingSource", () => {
  it("moves the entry to the source now playing, in place and keeping its progress", () => {
    recordWatching(entry({ id: "a", at: 1 }));
    recordWatching(entry({ id: "b", at: 2, fileName: "A.mkv", bingeGroup: "g1", posSec: 900, durSec: 6000 }));
    const list = updateWatchingSource("b", { fileName: "B.mkv", bingeGroup: "g2" });
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ fileName: "B.mkv", bingeGroup: "g2", posSec: 900, durSec: 6000, at: 2 });
    expect(loadWatching()[0]).toMatchObject({ fileName: "B.mkv", bingeGroup: "g2" });
  });

  it("drops what the new source does not send, so a resume never goes back to the old file", () => {
    recordWatching(entry({ id: "a", fileName: "A.mkv", bingeGroup: "g1" }));
    const [e] = updateWatchingSource("a", { bingeGroup: "g2" });
    expect("fileName" in e).toBe(false);
    expect(e.bingeGroup).toBe("g2");
    const [none] = updateWatchingSource("a", {});
    expect("fileName" in none).toBe(false);
    expect("bingeGroup" in none).toBe(false);
  });

  it("changes nothing for the source it is already on, and nothing for a title it has no entry for", () => {
    recordWatching(entry({ id: "a", fileName: "A.mkv", bingeGroup: "g1", posSec: 5 }));
    const before = JSON.stringify(loadWatching());
    updateWatchingSource("a", { fileName: "A.mkv", bingeGroup: "g1" });
    expect(JSON.stringify(loadWatching())).toBe(before);
    updateWatchingSource("zz", { fileName: "Z.mkv" });
    expect(JSON.stringify(loadWatching())).toBe(before);
  });
});

describe("rolledForward", () => {
  it("sends a finished episode's card to the next episode", () => {
    const hit = rolledForward(episodic("tt1:1:1", 2300, 2400), SEASONS);
    expect(hit?.episode.id).toBe("tt1:1:2");
    expect(hit?.season.number).toBe(1);
  });

  it("rolls over a season's end", () => {
    expect(rolledForward(episodic("tt1:1:3", 2300, 2400), SEASONS)?.episode.id).toBe("tt1:2:1");
  });

  it("keeps the card's own episode when it is not finished", () => {
    expect(rolledForward(episodic("tt1:1:1", 600, 2400), SEASONS)).toBeNull();
    expect(rolledForward(episodic("tt1:1:1", 2159, 2400), SEASONS)).toBeNull();
  });

  it("keeps a finished finale as it was", () => {
    expect(rolledForward(episodic("tt1:2:2", 2400, 2400), SEASONS)).toBeNull();
  });

  it("keeps the card's own episode when the next one has not aired yet", () => {
    const now = new Date(2026, 9, 11, 15, 0).getTime();
    const day = (d: number) => new Date(2026, 9, d).getTime();
    const aired: Season[] = [
      {
        id: "s1",
        number: 1,
        name: "Season 1",
        episodes: [
          { id: "tt1:1:1", number: 1, title: "a", airsAt: day(4) },
          { id: "tt1:1:2", number: 2, title: "b", airsAt: day(14) },
        ],
      },
    ];
    expect(rolledForward(episodic("tt1:1:1", 2300, 2400), aired, now)).toBeNull();
    // The same card on the day it airs rolls.
    const onTheDay = new Date(2026, 9, 14, 8, 0).getTime();
    expect(rolledForward(episodic("tt1:1:1", 2300, 2400), aired, onTheDay)?.episode.id).toBe("tt1:1:2");
  });

  it("keeps the card's own when the seasons are not known, and for a film", () => {
    expect(rolledForward(episodic("tt1:1:1", 2300, 2400), [])).toBeNull();
    expect(rolledForward(entry({ posSec: 5400, durSec: 5700 }), SEASONS)).toBeNull();
  });
});

describe("what a new play carries over (setPlaying's rule)", () => {
  // setPlaying keeps the old position and duration only when resumePoint
  // said to resume: the same two calls, in the same order.
  const carried = (prev: WatchEntry | undefined, episodeId?: string) =>
    keptProgress(prev, resumePoint(prev, episodeId));

  it("keeps a part-watched episode's progress when it is resumed", () => {
    const prev = episodic("tt1:1:1", 600, 2400);
    expect(carried(prev, "tt1:1:1")).toEqual({ posSec: 600, durSec: 2400 });
  });

  it("writes none for a finished episode started over", () => {
    // Left in the credits, played again: the old 99% must not sit in the
    // entry for the scrobble's stop on leaving to read before the first tick.
    const prev = episodic("tt1:1:1", 2350, 2400);
    expect(carried(prev, "tt1:1:1")).toEqual({});
  });

  it("writes none for a finished film played again", () => {
    expect(carried(entry({ posSec: 5400, durSec: 5700 }))).toEqual({});
  });

  it("writes none when switching episodes, or for a barely-started one", () => {
    expect(carried(episodic("tt1:1:1", 600, 2400), "tt1:1:2")).toEqual({});
    expect(carried(episodic("tt1:1:1", 45, 2400), "tt1:1:1")).toEqual({});
  });

  it("writes none for a title never played", () => {
    expect(carried(undefined, "tt1:1:1")).toEqual({});
  });
});
