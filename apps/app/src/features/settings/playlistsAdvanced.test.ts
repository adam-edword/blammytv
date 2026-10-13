import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});
vi.stubGlobal("window", new EventTarget());

const {
  advancedOf,
  advancedProblems,
  hasAdvanced,
  loadPlaylists,
  savePlaylists,
  setPlaylistAdvanced,
} = await import("./playlists");
import type { Playlist } from "./playlists";
import { USER_AGENT_MAX } from "../../lib/userAgent";

const X: Playlist = { kind: "xtream", id: "a", name: "A", enabled: true, server: "http://s", username: "u", password: "p" };
const M: Playlist = { kind: "m3u", id: "b", name: "B", enabled: true, url: "http://m/p.m3u" };

beforeEach(() => mem.clear());

describe("the Advanced fields on a playlist", () => {
  it("an older save has neither, and reads as nothing in the form", () => {
    mem.set("blammytv.playlists", JSON.stringify({ v: 1, data: [X] }));
    const [p] = loadPlaylists();
    expect(p.extraGuide).toBeUndefined();
    expect(p.userAgent).toBeUndefined();
    expect(advancedOf(p)).toEqual({ extraGuide: "", userAgent: "" });
    expect(hasAdvanced(p)).toBe(false);
  });

  it("opens by itself when either is set, and not for blanks", () => {
    expect(hasAdvanced({ ...X, extraGuide: "https://e/g.xml" })).toBe(true);
    expect(hasAdvanced({ ...X, userAgent: "VLC/3" })).toBe(true);
    expect(hasAdvanced({ ...X, extraGuide: "  ", userAgent: "" })).toBe(false);
  });

  it("a save made by hand with the wrong kind of value does not throw on the way to the form", () => {
    const odd = { ...X, extraGuide: 5, userAgent: { a: 1 } } as unknown as Playlist;
    expect(advancedOf(odd)).toEqual({ extraGuide: "", userAgent: "" });
    expect(hasAdvanced(odd)).toBe(false);
  });

  it("round-trips through a save, on whichever kind of playlist", () => {
    savePlaylists(setPlaylistAdvanced([X, M], "b", { extraGuide: "https://e/g.xml", userAgent: "VLC/3" }));
    const [a, b] = loadPlaylists();
    expect(a).toEqual(X);
    expect(b).toMatchObject({ extraGuide: "https://e/g.xml", userAgent: "VLC/3" });
  });
});

describe("setPlaylistAdvanced", () => {
  it("sets the two fields on one playlist and touches no other", () => {
    const out = setPlaylistAdvanced([X, M], "a", { extraGuide: " https://e/g.xml ", userAgent: " VLC/3 " });
    expect(out[0]).toEqual({ ...X, extraGuide: "https://e/g.xml", userAgent: "VLC/3" });
    expect(out[1]).toBe(M);
  });

  it("takes a blank field off the playlist, so clearing both leaves it as it was", () => {
    const set = setPlaylistAdvanced([X], "a", { extraGuide: "https://e/g.xml", userAgent: "VLC/3" });
    const one = setPlaylistAdvanced(set, "a", { extraGuide: "", userAgent: "VLC/3" });
    expect("extraGuide" in one[0]).toBe(false);
    expect(one[0].userAgent).toBe("VLC/3");
    const none = setPlaylistAdvanced(one, "a", { extraGuide: "  ", userAgent: "" });
    expect(none[0]).toEqual(X);
    expect(Object.keys(none[0]).sort()).toEqual(Object.keys(X).sort());
  });

  it("leaves what else the playlist holds", () => {
    const hidden = { ...X, hiddenCategories: ["3"] };
    const out = setPlaylistAdvanced([hidden], "a", { extraGuide: "", userAgent: "VLC/3" });
    expect(out[0].hiddenCategories).toEqual(["3"]);
  });
});

describe("advancedProblems: the form's check", () => {
  const ok = { extraGuide: "https://example.com/guide.xml", userAgent: "VLC/3.0.20" };

  it("has none for empty fields, which is how they are cleared, and for good ones", () => {
    expect(advancedProblems({ extraGuide: "", userAgent: "" })).toEqual({});
    expect(advancedProblems({ extraGuide: "   ", userAgent: "   " })).toEqual({});
    expect(advancedProblems(ok)).toEqual({});
    expect(advancedProblems({ ...ok, extraGuide: "http://example.com/g.xml" })).toEqual({});
  });

  it("wants the extra guide to be an http or https address", () => {
    for (const bad of ["example.com/guide.xml", "ftp://example.com/g.xml", "file:///C:/g.xml", "javascript:alert(1)", "hello", "//example.com/g.xml"]) {
      const p = advancedProblems({ ...ok, extraGuide: bad });
      expect(p.extraGuide, bad).toMatch(/http/);
      expect(p.userAgent, bad).toBeUndefined();
    }
  });

  it("wants the agent to be plain text no longer than a header should carry", () => {
    for (const bad of ["a\nb", "caf\u00e9", "tab\there"]) {
      const p = advancedProblems({ ...ok, userAgent: bad });
      expect(p.userAgent, JSON.stringify(bad)).toMatch(/letters/i);
      expect(p.extraGuide).toBeUndefined();
    }
    const long = advancedProblems({ ...ok, userAgent: "a".repeat(USER_AGENT_MAX + 1) });
    expect(long.userAgent).toContain(String(USER_AGENT_MAX));
    expect(advancedProblems({ ...ok, userAgent: "a".repeat(USER_AGENT_MAX) })).toEqual({});
  });

  it("says both when both are wrong", () => {
    const p = advancedProblems({ extraGuide: "nope", userAgent: "a\nb" });
    expect(Object.keys(p).sort()).toEqual(["extraGuide", "userAgent"]);
  });
});
