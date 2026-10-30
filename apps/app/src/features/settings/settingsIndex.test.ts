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
    // Subtitle Size's label starts with it (v0.11.29); Preferred Language has
    // it only as a keyword, so it comes second.
    expect(ids("subtitle")).toEqual(["subtitle-size", "preferred-language"]);
    expect(ids("dub")).toEqual(["preferred-language"]);
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
    // The Up Next card sits in a corner, and so does the pop-out (v0.11.29).
    expect(ids("corner")).toEqual(["up-next-card", "popout"]);
    expect(ids("auto skip")).toEqual(["skipping"]);
    expect(ids("automatic")).toEqual(["skipping"]);
    // The old Skip Behavior words still find it.
    for (const q of ["skip", "intro", "recap", "preview", "chapters", "outro"]) expect(ids(q), q).toContain("skipping");
    expect(settingById("skip-behavior")).toBeUndefined();
  });

  it("finds the player rows by what a person would type (P3b)", () => {
    expect(ids("audio channels")[0]).toBe("audio-channels");
    for (const q of ["surround", "5.1", "7.1", "stereo", "receiver", "speakers", "downmix"])
      expect(ids(q), q).toContain("audio-channels");
    // "audio" is a keyword on both Preferred Language and Speaker Setup (which
    // was Audio Channels until 0.12), so the registry's order decides.
    expect(ids("audio").slice(0, 2)).toEqual(["preferred-language", "audio-channels"]);

    expect(ids("subtitle size")[0]).toBe("subtitle-size");
    for (const q of ["subs", "captions", "font", "text size", "bigger"])
      expect(ids(q), q).toContain("subtitle-size");
    // The delay is a key in the player, not a setting; the row says where.
    expect(ids("delay")).toEqual(["subtitle-size"]);

    expect(ids("pop-out")[0]).toBe("popout");
    for (const q of ["popout", "pop out", "pip", "picture in picture", "window", "floating"])
      expect(ids(q), q).toContain("popout");
  });

  it("finds Pop Out Films and Shows In by what a person would type (plan 032)", () => {
    for (const q of ["vlc", "videolan", "external player", "pop out films"]) expect(ids(q), q).toContain("popout-app");
    expect(ids("vlc")).toEqual(["popout-app"]);
    // The pop-out's window still comes first for "pop-out".
    expect(ids("pop-out")[0]).toBe("popout");
  });

  it("files the player rows on Playback, under no pill", () => {
    for (const id of ["audio-channels", "subtitle-size", "popout", "popout-app"]) {
      const r = settingById(id);
      expect(r?.page, id).toBe("playback");
      expect(r?.world, id).toBeUndefined();
    }
  });

  it("finds the keyboard list and About by what a person would type (P4a)", () => {
    expect(ids("shortcuts")[0]).toBe("shortcuts");
    for (const q of ["keyboard", "keys", "hotkeys", "bindings"]) expect(ids(q), q).toContain("shortcuts");
    expect(ids("about")[0]).toBe("about");
    for (const q of ["mpv", "ffmpeg", "vulkan", "build"]) expect(ids(q), q).toContain("about");
    // "version" is a keyword on both, so the registry's order decides:
    // Updates, then About.
    expect(ids("version").slice(0, 2)).toEqual(["updates", "about"]);
    expect(settingById("shortcuts")?.page).toBe("app");
    expect(settingById("about")?.page).toBe("app");
    // The same page as the update row, between it and Replay Setup.
    const order = SETTINGS_INDEX.map((r) => r.id);
    expect(order.indexOf("updates")).toBeLessThan(order.indexOf("shortcuts"));
    expect(order.indexOf("shortcuts")).toBeLessThan(order.indexOf("about"));
    expect(order.indexOf("about")).toBeLessThan(order.indexOf("replay-onboarding"));
  });

  it("finds Copy Diagnostics by what a person would type (P4b)", () => {
    expect(ids("copy diag")[0]).toBe("copy-diagnostics");
    expect(ids("diagnostics")[0]).toBe("copy-diagnostics");
    for (const q of ["log", "logs", "support", "debug", "bug", "report", "privacy", "analytics", "telemetry", "clipboard"])
      expect(ids(q), q).toContain("copy-diagnostics");
    expect(settingById("copy-diagnostics")?.page).toBe("app");
    // On the page where it is drawn: after Replay Setup, and the one
    // destructive row stays last. Export and Import came between the two in
    // P4c, so Copy Diagnostics is now the third from last, not the second.
    const order = SETTINGS_INDEX.filter((r) => r.page === "app").map((r) => r.id);
    expect(order.indexOf("replay-onboarding")).toBeLessThan(order.indexOf("copy-diagnostics"));
    expect(order.at(-1)).toBe("clear-logins");
    expect(order.indexOf("copy-diagnostics")).toBe(order.length - 4);
  });

  it("finds Export and Import Settings by what a person would type (P4c)", () => {
    expect(ids("export")[0]).toBe("export-settings");
    expect(ids("import")[0]).toBe("import-settings");
    for (const q of ["backup", "back up", "file", "json", "move", "transfer", "migrate", "another pc"])
      expect(ids(q), q).toEqual(expect.arrayContaining(["export-settings", "import-settings"]));
    // Reset Appearance has "restore" too (the registry's order puts it first).
    expect(ids("restore")).toEqual(["reset-appearance", "import-settings"]);
    expect(ids("settings").slice(0, 2)).toEqual(["export-settings", "import-settings"]);
    // On App, in the order the page draws them: Copy Diagnostics, Export,
    // Import, and the destructive row last.
    for (const id of ["export-settings", "import-settings"]) {
      expect(settingById(id)?.page, id).toBe("app");
      expect(settingById(id)?.world, id).toBeUndefined();
    }
    const order = SETTINGS_INDEX.filter((r) => r.page === "app").map((r) => r.id);
    expect(order.slice(-4)).toEqual(["copy-diagnostics", "export-settings", "import-settings", "clear-logins"]);
  });

  it("finds an Xtream playlist's movies and shows, and its rows, by what a person would type (plan 028)", () => {
    expect(ids("movies and shows")[0]).toBe("playlist-library");
    expect(ids("your rows")[0]).toBe("playlist-library-folders");
    for (const q of ["movies", "shows", "films", "tv shows", "vod", "library", "turn off", "switch"]) expect(ids(q), q).toContain("playlist-library");
    for (const q of ["folders", "more folders", "pick", "rows", "genres", "reorder", "drag", "order"]) expect(ids(q), q).toContain("playlist-library-folders");
    // They sit under the playlists, in the Live TV pill, where the playlists are.
    for (const id of ["playlist-library", "playlist-library-folders"]) {
      expect(settingById(id)?.page, id).toBe("sources");
      expect(settingById(id)?.world, id).toBe("live");
    }
    // The Live TV folders row is still found by "folders", beside the rows.
    expect(ids("folders")).toEqual(expect.arrayContaining(["playlists", "playlist-library-folders"]));
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
    // "up": Updates starts with it, Startup Tab contains it, and Replay Setup
    // does too, after it in the registry.
    const got = ids("up");
    const at = (id: string) => got.indexOf(id);
    expect(at("updates")).toBeGreaterThanOrEqual(0);
    expect(at("startup-tab")).toBeGreaterThan(at("updates"));
    expect(at("replay-onboarding")).toBeGreaterThan(at("startup-tab"));
  });

  // Four bands since 1.2.0: a keyword WORD that starts with the query now
  // beats a keyword that only holds it ("log" finds the Diagnostics' "logs"
  // before What's New's "changelog"). An intended change to the ranking.
  it("holds the four bands in order for any query, and the registry's order inside each", () => {
    const band = (id: string, q: string) => {
      const r = settingById(id)!;
      const label = r.label.toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.includes(q)) return 1;
      return r.keywords.some((k) => k.split(/[\s-]+/).some((w) => w.startsWith(q))) ? 2 : 3;
    };
    for (const q of ["a", "c", "up", "hero", "sync", "o", "log", "re", "pla", "time", "set"]) {
      const got = ids(q);
      expect(got.length, q).toBeGreaterThan(0);
      const bands = got.map((id) => band(id, q));
      expect(bands, q).toEqual([...bands].sort((a, b) => a - b));
      const order = SETTINGS_INDEX.map((r) => r.id);
      for (const b of [0, 1, 2, 3]) {
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

  it("finds Home's rows by its name, and Startup Tab by it too (plan 033)", () => {
    expect(settingById("home-rows")?.page).toBe("home");
    // The label starts with it, so it is first; Startup Tab has it as a keyword.
    expect(ids("home")[0]).toBe("home-rows");
    expect(ids("home")).toContain("startup-tab");
    expect(ids("reorder")).toContain("home-rows");
  });

  it("stops at the limit, keeping the best", () => {
    const all = ids("a");
    expect(all.length).toBeGreaterThan(5);
    expect(findSettings("a", 5).map((r) => r.id)).toEqual(all.slice(0, 5));
    expect(findSettings("a", 1)).toHaveLength(1);
    expect(findSettings("a", 0)).toEqual([]);
  });
});
