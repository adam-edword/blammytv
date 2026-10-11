import { describe, expect, it } from "vitest";
import {
  chapterSkipType,
  remoteSkipType,
  skipChipLabel,
  skipSegmentAt,
  skippedLabel,
  type SkipInputs,
} from "./skipSegments";

const DUR = 1440;
const at = (pos: number, over: Partial<SkipInputs> = {}) =>
  skipSegmentAt({ pos, dur: DUR, chapters: [], combine: false, ...over });
const ch = (title: string, start: number) => ({ title, start });

describe("remoteSkipType", () => {
  it("names the kind of an AniSkip or marker interval", () => {
    expect(remoteSkipType("op")).toBe("intro");
    expect(remoteSkipType("mixed-op")).toBe("intro");
    expect(remoteSkipType("ed")).toBe("credits");
    expect(remoteSkipType("mixed-ed")).toBe("credits");
    expect(remoteSkipType("recap")).toBe("recap");
    expect(remoteSkipType("preview")).toBe("preview");
  });

  it("has nothing for a kind with no setting", () => {
    for (const t of ["", "commercial", "Intro", "OP", "intro", "outro", "ending", "mixed", "constructor"])
      expect(remoteSkipType(t), t).toBeNull();
  });
});

describe("chapterSkipType", () => {
  it("is the same mapping the chip's words always used", () => {
    expect(chapterSkipType("Recap")).toBe("recap");
    expect(chapterSkipType("Previously on")).toBe("recap");
    expect(chapterSkipType("Credits")).toBe("credits");
    expect(chapterSkipType("Ending")).toBe("credits");
    expect(chapterSkipType("Outro")).toBe("credits");
    expect(chapterSkipType("ED")).toBe("credits");
    expect(chapterSkipType("Preview")).toBe("preview");
    expect(chapterSkipType("Intro")).toBe("intro");
    expect(chapterSkipType("Opening")).toBe("intro");
    expect(chapterSkipType("OP")).toBe("intro");
  });

  it("puts a title with two words in the first kind the chip's words check", () => {
    // Recap before credits before preview, as skipLabel did.
    expect(chapterSkipType("Recap and credits")).toBe("recap");
    expect(chapterSkipType("Opening Credits")).toBe("credits");
    expect(chapterSkipType("Credits Preview")).toBe("credits");
  });
});

describe("labels", () => {
  it("says Skip, then the kind", () => {
    expect(skipChipLabel("intro")).toBe("Skip Intro");
    expect(skipChipLabel("recap")).toBe("Skip Recap");
    expect(skipChipLabel("credits")).toBe("Skip Credits");
    expect(skipChipLabel("preview")).toBe("Skip Preview");
  });

  it("says Skipped after an automatic skip, a run included", () => {
    expect(skippedLabel("Skip Intro")).toBe("Skipped Intro");
    expect(skippedLabel("Skip Credits & Preview")).toBe("Skipped Credits & Preview");
  });
});

describe("skipSegmentAt, from intervals", () => {
  const skips = [
    { type: "op", start: 10, end: 95 },
    { type: "recap", start: 100, end: 160 },
    { type: "ed", start: 1320, end: 1410 },
    { type: "preview", start: 1410, end: 1440 },
  ];

  it("is the interval the clock is inside, typed", () => {
    expect(at(30, { skips })).toEqual({ type: "intro", start: 10, end: 95, label: "Skip Intro", key: "intro:10-95" });
    expect(at(120, { skips })?.type).toBe("recap");
    expect(at(1350, { skips })?.type).toBe("credits");
    expect(at(1420, { skips })).toMatchObject({ type: "preview", label: "Skip Preview", start: 1410, end: 1440 });
  });

  it("starts at the start and stops short of the end", () => {
    expect(at(10, { skips })?.type).toBe("intro");
    expect(at(9.9, { skips })).toBeNull();
    expect(at(95, { skips })).toBeNull();
    expect(at(94.9, { skips })?.type).toBe("intro");
  });

  it("is nothing between intervals, with no clock length, or for an interval over half the file", () => {
    expect(at(600, { skips })).toBeNull();
    expect(skipSegmentAt({ pos: 30, dur: 0, skips, chapters: [], combine: false })).toBeNull();
    expect(at(30, { skips: [{ type: "op", start: 0, end: 1200 }] })).toBeNull();
  });

  it("lands no later than the end of the file", () => {
    expect(at(1430, { skips: [{ type: "ed", start: 1400, end: 1500 }] })?.end).toBe(DUR);
  });

  it("is not a stretch for a kind it cannot name, and a chapter may then speak", () => {
    expect(at(30, { skips: [{ type: "weird", start: 10, end: 95 }] })).toBeNull();
    expect(
      at(30, { skips: [{ type: "weird", start: 10, end: 95 }], chapters: [ch("Opening", 5), ch("Part A", 95)] }),
    ).toMatchObject({ type: "intro", start: 5, end: 95 });
  });

  it("goes by the first interval that has the clock, in the order given", () => {
    const both = [
      { type: "recap", start: 0, end: 60 },
      { type: "op", start: 30, end: 90 },
    ];
    expect(at(40, { skips: both })?.type).toBe("recap");
  });

  it("is not overruled by a chapter under it", () => {
    const got = at(30, { skips, chapters: [ch("Preview", 0), ch("Part A", 200)] });
    expect(got?.type).toBe("intro");
    expect(got?.start).toBe(10);
  });
});

