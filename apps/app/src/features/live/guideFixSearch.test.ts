import { describe, expect, it } from "vitest";
import { candidates, FIX_LIST_CAP, guideStanding, rankGuideChannels } from "./guideFixSearch";
import type { GuideChannel } from "./model";

const ch = (id: string, name = id): GuideChannel => ({ id, name });
const names = (rows: GuideChannel[]) => rows.map((r) => r.name);

const GUIDE = [
  ch("a.bbc2", "BBC Two"),
  ch("espn2.us", "ESPN 2"),
  ch("espn.us", "ESPN"),
  ch("sky.sports.news", "Sky Sports News"),
  ch("skysp.pl", "Sky Sports Main Event"),
  ch("zzz", "Zed Channel"),
  ch("espnu.us", "ESPN U"),
];

describe("what the dialog opens on", () => {
  it("is the closest names to the channel's own, quality badge and country prefix ignored", () => {
    const { rows } = rankGuideChannels(candidates(GUIDE), "US: ESPN FHD", "");
    // ESPN has nothing more than the shared word; ESPN 2 and ESPN U each have one.
    expect(names(rows).slice(0, 3)).toEqual(["ESPN", "ESPN 2", "ESPN U"]);
  });

  it("puts the most words in common first", () => {
    const { rows } = rankGuideChannels(candidates(GUIDE), "UK: Sky Sports Main Event HD", "");
    expect(names(rows)[0]).toBe("Sky Sports Main Event");
    expect(names(rows)[1]).toBe("Sky Sports News");
  });

  it("follows the close ones with the rest, by name, when nothing is in common", () => {
    const { rows } = rankGuideChannels(candidates(GUIDE), "Nothing Alike", "");
    expect(names(rows)).toEqual([...names(GUIDE)].sort((a, b) => a.localeCompare(b)));
  });

  it("is capped, and says how many more there are", () => {
    const many = Array.from({ length: 130 }, (_, i) => ch(`c${i}`, `Channel ${i}`));
    const { rows, more } = rankGuideChannels(candidates(many), "Channel 7", "");
    expect(rows).toHaveLength(FIX_LIST_CAP);
    expect(more).toBe(80);
  });

  it("is empty for a guide with nothing in it", () => {
    expect(rankGuideChannels([], "ESPN", "")).toEqual({ rows: [], more: 0 });
  });
});

describe("searching", () => {
  it("narrows to the channels whose name or id holds every word", () => {
    const all = candidates(GUIDE);
    expect(names(rankGuideChannels(all, "x", "sky sports").rows).sort()).toEqual([
      "Sky Sports Main Event",
      "Sky Sports News",
    ]);
    // By id, which is what a provider's own list shows.
    expect(names(rankGuideChannels(all, "x", "espn2.us").rows)).toEqual(["ESPN 2"]);
    expect(rankGuideChannels(all, "x", "no such thing")).toEqual({ rows: [], more: 0 });
  });

  it("ignores case and the spaces around it", () => {
    expect(names(rankGuideChannels(candidates(GUIDE), "x", "  BBC  ").rows)).toEqual(["BBC Two"]);
  });

  it("puts a name that starts with it first, then one with it as a word, then anywhere", () => {
    const all = candidates([ch("3", "Outfox Sports"), ch("2", "Sports Fox"), ch("1", "Fox Sports")]);
    expect(names(rankGuideChannels(all, "x", "fox").rows)).toEqual(["Fox Sports", "Sports Fox", "Outfox Sports"]);
  });

  it("keeps the closeness to the channel inside a tier", () => {
    const all = candidates(GUIDE);
    // Both hold "espn" at the start of the name; the channel is ESPN 2.
    const { rows } = rankGuideChannels(all, "ESPN 2 HD", "espn");
    expect(names(rows)[0]).toBe("ESPN 2");
  });

  it("counts what the cap leaves out", () => {
    const many = Array.from({ length: 70 }, (_, i) => ch(`n${i}`, `News ${i}`));
    const { rows, more } = rankGuideChannels(candidates(many), "x", "news");
    expect(rows).toHaveLength(FIX_LIST_CAP);
    expect(more).toBe(20);
  });
});

describe("where a channel stands", () => {
  it("is fixed when the user chose a guide channel, whatever the provider gave", () => {
    expect(guideStanding(GUIDE, "espn.us", "espn2.us")).toEqual({ kind: "fixed", id: "espn2.us", name: "ESPN 2" });
  });

  it("names a fix by its id when the guide no longer has the channel", () => {
    expect(guideStanding(GUIDE, undefined, "gone.id")).toEqual({ kind: "fixed", id: "gone.id", name: "gone.id" });
  });

  it("is matched when the guide declares the provider's id, to the letter or as the parse reads it", () => {
    expect(guideStanding(GUIDE, "espn.us", undefined)).toEqual({ kind: "matched", id: "espn.us", name: "ESPN" });
    expect(guideStanding(GUIDE, "  ESPN.US ", undefined)).toEqual({ kind: "matched", id: "espn.us", name: "ESPN" });
  });

  it("is none when the provider gave nothing, or an id the guide does not have", () => {
    expect(guideStanding(GUIDE, undefined, undefined)).toEqual({ kind: "none" });
    expect(guideStanding(GUIDE, "nowhere.tv", undefined)).toEqual({ kind: "none" });
  });
});
