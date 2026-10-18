import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage and a window that only hears events: the unit
// tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const bus = new EventTarget();
vi.stubGlobal("window", bus);

import { commitDraft, folderLabel, isDirty, kindsOffered, pickId, reordered, rowsOf, stagedOf, toggled, type Draft } from "./staging";
import { loadPicks, setPicks, XT_CHANGED, type XtPick } from "./store";
import type { XtFolderView, XtLibraryView } from "./vod";

const m = (...ids: string[]): XtPick[] => ids.map((id) => ({ kind: "movie", id }));
const sh = (...ids: string[]): XtPick[] => ids.map((id) => ({ kind: "series", id }));
const ids = (picks: readonly XtPick[]) => picks.map(pickId);

const folder = (kind: "movie" | "series", id: string, name: string, posters: string[] = []): XtFolderView => ({ kind, id, name, posters });
const LIB: XtLibraryView = {
  id: "a",
  name: "Alpha",
  folders: [folder("movie", "11", "4K Movies"), folder("movie", "12", "Action"), folder("series", "12", "Drama"), folder("series", "13", "Sitcoms")],
};

let said = 0;
bus.addEventListener(XT_CHANGED, () => said++);
beforeEach(() => {
  mem.clear();
  said = 0;
});

describe("toggled", () => {
  it("adds a folder at the end, and takes it away when it is there", () => {
    expect(ids(toggled(m("11"), "series", "12"))).toEqual(["movie:11", "series:12"]);
    expect(ids(toggled([...m("11"), ...sh("12"), ...m("12")], "series", "12"))).toEqual(["movie:11", "movie:12"]);
  });

  it("tells a movie folder from a show folder with the same id", () => {
    expect(ids(toggled(m("12"), "series", "12"))).toEqual(["movie:12", "series:12"]);
    expect(ids(toggled([...m("12"), ...sh("12")], "movie", "12"))).toEqual(["series:12"]);
  });

  it("leaves what it was given alone", () => {
    const now = m("11");
    toggled(now, "movie", "12");
    expect(now).toEqual(m("11"));
  });
});

describe("reordered", () => {
  it("puts the shown picks in the new order", () => {
    const now = [...m("11"), ...sh("12"), ...m("12")];
    expect(ids(reordered(now, [...m("12"), ...m("11"), ...sh("12")]))).toEqual(["movie:12", "movie:11", "series:12"]);
  });

  it("leaves a pick that is not shown where it is: the others are rearranged around it", () => {
    // series:99 is a folder the panel dropped, or an adult one while it is hidden.
    const now = [...m("11"), ...sh("99"), ...m("12"), ...sh("12")];
    const shown = [...m("11"), ...m("12"), ...sh("12")];
    expect(ids(reordered(now, [shown[2], shown[0], shown[1]]))).toEqual(["series:12", "series:99", "movie:11", "movie:12"]);
    expect(ids(reordered(now, shown))).toEqual(ids(now));
  });
});

describe("rowsOf", () => {
  it("is the staged picks that name a folder the library offers, in order, with the folder", () => {
    const rows = rowsOf(LIB, [...sh("13"), ...m("99"), ...m("12"), ...sh("99"), ...sh("12")]);
    expect(rows.map((r) => [pickId(r.pick), r.folder.name])).toEqual([
      ["series:13", "Sitcoms"],
      ["movie:12", "Action"],
      ["series:12", "Drama"],
    ]);
  });

  it("is none for no picks", () => {
    expect(rowsOf(LIB, [])).toEqual([]);
  });
});

describe("kindsOffered, folderLabel", () => {
  it("names the lists that have a folder, across libraries", () => {
    expect(kindsOffered([LIB])).toEqual(["movie", "series"]);
    expect(kindsOffered([{ ...LIB, folders: [folder("series", "1", "Drama")] }])).toEqual(["series"]);
    expect(kindsOffered([{ ...LIB, folders: [folder("movie", "1", "A")] }, { ...LIB, id: "b", folders: [folder("series", "1", "B")] }])).toEqual(["movie", "series"]);
    expect(kindsOffered([{ ...LIB, folders: [] }])).toEqual([]);
    expect(kindsOffered([])).toEqual([]);
  });

  it("calls a folder by its name and its list, and with several playlists whose", () => {
    expect(folderLabel(LIB.folders[1], LIB, false)).toBe("Action, Movies");
    expect(folderLabel(LIB.folders[2], LIB, true)).toBe("Drama, Shows, Alpha");
  });
});

