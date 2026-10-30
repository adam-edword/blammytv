import { describe, expect, it } from "vitest";
import sample from "./fixtures/strand-sample.json";
import type { HomeRow } from "./layout";
import { importStrand } from "./strand";

const text = (x: unknown) => JSON.stringify(x);
const ids = (rows: readonly HomeRow[]) => rows.map((r) => r.id);

const HOME: HomeRow[] = [
  { id: "carousel", kind: "carousel", on: true },
  { id: "continue", kind: "continue", on: true },
  { id: "upnext", kind: "upnext", on: true },
  { id: "aio:top", kind: "catalog", on: true },
];
const LISTS = [{ id: "l1", name: "My List" }];
const WITH_TRAKT = [...LISTS, { id: "__trakt", name: "Trakt Watchlist" }];

describe("importStrand, on Adam's sample", () => {
  it("adds five rows after the ones already on Home, in Strand's order: Continue Watching is already there", () => {
    const out = importStrand(text(sample), HOME, WITH_TRAKT)!;
    expect(out.added).toBe(5);
    expect(out.already).toBe(1);
    expect(ids(out.rows)).toEqual([
      ...ids(HOME),
      "saved:__trakt",
      "trakt:trending_movies",
      "trakt:trending_shows",
      "trakt:popular_movies",
      "trakt:popular_shows",
    ]);
    expect(out.rows.filter((r) => r.kind === "continue")).toHaveLength(1);
  });

  it("maps each to the right kind, with Strand's title and switch", () => {
    const out = importStrand(text(sample), HOME, WITH_TRAKT)!;
    const added = out.rows.slice(HOME.length);
    expect(added.map((r) => r.kind)).toEqual(["saved", "trakt", "trakt", "trakt", "trakt"]);
    expect(added.map((r) => r.on)).toEqual([true, true, true, true, true]);
    // The watchlist is titled "Watchlist", which is not the list's own name; the Trakt rows are
    // titled as they are already named, so they carry no title of their own.
    expect(added.map((r) => r.title)).toEqual(["Watchlist", undefined, undefined, undefined, undefined]);
    expect(added.slice(1).map((r) => (r.kind === "trakt" ? r.list : null))).toEqual([
      "trending_movies",
      "trending_shows",
      "popular_movies",
      "popular_shows",
    ]);
  });

  it("points the watchlist at the Trakt Watchlist when there is one, else the first list", () => {
    const withTrakt = importStrand(text(sample), HOME, WITH_TRAKT)!.rows.find((r) => r.kind === "saved");
    expect(withTrakt).toMatchObject({ list: "__trakt" });
    const without = importStrand(text(sample), HOME, LISTS)!.rows.find((r) => r.kind === "saved");
    expect(without).toMatchObject({ id: "saved:l1", list: "l1" });
  });

  it("does not add Continue Watching, and leaves it on when Strand has it on", () => {
    const out = importStrand(text([sample[0]]), HOME, LISTS)!;
    expect(out.added).toBe(0);
    expect(out.rows).toEqual(HOME);
  });

  it("switches Continue Watching off when Strand has it off, and never on", () => {
    const off = { ...sample[0], isEnabled: false };
    expect(importStrand(text([off]), HOME, LISTS)!.rows.find((r) => r.kind === "continue")?.on).toBe(false);
    const wasOff = HOME.map((r) => (r.kind === "continue" ? { ...r, on: false } : r));
    expect(importStrand(text([sample[0]]), wasOff, LISTS)!.rows.find((r) => r.kind === "continue")?.on).toBe(false);
  });

  it("keeps the name Continue Watching has, whatever Strand calls it", () => {
    const renamed = HOME.map((r) => (r.kind === "continue" ? { ...r, title: "Pick Up" } : r));
    const out = importStrand(text([{ ...sample[0], title: "Resume" }]), renamed, LISTS)!;
    expect(out.rows.find((r) => r.kind === "continue")?.title).toBe("Pick Up");
  });

  it("adds nothing the second time", () => {
    const first = importStrand(text(sample), HOME, WITH_TRAKT)!;
    const again = importStrand(text(sample), first.rows, WITH_TRAKT)!;
    expect(again.added).toBe(0);
    expect(again.already).toBe(6);
    expect(again.rows).toEqual(first.rows);
  });

  it("orders by sortOrder, not by where a row is in the file", () => {
    const shuffled = [sample[5], sample[2], sample[0], sample[3]];
    const out = importStrand(text(shuffled), HOME, LISTS)!;
    expect(ids(out.rows.slice(HOME.length))).toEqual(["trakt:trending_movies", "trakt:trending_shows", "trakt:popular_shows"]);
  });
});

