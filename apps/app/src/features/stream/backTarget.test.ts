import { describe, expect, it } from "vitest";
import { wantsEpisodeList, type BackFrom } from "./backTarget";

const series = { id: "tt1", kind: "series" };
const film = { id: "tt2", kind: "movie" };
const sources: BackFrom = { at: "sources", episodeId: "e1", item: series };
const episodes: BackFrom = { at: "episodes", item: series };

describe("wantsEpisodeList", () => {
  it("lands the episode list when it was never shown", () => {
    // Continue Watching resumes an episode whose sources are all uncached,
    // so the app drops the user straight on this screen from the home rows.
    expect(wantsEpisodeList(sources, { at: "home" })).toBe(true);
    expect(wantsEpisodeList(sources, undefined)).toBe(true);
  });

  it("pops normally when the user drilled in", () => {
    // The episode list is on the stack; popping restores its scroll too.
    expect(wantsEpisodeList(sources, episodes)).toBe(false);
  });

  it("lands THIS series' list when the stack holds a different series'", () => {
    // The match is on id for a reason: some other show's episode list is not
    // the page above this one, so popping to it would be as wrong as popping
    // to the home rows.
    expect(
      wantsEpisodeList(sources, { at: "episodes", item: { id: "tt9", kind: "series" } }),
    ).toBe(true);
  });

  it("leaves a film's source list alone", () => {
    // No episodeId and no list above it, so Back is just Back.
    expect(wantsEpisodeList({ at: "sources", item: film }, { at: "home" })).toBe(false);
    expect(
      wantsEpisodeList({ at: "sources", episodeId: "e1", item: film }, { at: "home" }),
    ).toBe(false);
  });

  it("leaves every other screen alone", () => {
    expect(wantsEpisodeList({ at: "episodes", item: series }, { at: "home" })).toBe(false);
    expect(wantsEpisodeList({ at: "title", item: film }, { at: "home" })).toBe(false);
    expect(wantsEpisodeList({ at: "home" }, undefined)).toBe(false);
    expect(wantsEpisodeList(null, episodes)).toBe(false);
  });
});
