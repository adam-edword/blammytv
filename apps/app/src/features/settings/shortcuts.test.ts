import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, chordText } from "./shortcuts";

describe("SHORTCUT_GROUPS", () => {
  it("has groups, each with something in it, under its own title", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title.trim(), "a title").not.toBe("");
      expect(g.shortcuts.length, g.title).toBeGreaterThan(0);
    }
    const titles = SHORTCUT_GROUPS.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("opens with Anywhere and names the places the code has keys in", () => {
    expect(SHORTCUT_GROUPS[0].title).toBe("Anywhere");
    const titles = SHORTCUT_GROUPS.map((g) => g.title);
    for (const t of ["Every Player", "Live TV Player", "Stream Player", "Sports Player", "Multi-View"])
      expect(titles, t).toContain(t);
  });

  it("never lists a key twice in one group, however many ways each entry has", () => {
    for (const g of SHORTCUT_GROUPS) {
      const seen = new Map<string, string>();
      for (const s of g.shortcuts) {
        for (const chord of s.keys) {
          const k = chordText(chord).toLowerCase();
          expect(seen.has(k), `${g.title}: ${k} is "${seen.get(k)}" and "${s.what}"`).toBe(false);
          seen.set(k, s.what);
        }
      }
    }
  });

  it("gives every entry a way to press it and a line to say what it does", () => {
    for (const g of SHORTCUT_GROUPS) {
      for (const s of g.shortcuts) {
        expect(s.what.trim(), g.title).not.toBe("");
        expect(s.keys.length, s.what).toBeGreaterThan(0);
        for (const chord of s.keys) {
          expect(chord.length, s.what).toBeGreaterThan(0);
          for (const k of chord) expect(k.trim(), `${s.what}: a key`).not.toBe("");
        }
      }
    }
  });

  it("says what each key does once in a group, so a line is never two entries", () => {
    for (const g of SHORTCUT_GROUPS) {
      const what = g.shortcuts.map((s) => s.what);
      expect(new Set(what).size, g.title).toBe(what.length);
    }
  });

  it("writes a chord as its keys joined with +", () => {
    expect(chordText(["Ctrl", "K"])).toBe("Ctrl+K");
    expect(chordText(["Esc"])).toBe("Esc");
  });
});
