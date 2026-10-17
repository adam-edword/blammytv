import { describe, expect, it } from "vitest";
import { parseName } from "./names";

describe("a provider's name", () => {
  it("loses its leading quality tag and trailing year, which become the quality and the year", () => {
    expect(parseName("4K The Fantastic 4: First Steps (2025)")).toEqual({
      title: "The Fantastic 4: First Steps",
      year: 2025,
      quality: "4K",
    });
    expect(parseName("'Allo 'Allo! (1984)")).toEqual({ title: "'Allo 'Allo!", year: 1984, quality: null });
  });

  it("reads every tag the panels write, bare or in brackets, with a space or a separator", () => {
    const cases: [string, string, string | null][] = [
      ["UHD The Movie", "The Movie", "4K"],
      ["FHD The Movie", "The Movie", "FHD"],
      ["2160p The Movie", "The Movie", "4K"],
      ["1080p The Movie", "The Movie", "FHD"],
      ["720p The Movie", "The Movie", "HD"],
      ["[4K] The Movie", "The Movie", "4K"],
      ["(FHD) The Movie", "The Movie", "FHD"],
      ["[HD]The Movie", "The Movie", "HD"],
      ["HD | The Movie", "The Movie", "HD"],
      ["HD - The Movie", "The Movie", "HD"],
      ["HD: The Movie", "The Movie", "HD"],
      ["HDR | The Movie", "The Movie", "HDR"],
      ["4K | The Movie", "The Movie", "4K"],
      ["4K - The Movie", "The Movie", "4K"],
      ["4K: The Movie", "The Movie", "4K"],
      ["4k the movie", "the movie", "4K"],
      ["4K \u2013 The Movie", "The Movie", "4K"], // en dash
      ["HD \u2014 The Movie", "The Movie", "HD"], // em dash
      ["SD - The Movie", "The Movie", "SD"],
      ["[SD] The Movie", "The Movie", "SD"],
    ];
    for (const [raw, title, quality] of cases) expect(parseName(raw), raw).toMatchObject({ title, quality });
  });

  it("reads more than one tag, the best of them first", () => {
    expect(parseName("4K UHD HDR The Movie (2024)")).toEqual({ title: "The Movie", year: 2024, quality: "4K" });
    expect(parseName("[FHD] [HDR] The Movie")).toMatchObject({ title: "The Movie", quality: "HDR" });
    // After one tag the next is a tag, word or not: there is no title yet.
    expect(parseName("4K HDR The Movie")).toMatchObject({ title: "The Movie", quality: "4K" });
    // ...but a tag that is not first still needs the first to be one.
    expect(parseName("The HDR Movie")).toMatchObject({ title: "The HDR Movie", quality: null });
  });

  // These keep every word they have. Each is a real kind of title: a number
  // that is not a tag, and a tag-like word that is the title's own.
  it("keeps the words a title needs", () => {
    for (const title of [
      "The 4400", // 4400 is not a tag
      "4 Weddings and a Funeral", // 4 is not 4K
      "Fantastic 4", // a 4 at the end
      "HD Radio Story", // HD is a word here: no separator, no brackets
      "SD Gundam", // likewise
      "HDR Explained", // likewise
      "HD-DVD Collection", // a hyphen with no space is a hyphen
      "4Kids Presents", // 4K glued to a word is not the tag
      "UHD", // a name that is only a tag has no title without it
      "4K",
    ]) {
      const parsed = parseName(title);
      expect(parsed.title, title).toBe(title);
      expect(parsed.quality, title).toBeNull();
    }
  });

  it("takes a tag that is not a word at the front for the tag it is, even where it could be a title's", () => {
    expect(parseName("1080p Resolution Report")).toMatchObject({ title: "Resolution Report", quality: "FHD" });
  });

  it("takes a trailing year only when it is one", () => {
    expect(parseName("Blade Runner 2049")).toEqual({ title: "Blade Runner 2049", quality: null });
    expect(parseName("The Movie (2160)")).toEqual({ title: "The Movie (2160)", quality: null });
    expect(parseName("The Movie (1080)")).toEqual({ title: "The Movie (1080)", quality: null });
    expect(parseName("(2025)")).toEqual({ title: "(2025)", quality: null }); // a year alone is the whole name
    expect(parseName("2012 (2009)")).toEqual({ title: "2012", year: 2009, quality: null });
    expect(parseName("The Movie (2025) Extended")).toEqual({ title: "The Movie (2025) Extended", quality: null });
  });

  it("collapses the whitespace a panel leaves in", () => {
    expect(parseName("  4K   The   Movie  (2025) ")).toEqual({ title: "The Movie", year: 2025, quality: "4K" });
  });

  it("is empty for an empty name", () => {
    expect(parseName("")).toEqual({ title: "", quality: null });
  });
});