describe("importStrand, rows that are not the sample's", () => {
  const odd = { id: "AAAA-1", isEnabled: false, sortOrder: 9, source: { collection: { _0: "marvel" } }, style: "row_large", title: "Marvel" };

  it("makes anything else a Needs a Source row that keeps Strand's row whole, titled and switched as Strand has it", () => {
    const out = importStrand(text([odd]), HOME, LISTS)!;
    expect(out.added).toBe(1);
    expect(out.rows.at(-1)).toEqual({ id: "needs:AAAA-1", kind: "needs", on: false, title: "Marvel", strand: odd });
  });

  it("does the same for a Trakt list we do not have, and a watchlist with no list to point at", () => {
    const rows = importStrand(
      text([
        { id: "T", sortOrder: 0, source: { traktBuiltIn: { _0: "anticipated_movies" } }, title: "Anticipated" },
        { id: "W", sortOrder: 1, source: { localWatchlist: {} }, title: "Watchlist" },
      ]),
      HOME,
      [],
    )!.rows.slice(HOME.length);
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ["needs", "needs:T"],
      ["needs", "needs:W"],
    ]);
  });

  it("fills a watchlist's Needs row in place when a list exists by the second import, not a second copy of it", () => {
    const file = text([{ id: "W", sortOrder: 0, source: { localWatchlist: {} }, title: "Watchlist" }]);
    // First, with no list: a Needs row. Then the person moves and switches it off, and a list appears.
    const first = importStrand(file, HOME, [])!.rows;
    const tuned = first.map((r) => (r.id === "needs:W" ? { ...r, on: false, title: "Mine" } : r));
    const rows = [...tuned.slice(0, 4), { id: "trakt:popular_movies", kind: "trakt", list: "popular_movies", on: true } as HomeRow, tuned[4]];
    const out = importStrand(file, rows, LISTS)!;
    expect(out.added).toBe(0);
    expect(ids(out.rows)).toEqual([...ids(HOME), "trakt:popular_movies", "saved:l1"]);
    expect(out.rows.at(-1)).toEqual({ id: "saved:l1", kind: "saved", list: "l1", on: false, title: "Mine" });
  });

  it("leaves a Needs row alone when the list's Saved row is already on Home", () => {
    const file = text([{ id: "W", source: { localWatchlist: {} }, title: "Watchlist" }]);
    const rows: HomeRow[] = [
      ...HOME,
      { id: "needs:W", kind: "needs", on: true, title: "Watchlist", strand: {} },
      { id: "saved:l1", kind: "saved", list: "l1", on: true },
    ];
    const out = importStrand(file, rows, LISTS)!;
    expect(ids(out.rows)).toEqual(ids(rows));
    expect(out.added).toBe(0);
  });

  it("gives a row with no title a name, and one with no id an id of its own", () => {
    const out = importStrand(text([{ source: { x: {} } }, { source: { y: {} } }]), HOME, LISTS)!;
    const added = out.rows.slice(HOME.length);
    expect(added.map((r) => (r.kind === "needs" ? r.title : null))).toEqual(["Untitled Row", "Untitled Row"]);
    expect(new Set(ids(added)).size).toBe(2);
  });

  it("leaves a row too big to keep out, and the rest in", () => {
    const big = { id: "BIG", source: { x: {} }, pad: "x".repeat(5000) };
    const out = importStrand(text([big, odd]), HOME, LISTS)!;
    expect(ids(out.rows.slice(HOME.length))).toEqual(["needs:AAAA-1"]);
  });

  it("adds a Trakt row once, though Strand lists it twice, and a switched-off one stays off", () => {
    const t = { source: { traktBuiltIn: { _0: "popular_movies" } }, title: "Popular Movies" };
    const out = importStrand(text([{ ...t, sortOrder: 0, id: "1" }, { ...t, sortOrder: 1, id: "2", isEnabled: false }]), HOME, LISTS)!;
    expect(out.added).toBe(1);
    expect(out.already).toBe(1);
    expect(out.rows.at(-1)).toMatchObject({ id: "trakt:popular_movies", on: false });
  });

  it("gives a Trakt row Strand's title when it is not the row's own name", () => {
    const out = importStrand(text([{ source: { traktBuiltIn: { _0: "trending_shows" } }, title: "Hot Right Now" }]), HOME, LISTS)!;
    expect(out.rows.at(-1)).toMatchObject({ kind: "trakt", title: "Hot Right Now" });
  });
});

describe("importStrand, text that is not a Strand layout", () => {
  it.each([
    ["words", "this is not json"],
    ["an empty box", ""],
    ["an object", text({ rows: sample })],
    ["a number", "7"],
    ["an empty list", "[]"],
    ["a list of numbers", "[1,2,3]"],
    ["rows with no source", text([{ id: "x", title: "A" }])],
    ["a source that is not an object", text([{ source: "continueWatching" }])],
    ["null", "null"],
  ])("is refused: %s", (_name, input) => {
    expect(importStrand(input, HOME, LISTS)).toBeNull();
  });

  it("takes a list that has one good row among rows that are not", () => {
    const out = importStrand(text([7, null, "x", { source: { traktBuiltIn: { _0: "popular_shows" } } }]), HOME, LISTS)!;
    expect(out.added).toBe(1);
  });
});
