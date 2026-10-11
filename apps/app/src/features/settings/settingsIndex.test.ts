import { describe, expect, it } from "vitest";
import { SETTINGS_INDEX, findSettings, settingById } from "./settingsIndex";
import { SETTINGS_PAGES } from "./settingsTab";

const ids = (q: string, limit = 50) => findSettings(q, limit).map((r) => r.id);

describe("SETTINGS_INDEX", () => {
  it("has one row per id", () => {
    const all = SETTINGS_INDEX.map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("files every row on a page Settings has", () => {
    const pages = SETTINGS_PAGES.map((p) => p.key as string);
    for (const r of SETTINGS_INDEX) expect(pages, r.id).toContain(r.page);
  });

  it("gives a world only to a row on a page with a pill", () => {
    // Sources and Appearance are the two pages with a Live TV / Stream pill.
    for (const r of SETTINGS_INDEX)
      if (r.world) expect(["sources", "appearance"], r.id).toContain(r.page);
  });

  it("keeps a label and lowercase keywords on every row", () => {
    for (const r of SETTINGS_INDEX) {
      expect(r.label.trim(), r.id).not.toBe("");
      for (const k of r.keywords) expect(k, `${r.id}: ${k}`).toBe(k.trim().toLowerCase());
    }
  });

  it("is looked up by id", () => {
    expect(settingById("preferred-language")?.page).toBe("playback");
    expect(settingById("nope")).toBeUndefined();
  });
});

describe("findSettings", () => {
  it("finds nothing for nothing", () => {
    expect(findSettings("", 5)).toEqual([]);
    expect(findSettings("   ", 5)).toEqual([]);
  });

  it("finds nothing for a word no row has", () => {
    expect(findSettings("zzzz", 5)).toEqual([]);
  });

  it("finds a row by a keyword the label lacks", () => {
    expect(ids("subtitle")).toEqual(["preferred-language"]);
  });

  it("is not fussy about case or the space around it", () => {
    expect(ids("  SUBTITLE ")).toEqual(ids("subtitle"));
    expect(ids("Row Size")).toEqual(ids("row size"));
  });

  it("finds the Up Next and Skipping rows by what a person would type", () => {
    // "autoplay" is the label's first word here and a keyword on One-Click
    // Play, so the label comes first.
    expect(ids("autoplay").slice(0, 2)).toEqual(["autoplay-next", "one-click-play"]);
    expect(ids("binge")).toEqual(["autoplay-next"]);
    expect(ids("countdown")).toEqual(["autoplay-next"]);
    expect(ids("up next")[0]).toBe("up-next-card");
    expect(ids("corner")).toEqual(["up-next-card"]);
    expect(ids("auto skip")).toEqual(["skipping"]);
    expect(ids("automatic")).toEqual(["skipping"]);
    // The old Skip Behavior words still find it.
    for (const q of ["skip", "intro", "recap", "preview", "chapters", "outro"]) expect(ids(q), q).toContain("skipping");
    expect(settingById("skip-behavior")).toBeUndefined();
  });

  it("finds a label by its own words", () => {
    expect(ids("row size")[0]).toBe("row-size");
    expect(ids("channel numbers")[0]).toBe("channel-numbers");
    expect(ids("trakt")).toEqual(["trakt"]);
    expect(ids("clear")[0]).toBe("clear-logins");
  });

  it("puts a label that starts with the query before one that contains it", () => {
    // "Appearance" starts with it, "Reset Appearance" only contains it.
    const got = ids("appearance");
    expect(got.indexOf("color-mode")).toBeGreaterThanOrEqual(0);
    expect(got.indexOf("color-mode")).toBeLessThan(got.indexOf("reset-appearance"));
  });

  it("puts a label that contains the query before a keyword that does", () => {
    // "up": Updates starts with it, Startup Tab contains it, and Replay
    // Onboarding has it only in a keyword ("setup").
    const got = ids("up");
    const at = (id: string) => got.indexOf(id);
    expect(at("updates")).toBeGreaterThanOrEqual(0);
    expect(at("startup-tab")).toBeGreaterThan(at("updates"));
    expect(at("replay-onboarding")).toBeGreaterThan(at("startup-tab"));
  });

  it("holds the three bands in order for any query, and the registry's order inside each", () => {
    const band = (id: string, q: string) => {
      const label = settingById(id)!.label.toLowerCase();
      return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
    };
    for (const q of ["a", "c", "up", "hero", "sync", "o", "log", "re", "pla", "time", "set"]) {
      const got = ids(q);
      expect(got.length, q).toBeGreaterThan(0);
      const bands = got.map((id) => band(id, q));
      expect(bands, q).toEqual([...bands].sort((a, b) => a - b));
      const order = SETTINGS_INDEX.map((r) => r.id);
      for (const b of [0, 1, 2]) {
        const inBand = got.filter((id) => band(id, q) === b).map((id) => order.indexOf(id));
        expect(inBand, `${q} band ${b}`).toEqual([...inBand].sort((x, y) => x - y));
      }
    }
  });

  it("keeps a row in one place in the list however many ways it matches", () => {
    // "sync" is a keyword on three rows and a label on none.
    expect(ids("sync")).toEqual(["aiostreams", "trakt", "mal"]);
    const hero = ids("hero");
    expect(new Set(hero).size).toBe(hero.length);
  });

  it("stops at the limit, keeping the best", () => {
    const all = ids("a");
    expect(all.length).toBeGreaterThan(5);
    expect(findSettings("a", 5).map((r) => r.id)).toEqual(all.slice(0, 5));
    expect(findSettings("a", 1)).toHaveLength(1);
    expect(findSettings("a", 0)).toEqual([]);
  });
});