// A view's whole life against the store, as useStaging runs it: edit the draft,
// then the view's button writes it (commit) or the view goes (discard).
describe("a draft", () => {
  const edit = (d: Draft, pid: string, next: (now: readonly XtPick[]) => readonly XtPick[]): Draft => ({ ...d, [pid]: next(stagedOf(d, pid)) });

  it("reads the store as it stands for a playlist nobody edited", () => {
    setPicks("a", m("12"));
    expect(stagedOf({}, "a")).toEqual(m("12"));
    setPicks("a", m("11"));
    expect(stagedOf({}, "a")).toEqual(m("11"));
  });

  it("changes nothing in the store while it is edited, and says nothing", () => {
    setPicks("a", m("11"));
    said = 0;
    let d: Draft = {};
    d = edit(d, "a", (now) => toggled(now, "movie", "12"));
    d = edit(d, "a", (now) => toggled(now, "series", "13"));
    d = edit(d, "a", (now) => toggled(now, "movie", "11"));
    expect(ids(stagedOf(d, "a"))).toEqual(["movie:12", "series:13"]);
    expect(loadPicks("a")).toEqual(m("11"));
    expect(said).toBe(0);
    expect(mem.get("blammytv.xtVod")).toBe(JSON.stringify({ v: 1, data: { a: { picks: m("11") } } }));
  });

  it("is dirty only when it differs from the store, and not once it is back", () => {
    setPicks("a", m("11"));
    expect(isDirty({})).toBe(false);
    let d: Draft = edit({}, "a", (now) => toggled(now, "movie", "12"));
    expect(isDirty(d)).toBe(true);
    d = edit(d, "a", (now) => toggled(now, "movie", "12"));
    expect(isDirty(d)).toBe(false);
    d = edit(d, "a", (now) => reordered(now, now));
    expect(isDirty(d)).toBe(false);
  });

  it("is dirty for an order alone", () => {
    setPicks("a", m("11", "12"));
    expect(isDirty(edit({}, "a", (now) => reordered(now, [now[1], now[0]])))).toBe(true);
  });

  it("is written by its button: the store gets the order, once, and says so", () => {
    setPicks("a", m("11"));
    said = 0;
    const d = edit(edit({}, "a", (now) => toggled(now, "series", "13")), "a", (now) => reordered(now, [now[1], now[0]]));
    commitDraft(d);
    expect(ids(loadPicks("a"))).toEqual(["series:13", "movie:11"]);
    expect(said).toBe(1);
    expect(isDirty(d)).toBe(false);
  });

  it("writes nothing for a playlist whose draft is what is stored", () => {
    setPicks("a", m("11"));
    said = 0;
    commitDraft({ a: m("11") });
    expect(said).toBe(0);
  });

  it("touches only the playlists that were edited", () => {
    setPicks("a", m("11"));
    setPicks("b", m("12"));
    commitDraft(edit({}, "a", (now) => toggled(now, "movie", "12")));
    expect(ids(loadPicks("a"))).toEqual(["movie:11", "movie:12"]);
    expect(ids(loadPicks("b"))).toEqual(["movie:12"]);
  });

  it("is gone when discarded: an empty draft is the store again", () => {
    setPicks("a", m("11"));
    const d = edit({}, "a", (now) => toggled(now, "movie", "12"));
    expect(ids(stagedOf(d, "a"))).toEqual(["movie:11", "movie:12"]);
    const discarded: Draft = {};
    expect(stagedOf(discarded, "a")).toEqual(m("11"));
    expect(isDirty(discarded)).toBe(false);
    expect(loadPicks("a")).toEqual(m("11"));
  });

  it("keeps a pick the library does not show, through an edit and a commit", () => {
    // series:99 is not offered (an adult folder while adult content is hidden).
    setPicks("a", [...m("11"), ...sh("99")]);
    const d = edit({}, "a", (now) => toggled(now, "movie", "12"));
    commitDraft(d);
    expect(ids(loadPicks("a"))).toEqual(["movie:11", "series:99", "movie:12"]);
  });
});