describe("skipSegmentAt, from chapters", () => {
  const chapters = [
    ch("Opening", 5),
    ch("Part A", 95),
    ch("Credits", 1300),
    ch("Preview", 1390),
  ];

  it("types the chapter by its title and ends it at the next", () => {
    expect(at(30, { chapters })).toEqual({ type: "intro", start: 5, end: 95, label: "Skip Intro", key: "intro:5-95" });
    expect(at(1350, { chapters })).toMatchObject({ type: "credits", start: 1300, end: 1390, label: "Skip Credits" });
    expect(at(1400, { chapters })).toMatchObject({ type: "preview", start: 1390, end: DUR, label: "Skip Preview" });
  });

  it("is nothing inside a chapter that is not skippable, or with one chapter", () => {
    expect(at(500, { chapters })).toBeNull();
    expect(at(30, { chapters: [ch("Opening", 0)] })).toBeNull();
  });

  it("is nothing once the clock is at the end of the file, where a skip to the end puts it", () => {
    expect(at(DUR - 0.1, { chapters })).toMatchObject({ type: "preview" });
    expect(at(DUR, { chapters })).toBeNull();
    expect(at(DUR, { chapters, combine: true })).toBeNull();
  });

  it("is nothing for a chapter covering half the file", () => {
    expect(at(30, { chapters: [ch("Intro", 0), ch("Part A", 900)] })).toBeNull();
  });

  it("keeps credits and preview apart unless combine is on", () => {
    expect(at(1350, { chapters, combine: false })).toMatchObject({ type: "credits", end: 1390 });
  });

  it("combine joins the run into one jump that takes Credits' kind", () => {
    expect(at(1350, { chapters, combine: true })).toEqual({
      type: "credits",
      start: 1300,
      end: DUR,
      label: "Skip Credits & Preview",
      key: "credits:1300-1440",
    });
  });

  it("combine from a preview chapter that is followed by credits is a credits stretch too", () => {
    const rev = [ch("Part A", 0), ch("Preview", 1300), ch("Credits", 1360)];
    expect(at(1310, { chapters: rev, combine: true })).toMatchObject({ type: "credits", label: "Skip Credits & Preview", end: DUR });
  });

  it("combine leaves a lone preview a preview, and a lone credits a credits", () => {
    const lone = [ch("Part A", 0), ch("Credits", 1300)];
    expect(at(1350, { chapters: lone, combine: true })).toMatchObject({ type: "credits", label: "Skip Credits" });
    const prev = [ch("Part A", 0), ch("Preview", 1390)];
    expect(at(1400, { chapters: prev, combine: true })).toMatchObject({ type: "preview", label: "Skip Preview" });
  });

  it("combine does not reach back: inside the preview of a run, only the preview", () => {
    expect(at(1400, { chapters, combine: true })).toMatchObject({ type: "preview", start: 1390 });
  });

  it("combine merges only credits and preview chapters, not an intro", () => {
    const run = [ch("Opening", 0), ch("Credits", 100), ch("Part A", 200)];
    expect(at(30, { chapters: run, combine: true })).toMatchObject({ type: "intro", end: 100 });
  });

  it("names a stretch by its kind and its bounds, so the same one is the same key", () => {
    expect(at(30, { chapters })?.key).toBe(at(80, { chapters })?.key);
    expect(at(1350, { chapters })?.key).not.toBe(at(1400, { chapters })?.key);
  });
});
