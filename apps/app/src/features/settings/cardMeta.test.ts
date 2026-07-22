import { describe, expect, it } from "vitest";
import { cardMetaLine, loadCardMeta } from "./cardMeta";

describe("cardMeta", () => {
  it("defaults to the classic rating · year · runtime line", () => {
    expect(loadCardMeta()).toEqual(["rating", "year", "runtime"]);
  });

  it("builds the line from enabled fields, skipping missing values", () => {
    const parts = {
      rating: 8.456,
      year: 2008,
      runtimeMin: 169,
      genre: "Drama",
      kind: "series" as const,
    };
    expect(cardMetaLine(["rating", "year", "runtime"], parts)).toBe(
      "8.5 · 2008 · 169 min",
    );
    expect(cardMetaLine(["year", "genre", "kind"], parts)).toBe(
      "2008 · Drama · Series",
    );
    // A catalog preview usually has no runtime — the slot just drops out.
    expect(
      cardMetaLine(["rating", "runtime"], { rating: 7.1 }),
    ).toBe("7.1");
    expect(cardMetaLine([], parts)).toBe("");
    expect(cardMetaLine(["kind"], { kind: "movie" })).toBe("Movie");
  });
});
