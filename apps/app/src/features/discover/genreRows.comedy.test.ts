import { describe, expect, it } from "vitest";
import type { VodItem } from "../stream/model";
import sample from "./fixtures/comedy-sample.json";
import {
  buildRows,
  noteAppearances,
  orderMeaningful,
  rankCards,
  type Appearances,
} from "./genreRows";

/**
 * Adam's real Comedy (1.0.31): the cards the addon sent, genres in the order it
 * sent them, and where each was seen. The ids are the titles.
 */
const pool: VodItem[] = sample.cards.map((c) => ({
  id: c.title,
  title: c.title,
  kind: c.kind as VodItem["kind"],
  rating: c.rating,
  genres: c.genres,
  cast: [],
  seasons: [],
}));
const appear: Appearances = new Map();
sample.cards.forEach((c, i) => {
  for (const at of c.from) {
    const [cat, place] = at.split("#");
    noteAppearances(appear, cat, Number(place) - 1, [pool[i]]);
  }
});

const rows = buildRows(pool, "Comedy", "all", appear);
const row = (title: string) => rows.find((r) => r.title === title);
const titlesIn = (title: string) => (row(title)?.all ?? []).map((i) => i.title);
const mixRows = rows.filter((r) => r.id.startsWith("mix:"));
const rankOf = (order: VodItem[], title: string) => order.findIndex((i) => i.title === title);

describe("Comedy as the addon sent it", () => {
  it("lists genres in a meaningful order, not alphabetical", () => {
    expect(orderMeaningful(pool)).toBe(true);
  });

  it("ranks a title that leads with Comedy above one that tucks it third", () => {
    const ranked = rankCards(pool, appear, { genre: "Comedy", ordered: true });
    const pulp = rankOf(ranked, "Pulp Fiction");
    for (const t of ["Forrest Gump", "Life Is Beautiful", "Parasite", "Ted Lasso"])
      expect(rankOf(ranked, t), t).toBeLessThan(pulp);
  });

  it("without the order, the count tier sinks Ted Lasso under a one-genre title", () => {
    const ranked = rankCards(pool, appear, { genre: "Comedy", ordered: false });
    expect(rankOf(ranked, "Ted Lasso")).toBeGreaterThan(rankOf(ranked, "The Dink"));
  });

  it("puts every anime title in Anime Comedy and in no other mix", () => {
    const anime = pool.filter((i) => i.genres.includes("Anime")).map((i) => i.title);
    expect(anime.length).toBeGreaterThan(5);
    expect(titlesIn("Anime Comedy").sort()).toEqual(anime.sort());
    for (const r of mixRows.filter((r) => r.title !== "Anime Comedy"))
      for (const t of anime) expect(ids(r.all), `${t} in ${r.title}`).not.toContain(t);
  });

  it("makes Romantic Comedy from titles whose first co-genre is Romance", () => {
    const romantic = titlesIn("Romantic Comedy");
    for (const t of ["Fly Me to the Moon", "Singin' in the Rain", "Amélie"])
      expect(romantic).toContain(t);
    expect(romantic).not.toContain("Forrest Gump"); // its first co-genre is Drama
    expect(romantic).not.toContain("Kaguya-sama: Love Is War"); // Anime wins
  });

  it("puts a title in no mix when its only other tags are not genres", () => {
    const inMix = new Set(mixRows.flatMap((r) => ids(r.all)));
    expect(inMix.has("Taskmaster")).toBe(false); // Game Show
    expect(inMix.has("Last Week Tonight with John Oliver")).toBe(false); // News, Talk Show
  });

  it("puts a title in one mix row at most", () => {
    const all = mixRows.flatMap((r) => ids(r.all));
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives Just Comedy only the titles that are only Comedy", () => {
    expect(titlesIn("Just Comedy").sort()).toEqual(
      pool.filter((i) => i.genres.length === 1).map((i) => i.title).sort(),
    );
  });
});

describe("a pool whose genres are alphabetical", () => {
  const card = (id: string, genres: string[]): VodItem => ({
    id,
    title: id,
    kind: "movie",
    genres,
    cast: [],
    seasons: [],
  });
  const alpha = [
    card("trio", ["Comedy", "Crime", "Drama"]),
    card("pair", ["Comedy", "Crime"]),
    card("solo", ["Comedy"]),
    card("pair2", ["Comedy", "Drama"]),
  ];

  it("is not meaningful", () => {
    expect(orderMeaningful(alpha)).toBe(false);
    expect(orderMeaningful([card("a", ["Comedy"])])).toBe(false);
    expect(orderMeaningful([])).toBe(false);
  });
  it("ranks by the count of genres, as it always has", () => {
    const out = rankCards(alpha, new Map(), { genre: "Comedy", ordered: orderMeaningful(alpha) });
    expect(out.map((i) => i.id)).toEqual(["solo", "pair", "pair2", "trio"]);
  });
  it("is meaningful from 30% of the multi-genre cards out of order", () => {
    const out = (n: number) =>
      [
        ...Array.from({ length: 10 - n }, (_, i) => card(`a${i}`, ["Comedy", "Drama"])),
        ...Array.from({ length: n }, (_, i) => card(`b${i}`, ["Drama", "Comedy"])),
      ];
    expect(orderMeaningful(out(2))).toBe(false);
    expect(orderMeaningful(out(3))).toBe(true);
  });
  it("ignores case when it checks the order", () => {
    expect(orderMeaningful([card("a", ["comedy", "Drama"]), card("b", ["Action", "comedy"])])).toBe(false);
  });
});

function ids(items: readonly VodItem[]): string[] {
  return items.map((i) => i.id);
}
