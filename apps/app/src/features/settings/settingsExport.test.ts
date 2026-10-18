import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../lib/version";
import {
  ART_FIELDS,
  COULD_NOT_WRITE,
  FILE_TOO_NEW,
  KEY_GROUPS,
  NOTHING_TO_IMPORT,
  NOT_A_SETTINGS_FILE,
  applySettingsFile,
  artCarriesKey,
  buildSettingsFile,
  groupOf,
  parseSettingsFile,
  settingsFileName,
  type KeyGroup,
} from "./settingsExport";
import { loadPicks, loadHeld } from "../xtvod/store";

// An in-memory localStorage: the unit tests run without a DOM. A key can be
// told to refuse its write, as a full quota does.
const mem = new Map<string, string>();
let refuse = new Set<string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (refuse.has(k)) throw new Error("QuotaExceededError");
    mem.set(k, v);
  },
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const put = (key: string, data: unknown, v = 1) => localStorage.setItem(`blammytv.${key}`, JSON.stringify({ v, data }));
const stored = (key: string) => localStorage.getItem(`blammytv.${key}`);

const GROUPS = Object.keys(KEY_GROUPS) as KeyGroup[];
const keysOf = (...groups: KeyGroup[]) => groups.flatMap((g) => [...KEY_GROUPS[g]]).sort();
const ALL = keysOf(...GROUPS);

/** Obvious fakes: nothing here is, or looks like, a real credential. */
const FAKE_PASSWORD = "FAKE-PASSWORD-NOT-REAL";
const FAKE_MANIFEST = "http://aio.example.invalid/FAKE-CONFIG/manifest.json";
const PLAYLIST = { kind: "xtream", id: "p1", name: "Fake", enabled: true, server: "http://iptv.example.invalid", username: "fake-user", password: FAKE_PASSWORD };

/** Every key of every group stored, each with a value that names it. */
function seedEverything() {
  for (const k of ALL) put(k, `data-of-${k}`);
  put("playlists", [PLAYLIST]);
  put("aiostreams", FAKE_MANIFEST);
}

/** A settings file as text, from the parts that matter. */
const fileText = (over: Record<string, unknown> = {}, keys: Record<string, unknown> = {}) =>
  JSON.stringify({ app: "BlammyTV", kind: "settings", format: 1, version: "0.0.0", exported: "2026-10-12T00:00:00.000Z", includesLogins: false, keys, ...over });
const env = (data: unknown, v = 1) => ({ v, data });

beforeEach(() => {
  mem.clear();
  refuse = new Set();
});
afterEach(() => vi.restoreAllMocks());

// ============================================================================
// Every stored key is filed.
// ============================================================================

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const rel = (f: string) => relative(SRC, f).split(sep).join("/");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** The generic wrappers over `load` and `save`, which take their key as a
 * parameter: where their keys are really written down. */
const WRAPPERS: Record<string, (src: string, consts: Map<string, string>) => string[]> = {
  // choice("audioChannels", ...)
  "features/settings/playerPrefs.ts": (src) => [...src.matchAll(/\bchoice<[^>]*>\(\s*"([^"]+)"/g)].map((m) => m[1]),
  // cachedOrFetched(INDEX_KEY, ...)
  "features/stream/animemap.ts": (src, consts) =>
    [...src.matchAll(/\bcachedOrFetched\(\s*(\w+)\s*,/g)].flatMap((m) => consts.get(m[1]) ?? []),
};

/**
 * Every key the app's source gives `load`, `save`, `loadList` or `remove`
 * (under whatever name the file imports them by): a string, or a constant in
 * the same file that holds one. Read from the source because a key is a
 * constant in the file that owns it, and a list kept apart from them is the
 * list that goes stale. A call whose key can't be told is returned in
 * `unresolved`, so a new way of naming one fails here and is looked at.
 */
function storedKeys() {
  const keys = new Map<string, string[]>();
  const unresolved: string[] = [];
  const seen = (key: string, where: string) => keys.set(key, [...(keys.get(key) ?? []), where]);
  for (const file of sourceFiles()) {
    const where = rel(file);
    if (where === "lib/storage.ts") continue;
    const src = readFileSync(file, "utf8");
    const names = new Map<string, string>();
    for (const imp of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*\/storage"/g))
      for (const part of imp[1].split(",")) {
        const m = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
        if (m) names.set(m[2] ?? m[1], m[1]);
      }
    if (names.size === 0) continue;
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*"([^"]*)"/g)) consts.set(m[1], m[2]);
    for (const [local, name] of names) {
      if (!["load", "save", "loadList", "remove"].includes(name)) continue;
      for (const call of src.matchAll(new RegExp(`\\b${local}\\s*(?:<[^()]*>)?\\(\\s*([^,()\\s]+)`, "g"))) {
        const arg = call[1];
        const key = arg.startsWith('"') ? arg.slice(1, -1) : consts.get(arg);
        if (key !== undefined) seen(key, where);
        else if (!(where in WRAPPERS && arg === "key")) unresolved.push(`${where}: ${local}(${arg}`);
      }
    }
    for (const key of WRAPPERS[where]?.(src, consts) ?? []) seen(key, where);
  }
  return { keys, unresolved };
}

describe("every stored key is filed", () => {
  const { keys, unresolved } = storedKeys();

  it("has read the source, and not nothing: the keys it finds include one of each way a key is named", () => {
    expect(keys.size).toBeGreaterThan(60);
    for (const k of [
      "watching", // a constant
      "vodCache", // a string, and an alias for load and save
      "traktQueue", // a constant that isn't called KEY
      "accent-custom", // a second key in one file
      "audioChannels", // through choice()
      "aniskipIndex", // through cachedOrFetched()
    ])
      expect([...keys.keys()], k).toContain(k);
  });

  it("files every key the source stores, in exactly one group", () => {
    const strays = [...keys].filter(([k]) => !groupOf(k)).map(([k, where]) => `${k} (${[...new Set(where)].join(", ")})`);
    expect(strays, "stored but in no group of settingsExport.ts: file them").toEqual([]);
  });

  it("holds no key the source does not store", () => {
    expect(ALL.filter((k) => !keys.has(k)), "filed, but nothing stores it").toEqual([]);
  });

  it("holds no key in two groups", () => {
    expect(ALL.filter((k, i) => ALL.indexOf(k) !== i)).toEqual([]);
  });

  it("cannot tell the key of no call", () => {
    expect(unresolved, "a call whose key the scan can't read: teach it, or name the key").toEqual([]);
  });

  it("keeps stored values inside lib/storage.ts, but for the onboarding flags and one key removed at boot", () => {
    const using = (word: RegExp) => sourceFiles().filter((f) => word.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(using(/\blocalStorage\.(getItem|setItem|removeItem|clear)\(/)).toEqual(["app/onboardingGate.ts", "lib/storage.ts", "main.tsx"]);
    expect(using(/\bsessionStorage\.(getItem|setItem|removeItem|clear)\(/)).toEqual(["app/welcome.ts"]);
    // Neither is under the prefix: only a listed key is ever read or written.
    expect(readFileSync(join(SRC, "app/onboardingGate.ts"), "utf8")).toMatch(/const KEY = "btv:onboarded"/);
    expect(readFileSync(join(SRC, "app/welcome.ts"), "utf8")).toMatch(/const PLAYED_KEY = "btv:welcome-played"/);
    expect(groupOf("btv:onboarded")).toBeUndefined();
    expect(groupOf("btv:welcome-played")).toBeUndefined();
  });
});

describe("a login is what Clear All Login Info clears", () => {
  const src = readFileSync(join(SRC, "features/settings/AppPage.tsx"), "utf8");
  const body = /const clearLogins = \(\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? "";
  const calls = [...body.replace(/\/\/.*$/gm, "").matchAll(/\b([A-Za-z_]\w*)\(/g)].map((m) => m[1]).sort();

  it("calls what the logins group, the sign-ins and the caches were made from, and nothing else", () => {
    expect(body).not.toBe("");
    // A call added here is a login this file has not been asked about.
    expect(calls).toEqual(["diskClear", "forgetXtLists", "removeStored", "saveAioUrl", "saveHeroSources", "savePlaylists", "signOutOfAio", "signOutOfJf", "signOutOfMal", "signOutOfTrakt"]);
    expect(body).toMatch(/removeStored\("vodCache"\)/);
  });

  it("files the playlists, the manifest and the hero sources as the logins, and the caches and sign-ins as never", () => {
    expect([...KEY_GROUPS.logins].sort()).toEqual(["aiostreams", "heroSources", "playlists"]);
    for (const k of ["vodCache", "trakt", "traktQueue", "mal", "aiojf", "aiojfQueue", "jellyfin", "aioWatched", "malWatched", "aiojfIds", "tmdbKey"])
      expect(groupOf(k), k).toBe("never");
  });
});

// ============================================================================
// Building the file.
// ============================================================================

describe("building the settings file", () => {
  const NOW = new Date("2026-10-12T09:30:00.000Z");

  it("without logins holds the looks, the playback settings and what is yours, and no login and no never", () => {
    seedEverything();
    const f = buildSettingsFile({ logins: false, now: NOW });
    expect(Object.keys(f.keys).sort()).toEqual(keysOf("looks", "playback", "yours"));
    for (const k of [...KEY_GROUPS.logins, ...KEY_GROUPS.never]) expect(f.keys, k).not.toHaveProperty(k);
    expect(f.includesLogins).toBe(false);
  });

  it("with logins adds the playlists, the manifest, the hero sources and what is keyed to the playlists, and still no never", () => {
    seedEverything();
    const f = buildSettingsFile({ logins: true, now: NOW });
    expect(Object.keys(f.keys).sort()).toEqual(keysOf("looks", "playback", "yours", "withPlaylists", "logins"));
    for (const k of KEY_GROUPS.never) expect(f.keys, k).not.toHaveProperty(k);
    expect(f.includesLogins).toBe(true);
  });

  it("puts no password in the file unless the box is ticked", () => {
    seedEverything();
    const off = JSON.stringify(buildSettingsFile({ logins: false }));
    expect(off).not.toContain(FAKE_PASSWORD);
    expect(off).not.toContain(FAKE_MANIFEST);
    expect(off).not.toContain("fake-user");
    const on = JSON.stringify(buildSettingsFile({ logins: true }));
    expect(on).toContain(FAKE_PASSWORD);
    expect(on).toContain(FAKE_MANIFEST);
  });

  it("is the shape the brief gave: app, kind, format, version, exported, includesLogins, keys", () => {
    put("accent", "#336699", 2);
    const f = buildSettingsFile({ logins: false, now: NOW });
    expect(f).toEqual({
      app: "BlammyTV",
      kind: "settings",
      format: 1,
      version: APP_VERSION,
      exported: "2026-10-12T09:30:00.000Z",
      includesLogins: false,
      keys: { accent: { v: 2, data: "#336699" } },
    });
  });

  it("keeps each key's envelope as it is stored, version and all", () => {
    put("theme", "light", 3);
    put("watchedEpisodes", { tt1: ["tt1:1:1", "tt1:1:2"] });
    const f = buildSettingsFile({ logins: false });
    expect(f.keys.theme).toEqual({ v: 3, data: "light" });
    expect(f.keys.watchedEpisodes).toEqual({ v: 1, data: { tt1: ["tt1:1:1", "tt1:1:2"] } });
  });

  it("leaves out a key that isn't stored and one that isn't an envelope", () => {
    put("theme", "light");
    localStorage.setItem("blammytv.favorites", "not json {");
    localStorage.setItem("blammytv.recents", JSON.stringify({ v: "1", data: [] }));
    localStorage.setItem("blammytv.lists", JSON.stringify([1, 2]));
    localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1 }));
    expect(Object.keys(buildSettingsFile({ logins: true }).keys)).toEqual(["theme"]);
  });

  it("asks for nothing it was not given: an empty store is an empty file", () => {
    expect(buildSettingsFile({ logins: true }).keys).toEqual({});
  });

  it("names the file for the day on this PC's clock", () => {
    expect(settingsFileName(new Date(2026, 9, 12, 23, 59))).toBe("blammytv-settings-2026-10-12.json");
    expect(settingsFileName(new Date(2026, 0, 5, 0, 1))).toBe("blammytv-settings-2026-01-05.json");
    expect(settingsFileName()).toMatch(/^blammytv-settings-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("logs nothing", () => {
    seedEverything();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    buildSettingsFile({ logins: true });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Reading a file.
// ============================================================================

describe("reading a settings file", () => {
  it("takes one that is ours", () => {
    expect(parseSettingsFile(fileText({ includesLogins: true }, { theme: env("light") }))).toEqual({
      ok: true,
      includesLogins: true,
      keys: { theme: { v: 1, data: "light" } },
    });
  });

  it("takes includesLogins only as true, whatever else it says", () => {
    for (const v of [false, undefined, "true", 1, null, [true]]) {
      const got = parseSettingsFile(fileText({ includesLogins: v }));
      expect(got.ok && got.includesLogins, String(v)).toBe(false);
    }
  });

  it("ignores a byte order mark ahead of the text", () => {
    expect(parseSettingsFile("\uFEFF" + fileText()).ok).toBe(true);
  });

  it("says it is not ours for anything that is not our JSON, in one line", () => {
    const wrong = [
      "",
      "not json",
      "[]",
      "null",
      "42",
      '"BlammyTV"',
      JSON.stringify({ app: "Other", kind: "settings", format: 1, keys: {} }),
      JSON.stringify({ app: "BlammyTV", kind: "backup", format: 1, keys: {} }),
      JSON.stringify({ app: "BlammyTV", kind: "settings", keys: {} }),
      JSON.stringify({ app: "BlammyTV", kind: "settings", format: 1 }),
      fileText({ format: "1" }),
      fileText({ format: 0 }),
      fileText({ format: -1 }),
      fileText({ format: 1.5 }),
      fileText({ format: null }),
      fileText({ keys: [] }),
      fileText({ keys: null }),
      fileText({ keys: "theme" }),
      fileText({ app: undefined }),
      // A package.json, a Telly backup, a log.
      JSON.stringify({ name: "x", version: "1.0.0", dependencies: {} }),
    ];
    for (const text of wrong) {
      const got = parseSettingsFile(text);
      expect(got, text.slice(0, 50)).toEqual({ ok: false, reason: NOT_A_SETTINGS_FILE });
    }
    expect(NOT_A_SETTINGS_FILE).toBe("That isn't a BlammyTV settings file. Choose one saved with Export Settings.");
    expect(NOT_A_SETTINGS_FILE).not.toContain("\n");
  });

  it("says a newer format is newer, and holds nothing of the file in the line", () => {
    for (const format of [2, 3, 99]) expect(parseSettingsFile(fileText({ format }))).toEqual({ ok: false, reason: FILE_TOO_NEW });
    expect(FILE_TOO_NEW).not.toContain("\n");
  });
});

// ============================================================================
// Applying one.
// ============================================================================

describe("applying a settings file", () => {
  it("writes a key of the looks, playback and yours groups as the envelope it is", () => {
    const file = fileText({}, { accent: env("#336699", 2), oneClickPlay: env(true), watchedEpisodes: env({ tt1: ["tt1:1:1"] }) });
    expect(applySettingsFile(file)).toEqual({ ok: true, written: 3 });
    expect(JSON.parse(stored("accent")!)).toEqual({ v: 2, data: "#336699" });
    expect(JSON.parse(stored("oneClickPlay")!)).toEqual({ v: 1, data: true });
    expect(JSON.parse(stored("watchedEpisodes")!)).toEqual({ v: 1, data: { tt1: ["tt1:1:1"] } });
  });

  it("replaces what was there, and leaves alone a key the file does not mention", () => {
    put("theme", "dark");
    put("favorites", ["mine"]);
    put("startupTab", "live");
    expect(applySettingsFile(fileText({}, { theme: env("light") }))).toEqual({ ok: true, written: 1 });
    expect(JSON.parse(stored("theme")!).data).toBe("light");
    expect(JSON.parse(stored("favorites")!).data).toEqual(["mine"]);
    expect(JSON.parse(stored("startupTab")!).data).toBe("live");
  });

  it("writes no key of the never group, ticked or not, whatever the file claims", () => {
    for (const includesLogins of [true, false]) {
      mem.clear();
      const never = Object.fromEntries(KEY_GROUPS.never.map((k) => [k, env(`from-the-file-${k}`)]));
      put("trakt", { lastSync: 1 });
      const got = applySettingsFile(fileText({ includesLogins }, { ...never, theme: env("light") }));
      expect(got, String(includesLogins)).toEqual({ ok: true, written: 1 });
      for (const k of KEY_GROUPS.never) if (k !== "trakt") expect(stored(k), k).toBeNull();
      expect(JSON.parse(stored("trakt")!)).toEqual({ v: 1, data: { lastSync: 1 } });
    }
  });

  it("writes no login unless the file says it includes them, and writes them when it does", () => {
    const logins = Object.fromEntries(KEY_GROUPS.logins.map((k) => [k, env(`login-${k}`)]));
    const without = applySettingsFile(fileText({ includesLogins: false }, { ...logins, theme: env("light") }));
    expect(without).toEqual({ ok: true, written: 1 });
    for (const k of KEY_GROUPS.logins) expect(stored(k), k).toBeNull();

    // Not there at all, and not true, are the same as false.
    applySettingsFile(JSON.stringify({ app: "BlammyTV", kind: "settings", format: 1, keys: logins }));
    applySettingsFile(fileText({ includesLogins: "true" }, logins));
    for (const k of KEY_GROUPS.logins) expect(stored(k), k).toBeNull();

    const withLogins = applySettingsFile(fileText({ includesLogins: true }, { ...logins, theme: env("light") }));
    expect(withLogins).toEqual({ ok: true, written: 1 + KEY_GROUPS.logins.length });
    for (const k of KEY_GROUPS.logins) expect(JSON.parse(stored(k)!).data, k).toBe(`login-${k}`);
  });

  it("skips a value that is not a { v: number, data } envelope, and writes the rest", () => {
    const bad: Record<string, unknown> = {
      accent: "#336699",
      theme: { v: "1", data: "light" },
      clockFormat: { data: "24h" },
      startupTab: { v: 1 },
      rowCap: { v: Number.NaN, data: 5 },
      showHero: null,
      oneClickPlay: [1, 2],
      sourceFailover: 7,
      watchedEpisodes: env({ tt1: ["tt1:1:1"] }),
    };
    expect(applySettingsFile(fileText({}, bad))).toEqual({ ok: true, written: 1 });
    expect(Object.keys(Object.fromEntries(mem))).toEqual(["blammytv.watchedEpisodes"]);
  });

  it("writes exactly { v, data }, dropping what else rode along on an envelope", () => {
    applySettingsFile(fileText({}, { theme: { v: 1, data: "light", extra: "<script>", more: { nested: true } } }));
    expect(stored("theme")).toBe(JSON.stringify({ v: 1, data: "light" }));
  });

  it("takes a null or a falsy data: it is data", () => {
    expect(applySettingsFile(fileText({}, { showHero: env(false), cardMeta: env(null), rowCap: env(0) }))).toEqual({ ok: true, written: 3 });
    expect(JSON.parse(stored("cardMeta")!)).toEqual({ v: 1, data: null });
  });

  it("ignores a key this build has no group for, and one that is only a name on Object", () => {
    const text = '{"app":"BlammyTV","kind":"settings","format":1,"includesLogins":true,"keys":{"__proto__":{"v":1,"data":"x"},"constructor":{"v":1,"data":"x"},"toString":{"v":1,"data":"x"},"fromANewerBuild":{"v":1,"data":"x"},"btv:onboarded":{"v":1,"data":"x"},"blammytv.theme":{"v":1,"data":"x"},"":{"v":1,"data":"x"},"theme":{"v":1,"data":"light"}}}';
    expect(applySettingsFile(text)).toEqual({ ok: true, written: 1 });
    expect([...mem.keys()]).toEqual(["blammytv.theme"]);
    expect(({} as { v?: unknown }).v).toBeUndefined();
  });

  it("refuses a file that is not ours, or too new, and writes nothing", () => {
    put("theme", "dark");
    const before = JSON.stringify([...mem]);
    const setItem = vi.spyOn(localStorage, "setItem");
    const removeItem = vi.spyOn(localStorage, "removeItem");
    for (const [text, reason] of [
      ["not json", NOT_A_SETTINGS_FILE],
      [fileText({ app: "Telly" }, { theme: env("light") }), NOT_A_SETTINGS_FILE],
      [fileText({ kind: "diagnostics" }, { theme: env("light") }), NOT_A_SETTINGS_FILE],
      [fileText({ format: 2 }, { theme: env("light") }), FILE_TOO_NEW],
      [fileText({ format: 0 }, { theme: env("light") }), NOT_A_SETTINGS_FILE],
    ] as const) {
      expect(applySettingsFile(text), text.slice(0, 40)).toEqual({ ok: false, reason });
    }
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(JSON.stringify([...mem])).toBe(before);
  });

  it("says so, and writes nothing, for a file with nothing in it for this build", () => {
    put("theme", "dark");
    const before = JSON.stringify([...mem]);
    const nothing = [{}, { trakt: env({}) }, { tmdbKey: env("x") }, { fromANewerBuild: env(1) }, { theme: "light" }];
    for (const keys of nothing) expect(applySettingsFile(fileText({ includesLogins: true }, keys))).toEqual({ ok: false, reason: NOTHING_TO_IMPORT });
    expect(JSON.stringify([...mem])).toBe(before);
  });

  it("puts back every key already written when the store refuses one", () => {
    put("theme", "dark");
    put("watchedEpisodes", { mine: ["mine:1:1"] });
    refuse = new Set(["blammytv.watching"]);
    const file = fileText({}, { theme: env("light"), watchedEpisodes: env({ theirs: ["theirs:1:1"] }), accent: env("#336699", 2), watching: env(["x"]), startupTab: env("stream") });
    expect(applySettingsFile(file)).toEqual({ ok: false, reason: COULD_NOT_WRITE });
    expect(JSON.parse(stored("theme")!).data).toBe("dark");
    expect(JSON.parse(stored("watchedEpisodes")!).data).toEqual({ mine: ["mine:1:1"] });
    // A key there was none of is gone again, not left holding the file's value.
    expect(stored("accent")).toBeNull();
    expect(stored("watching")).toBeNull();
    expect(stored("startupTab")).toBeNull();
  });

  it("logs nothing, on success or on any refusal", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    applySettingsFile(fileText({ includesLogins: true }, { playlists: env([PLAYLIST]), theme: env("light") }));
    applySettingsFile("not json");
    applySettingsFile(fileText({ format: 2 }));
    applySettingsFile(fileText({}, { trakt: env(1) }));
    refuse = new Set(["blammytv.watching"]);
    applySettingsFile(fileText({}, { theme: env("dark"), watching: env([]) }));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("round trips: what an export holds, an import into an empty store restores", () => {
    seedEverything();
    const file = JSON.stringify(buildSettingsFile({ logins: true }));
    const wanted = new Map([...mem].filter(([k]) => !KEY_GROUPS.never.includes(k.slice("blammytv.".length) as never)));
    mem.clear();
    put("trakt", { lastSync: 7 });
    expect(applySettingsFile(file)).toEqual({ ok: true, written: wanted.size });
    for (const [k, v] of wanted) expect(mem.get(k), k).toBe(v);
    expect(JSON.parse(stored("trakt")!).data).toEqual({ lastSync: 7 });
    expect(stored("tmdbKey")).toBeNull();
  });

  it("round trips without logins: the playlists in the file are not there, and the ones on this PC stay", () => {
    seedEverything();
    const file = JSON.stringify(buildSettingsFile({ logins: false }));
    mem.clear();
    put("playlists", [{ ...PLAYLIST, id: "mine", name: "Mine" }]);
    applySettingsFile(file);
    expect(JSON.parse(stored("playlists")!).data[0].id).toBe("mine");
    expect(stored("aiostreams")).toBeNull();
    expect(JSON.parse(stored("theme")!).data).toBe("data-of-theme");
  });
});

// ============================================================================
// Keys that name this PC's playlists or channels travel with the playlists.
// ============================================================================

/** The six keys whose values are a playlist id or a channel id
 * (`${playlistId}:${streamId}`). A playlist id is random per PC, so on another
 * PC none of them match anything. `xtVod` (plan 028) joined the four on purpose:
 * an Xtream library's switch and folder picks are keyed by playlist id, and
 * `redzoneChannel` is a channel id. */
const LINKED = ["favorites", "recents", "guideFixes", "multiviewGrid", "xtVod", "redzoneChannel"] as const;
/** What the keys of `yours` that hold none of those (a title id, a league path,
 * a tile count) are filed as: they go in every file. */
const PORTABLE = ["lists", "watching", "watchedEpisodes", "sports-follows", "multiviewLayouts", "multiviewSplits", "multiviewVolume", "multiviewScores"] as const;

/** One PC's worth of the linked keys, every id naming `pc`'s own playlist. */
const linkedOf = (pc: string): Record<(typeof LINKED)[number], unknown> => ({
  favorites: [`${pc}:1`, `${pc}:2`],
  recents: [`${pc}:2`],
  guideFixes: { [pc]: { [`${pc}:1`]: "guide.one" } },
  multiviewGrid: { picks: [{ channelId: `${pc}:1`, label: `${pc} one` }], sound: `${pc}:1` },
  xtVod: { [pc]: { off: true, picks: [{ kind: "series", id: "13" }, { kind: "movie", id: "12" }] } },
  redzoneChannel: `${pc}:2`,
});
const putLinked = (pc: string) => {
  for (const [k, data] of Object.entries(linkedOf(pc))) put(k, data);
};
const rawOf = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, stored(k)]));

describe("keys that name this PC's playlists or channels travel with the playlists", () => {
  it("files the six of them apart from the rest of yours, and the rest stay in yours", () => {
    for (const k of LINKED) expect(groupOf(k), k).toBe("withPlaylists");
    for (const k of PORTABLE) expect(groupOf(k), k).toBe("yours");
    expect([...KEY_GROUPS.yours].sort()).toEqual([...PORTABLE].sort());
    expect([...KEY_GROUPS.withPlaylists].sort()).toEqual([...LINKED].sort());
  });

  it("leaves them out of a file made without the box, and puts them in one made with it", () => {
    putLinked("pcA");
    put("lists", [{ id: "l1", name: "Weekend", at: 1, entries: [] }]);
    put("watching", [{ id: "tt1", title: "Film", at: 1 }]);
    put("multiviewLayouts", { 2: "focus" }, 2);
    put("theme", "light");
    const off = buildSettingsFile({ logins: false });
    for (const k of LINKED) expect(off.keys, k).not.toHaveProperty(k);
    // Not an id of the PC's playlists anywhere in the text, and the rest is there.
    expect(JSON.stringify(off)).not.toContain("pcA");
    expect(Object.keys(off.keys).sort()).toEqual(["lists", "multiviewLayouts", "theme", "watching"]);
    const on = buildSettingsFile({ logins: true });
    for (const [k, data] of Object.entries(linkedOf("pcA"))) expect(on.keys[k], k).toEqual({ v: 1, data });
  });

  it("leaves this PC's own untouched when the file has no playlists: a file made on another PC, and an older build's file that still carries them", () => {
    putLinked("pcA");
    put("theme", "light");
    const madeElsewhere = JSON.stringify(buildSettingsFile({ logins: false }));
    // What a build from before this change wrote without the box.
    const olderBuild = fileText({ includesLogins: false }, { theme: env("light"), ...Object.fromEntries(Object.entries(linkedOf("pcA")).map(([k, data]) => [k, env(data)])) });
    for (const file of [madeElsewhere, olderBuild]) {
      mem.clear();
      putLinked("pcB");
      put("theme", "dark");
      const before = rawOf(LINKED);
      expect(applySettingsFile(file)).toEqual({ ok: true, written: 1 });
      expect(JSON.parse(stored("theme")!).data).toBe("light");
      expect(rawOf(LINKED)).toEqual(before);
      expect(JSON.stringify(before)).toContain("pcB");
    }
  });

  it("replaces them, as before, when the file has the playlists", () => {
    putLinked("pcA");
    put("playlists", [{ ...PLAYLIST, id: "pcA" }]);
    const file = JSON.stringify(buildSettingsFile({ logins: true }));
    mem.clear();
    putLinked("pcB");
    put("playlists", [{ ...PLAYLIST, id: "pcB" }]);
    expect(applySettingsFile(file)).toEqual({ ok: true, written: 1 + LINKED.length });
    for (const [k, data] of Object.entries(linkedOf("pcA"))) expect(JSON.parse(stored(k)!), k).toEqual({ v: 1, data });
    expect(JSON.parse(stored("playlists")!).data[0].id).toBe("pcA");
  });

  it("takes them only when the file says it has the playlists, not on its say-so that they are there", () => {
    const linked = Object.fromEntries(Object.entries(linkedOf("pcA")).map(([k, data]) => [k, env(data)]));
    putLinked("pcB");
    const before = rawOf(LINKED);
    for (const includesLogins of [false, undefined, "true", 1, null]) {
      expect(applySettingsFile(fileText({ includesLogins }, linked)), String(includesLogins)).toEqual({ ok: false, reason: NOTHING_TO_IMPORT });
      expect(rawOf(LINKED), String(includesLogins)).toEqual(before);
    }
  });

  it("carries an Xtream library's choices with the playlists and never what it held", () => {
    expect(groupOf("xtVod")).toBe("withPlaylists");
    expect(groupOf("xtVodHeld")).toBe("never");
    const choices = { pcA: { off: true }, pcB: { picks: { movie: ["12"] } } };
    put("xtVod", choices);
    put("xtVodHeld", { pcA: { movies: 9, shows: 4 } });
    // Without the box: the choices are not in the file, and no playlist id with them.
    const off = buildSettingsFile({ logins: false });
    expect(off.keys).not.toHaveProperty("xtVod");
    expect(off.keys).not.toHaveProperty("xtVodHeld");
    expect(JSON.stringify(off)).not.toContain("pcA");
    // With it: the choices are, and the counts still are not.
    const on = buildSettingsFile({ logins: true });
    expect(on.keys.xtVod).toEqual({ v: 1, data: choices });
    expect(on.keys).not.toHaveProperty("xtVodHeld");

    // An import takes them under the same condition as the favourites: a file
    // that says it has the playlists, and no other. The counts are never taken,
    // whatever the file says.
    const theirs = { gone: { off: true } };
    const file = (includesLogins: unknown) => fileText({ includesLogins }, { xtVod: env(theirs), xtVodHeld: env({ gone: { movies: 1, shows: 1 } }), theme: env("light") });
    const before = rawOf(["xtVod", "xtVodHeld"]);
    expect(applySettingsFile(file(false))).toEqual({ ok: true, written: 1 });
    expect(rawOf(["xtVod", "xtVodHeld"])).toEqual(before);
    for (const claim of [undefined, "true", 1, null]) expect(applySettingsFile(file(claim)), String(claim)).toEqual({ ok: true, written: 1 });
    expect(rawOf(["xtVod", "xtVodHeld"])).toEqual(before);
    expect(applySettingsFile(file(true))).toEqual({ ok: true, written: 2 });
    expect(JSON.parse(stored("xtVod")!)).toEqual({ v: 1, data: theirs });
    expect(stored("xtVodHeld")).toBe(before.xtVodHeld);
  });

  it("takes an Xtream library's picks whichever build made the file: the list in the person's order, or the two lists the older build saved", () => {
    const newer = { pcA: { off: true, picks: [{ kind: "series", id: "13" }, { kind: "movie", id: "14" }, { kind: "movie", id: "12" }] } };
    const older = { pcA: { off: true, picks: { movie: ["14", "12"], series: ["13"] } } };
    // The older build's own export, as it wrote it (xtvod/store.ts before the order was the person's).
    const wrote = (data: unknown) => fileText({ includesLogins: true }, { xtVod: env(data) });
    for (const [file, want] of [
      [wrote(newer), ["series:13", "movie:14", "movie:12"]],
      [wrote(older), ["movie:14", "movie:12", "series:13"]],
    ] as const) {
      mem.clear();
      expect(applySettingsFile(file)).toEqual({ ok: true, written: 1 });
      expect(loadPicks("pcA").map((p) => `${p.kind}:${p.id}`)).toEqual(want);
    }
    // And a file that is neither shape imports as no picks rather than failing.
    mem.clear();
    expect(applySettingsFile(wrote({ pcA: { picks: "12" } }))).toEqual({ ok: true, written: 1 });
    expect(loadPicks("pcA")).toEqual([]);
    expect(loadHeld("pcA")).toBeNull();
  });

  it("puts every key back when the store refuses one of them", () => {
    putLinked("pcB");
    put("theme", "dark");
    const before = rawOf([...LINKED, "theme"]);
    refuse = new Set(["blammytv.multiviewGrid"]);
    const linked = Object.fromEntries(Object.entries(linkedOf("pcA")).map(([k, data]) => [k, env(data)]));
    expect(applySettingsFile(fileText({ includesLogins: true }, { theme: env("light"), ...linked }))).toEqual({ ok: false, reason: COULD_NOT_WRITE });
    expect(rawOf([...LINKED, "theme"])).toEqual(before);
  });
});

// ============================================================================
// Artwork that carries a key.
// ============================================================================

// Obvious fakes again. None of these is a key, and none looks like a real one.
const FAKE_RPDB_KEY = "FAKE-RPDB-KEY-NOT-REAL";
const RPDB = `https://api.ratingposterdb.com/${FAKE_RPDB_KEY}/imdb/poster-default/tt0111161.jpg?fallback=true`;
const METAHUB = "https://images.metahub.space/poster/small/tt0111161/img";
const METAHUB_BACKDROP = "https://images.metahub.space/background/medium/tt0111161/img";
/** TMDB's image CDN: a size and a file name of 27 characters. */
const TMDB_FILE = "1E5baAaEse26fej7uHcjOgEE2t2";
const TMDB = `https://image.tmdb.org/t/p/w500/${TMDB_FILE}.jpg`;
const TMDB_BACKDROP = `https://image.tmdb.org/t/p/original/${TMDB_FILE}.jpg`;
/** 35 characters, with 28 letters in them. */
const FAKE_KEY = "FAKE-KEY-NOT-REAL-FAKE-KEY-NOT-REAL";
/** AIOStreams' sign-in art as it really is: a 32 hex item id (aiojf/ids.ts:6) and a tag
 * that is 11 letters, a digit and the base64url of the image's own address
 * (browse.test.ts:22). */
const AIO_ID = "0123456789abcdef0123456789abcdef";
const AIO_BASE = "https://aio.example.invalid";
/** browse.test.ts:22-24, as AIOStreams makes them: a code 2 (TMDB) tag for a poster
 * and a backdrop, and a code 4 (fanart.tv) one for a logo. */
const AIO_TAG = "abcdefghijk2dzUwMC9zaGF3c2hhbmsuanBn";
const AIO_BACKDROP_TAG = "bcdefghijkl2b3JpZ2luYWwvc2hhd3NoYW5rLWJnLmpwZw";
const AIO_LOGO_TAG = "cdefghijklm4ZmFuYXJ0L3NoYXdzaGFuay1sb2dvLnBuZw";
const b64url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
/** A tag as AIOStreams makes one: 11 characters of signature (a made-up one here),
 * the host code, and the base64url of the rest. */
const tagOf = (code: string, rest: string): string => `abcdefghijk${code}${b64url(rest)}`;
const aio = (tag?: string, extra = "", type = "Primary"): string =>
  `${AIO_BASE}/Items/${AIO_ID}/Images/${type}${tag === undefined ? "" : `?tag=${encodeURIComponent(tag)}`}${extra}`;

describe("an artwork address that looks like it carries a key", () => {
  it("has fixtures that are what they say they are", () => {
    expect(TMDB_FILE).toHaveLength(27);
    expect(FAKE_KEY.length).toBeGreaterThanOrEqual(32);
    expect(AIO_ID).toHaveLength(32);
    expect(AIO_TAG.length).toBeGreaterThanOrEqual(32);
  });

  it("is one with a user name or password in front of the host, signed-in art and a tag's target included", () => {
    expect(artCarriesKey("https://me:secret@posters.example.invalid/tt0111161.jpg")).toBe(true);
    expect(artCarriesKey("https://me@posters.example.invalid/tt0111161.jpg")).toBe(true);
    expect(artCarriesKey("https://me:secret@aio.example.invalid/Items/" + AIO_ID + "/Images/Primary")).toBe(true);
    expect(artCarriesKey(aio(tagOf("0", "https://me:secret@images.metahub.space/poster/medium/tt0111161/img")))).toBe(true);
    // The same addresses without them are kept.
    expect(artCarriesKey("https://posters.example.invalid/tt0111161.jpg")).toBe(false);
    expect(artCarriesKey(aio(tagOf("0", METAHUB)))).toBe(false);
  });

  it("is one on RPDB's host, which puts the key in the path, in any case", () => {
    expect(artCarriesKey(RPDB)).toBe(true);
    expect(artCarriesKey("https://API.RatingPosterDB.com/x/imdb/poster-default/tt0111161.jpg")).toBe(true);
    expect(artCarriesKey("http://api.ratingposterdb.com/")).toBe(true);
    // Whatever is in the path: the host is the rule.
    expect(artCarriesKey("https://api.ratingposterdb.com/a/b")).toBe(true);
  });

  it("is one with a query parameter named as a key is, in any case, with or without a value", () => {
    for (const name of ["key", "apikey", "api_key", "token", "access_token", "auth", "API_KEY", "ApiKey", "Token", "ACCESS_TOKEN", "Auth"])
      expect(artCarriesKey(`https://posters.example.invalid/tt0111161.jpg?${name}=abc`), name).toBe(true);
    expect(artCarriesKey("https://posters.example.invalid/tt0111161.jpg?size=big&api_key=")).toBe(true);
    expect(artCarriesKey("https://posters.example.invalid/tt0111161.jpg?fallback=true&token")).toBe(true);
  });

  it("is one with a key of 32 or more in a path segment, or as the value of any parameter", () => {
    expect(artCarriesKey(`https://posters.example.invalid/${FAKE_KEY}/imdb/tt0111161.jpg`)).toBe(true);
    expect(artCarriesKey(`https://posters.example.invalid/tt0111161.jpg?sig=${FAKE_KEY}`)).toBe(true);
    expect(artCarriesKey(`https://posters.example.invalid/${"ab12".repeat(8)}/p.jpg`)).toBe(true);
    // Percent-encoded, as it may be stored.
    expect(artCarriesKey(`https://posters.example.invalid/${encodeURIComponent("a/b+c" + "d".repeat(30))}/p.jpg`)).toBe(true);
  });

  it("keeps a poster from metahub, which is what Cinemeta serves, and a TMDB image with a 27-character file name", () => {
    for (const url of [METAHUB, METAHUB_BACKDROP, "https://images.metahub.space/logo/medium/tt0111161/img", TMDB, TMDB_BACKDROP, "https://image.tmdb.org/t/p/w1280/abcdef.jpg"])
      expect(artCarriesKey(url), url).toBe(false);
  });

  it("asks the token rule of one path segment at a time: a path that is over 32 characters in all is not one run", () => {
    const path = `/t/p/w500/${TMDB_FILE}`;
    expect(path.length).toBeGreaterThan(32);
    expect(artCarriesKey(`https://image.tmdb.org${path}.jpg`)).toBe(false);
    expect(artCarriesKey(`https://cdn.example.invalid/${"abcdefgh/".repeat(10)}p.jpg`)).toBe(false);
  });

  it("keeps an address with a short query and a Items/.../Images address with a short id", () => {
    expect(artCarriesKey("https://posters.example.invalid/tt0111161.jpg?size=big&lang=en")).toBe(false);
    expect(artCarriesKey("https://aio.example.invalid/Items/abc123/Images/Primary?tag=short")).toBe(false);
  });

  it("keeps what is not an http or https address, and never throws", () => {
    for (const text of ["", "   ", "not a url", "/relative/path.jpg", "//cdn.example.invalid/p.jpg", `data:image/png;base64,${"A".repeat(80)}`, `ftp://api.ratingposterdb.com/${FAKE_KEY}`, "file:///C:/x.png", "https://", "http://[", "💥"])
      expect(artCarriesKey(text), text).toBe(false);
  });
});

describe("a Jellyfin server of your own: its art holds the server's address, so a file without logins leaves it out", () => {
  const ID = "941ac528e71c63eb996ee5f7a2fee913";
  it("drops an image address as the server gives it (an item id and a 32 hex tag)", () => {
    expect(artCarriesKey(`http://192.168.1.50:8096/Items/${ID}/Images/Primary?tag=ff33905518665095161669a6d8da1b20`)).toBe(true);
    expect(artCarriesKey(`https://jf.example.com/Items/${ID}/Images/Backdrop/0?tag=ff33905518665095161669a6d8da1b20`)).toBe(true);
  });
});

describe("AIOStreams' sign-in art: an item id is no secret, a tag is judged by the address it points to", () => {
  it("keeps the real-shape addresses of browse.test.ts: a 32 hex id, a poster, a backdrop and a logo tag", () => {
    expect(artCarriesKey(`${AIO_BASE}/Items/${AIO_ID}/Images/Primary?tag=${AIO_TAG}`)).toBe(false);
    expect(artCarriesKey(`${AIO_BASE}/Items/${AIO_ID}/Images/Backdrop/0?tag=${AIO_BACKDROP_TAG}`)).toBe(false);
    expect(artCarriesKey(`${AIO_BASE}/Items/${AIO_ID}/Images/Logo?tag=${AIO_LOGO_TAG}`)).toBe(false);
    // Under a mount of the person's own, and over http.
    expect(artCarriesKey(`http://192.168.1.20:8080/jellyfin/Items/${AIO_ID}/Images/Primary?tag=${AIO_TAG}`)).toBe(false);
  });

  it("reads what each host code stands for, and a clean address behind any of them is kept", () => {
    for (const [code, rest] of [
      ["1", "poster/small/tt0111161/img"],
      ["2", "w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg"],
      ["3", "banners/posters/81189-1.jpg"],
      ["4", "fanart/shawshank-logo.png"],
      ["5", "tt0111161/img"],
      ["0", METAHUB],
      ["0", TMDB],
    ] as const)
      expect(artCarriesKey(aio(tagOf(code, rest))), `${code} ${rest}`).toBe(false);
  });

  it("drops a code 0 tag whose address is an RPDB poster, the key being inside it", () => {
    expect(artCarriesKey(aio(tagOf("0", RPDB)))).toBe(true);
    expect(artCarriesKey(aio(tagOf("0", RPDB), "", "Backdrop/0"))).toBe(true);
  });

  it("keeps a code 0 tag whose address is metahub, and a code 2 tag with a normal TMDB path", () => {
    expect(artCarriesKey(aio(tagOf("0", METAHUB)))).toBe(false);
    expect(artCarriesKey(aio(tagOf("2", "w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg")))).toBe(false);
  });

  it("judges the rebuilt address by all three rules: a key in its path, its query or its host, behind any code", () => {
    expect(artCarriesKey(aio(tagOf("2", `w500/${FAKE_KEY}.jpg`)))).toBe(true);
    expect(artCarriesKey(aio(tagOf("1", "poster/tt0111161/img?api_key=abc")))).toBe(true);
    expect(artCarriesKey(aio(tagOf("2", `w500/p.jpg?sig=${FAKE_KEY}`)))).toBe(true);
    expect(artCarriesKey(aio(tagOf("0", "https://API.RatingPosterDB.com/x/y.jpg")))).toBe(true);
    expect(artCarriesKey(aio(tagOf("0", `https://posters.example.invalid/${FAKE_KEY}/p.jpg`)))).toBe(true);
  });

  it("drops a tag that does not decode: too short, an unknown code, bad base64url, bad UTF-8, nothing after the code, or not an http address", () => {
    const bad: Array<[string, string]> = [
      ["empty", ""],
      ["too short", "abc"],
      ["a signature and nothing", "abcdefghijk"],
      ["a code and nothing", "abcdefghijk2"],
      ["an unknown code", `abcdefghijk9${b64url("w500/p.jpg")}`],
      ["a letter for a code", `abcdefghijkx${b64url("w500/p.jpg")}`],
      ["characters that are not base64url", "abcdefghijk2w500/p.jpg"],
      ["a length base64 cannot have", "abcdefghijk2abcde"],
      ["bytes that are not UTF-8", `abcdefghijk2${btoa(String.fromCharCode(0xff, 0xfe, 0xfd)).replace(/=+$/, "")}`],
      ["a whole address that is not one", tagOf("0", "not an address")],
      ["an address that is not http", tagOf("0", "ftp://images.example.invalid/p.jpg")],
      ["a script address", tagOf("0", "javascript:alert(1)")],
      ["a data address", tagOf("0", `data:image/png;base64,${"A".repeat(40)}`)],
    ];
    for (const [why, tag] of bad) expect(artCarriesKey(aio(tag)), why).toBe(true);
  });

  it("keeps one with no tag, and with only ordinary parameters", () => {
    expect(artCarriesKey(aio())).toBe(false);
    expect(artCarriesKey(`${AIO_BASE}/Items/${AIO_ID}/Images/Backdrop/0`)).toBe(false);
    expect(artCarriesKey(aio(undefined, "?quality=90&maxWidth=400"))).toBe(false);
    expect(artCarriesKey(aio(AIO_TAG, "&quality=90"))).toBe(false);
  });

  it("drops one with a parameter named as a key is, tag or no tag, and a long value under any other name", () => {
    for (const name of ["api_key", "ApiKey", "token", "access_token", "auth", "key"]) {
      expect(artCarriesKey(aio(undefined, `?${name}=abc`)), name).toBe(true);
      expect(artCarriesKey(aio(AIO_TAG, `&${name}=abc`)), `${name} with a clean tag`).toBe(true);
    }
    expect(artCarriesKey(aio(AIO_TAG, `&X-Emby-Authorization=${FAKE_KEY}`))).toBe(true);
    expect(artCarriesKey(aio(undefined, `?sig=${FAKE_KEY}`))).toBe(true);
  });

  it("judges every tag when there are two", () => {
    expect(artCarriesKey(aio(AIO_TAG, `&tag=${encodeURIComponent(tagOf("0", RPDB))}`))).toBe(true);
    expect(artCarriesKey(aio(AIO_TAG, `&tag=${encodeURIComponent(AIO_BACKDROP_TAG)}`))).toBe(false);
  });

  it("is for an item id of 32 lower case hex and an Images path at the end, and no other: anything else is the three rules", () => {
    const tag = `?tag=${encodeURIComponent(AIO_TAG)}`;
    for (const url of [
      `${AIO_BASE}/Items/${AIO_ID.toUpperCase()}/Images/Primary${tag}`,
      `${AIO_BASE}/Items/${AIO_ID}0/Images/Primary${tag}`,
      `${AIO_BASE}/Items/${AIO_ID}/Images/Primary/extra/more${tag}`,
      `${AIO_BASE}/Items/${AIO_ID}/Thumbs/Primary${tag}`,
      `${AIO_BASE}/Users/${AIO_ID}/Images/Primary${tag}`,
    ])
      expect(artCarriesKey(url), url).toBe(true);
  });
});

describe("building the settings file without logins: artwork that carries a key", () => {
  const DATA_COVER = `data:image/png;base64,${"A".repeat(60)}`;
  const watching = [
    { id: "tt1", title: "Keyed", art: RPDB, logo: METAHUB, rating: 8, posSec: 120, at: 4 },
    { id: "tt2", title: "Plain", art: METAHUB_BACKDROP, logo: TMDB, at: 3 },
    { id: "tt3", title: "Both keyed", art: `${METAHUB}?api_key=x`, logo: RPDB, at: 2 },
    { id: "tt4", title: "No art", at: 1 },
    "junk",
    null,
    7,
  ];
  const lists = [
    {
      id: "l1",
      name: "Weekend",
      at: 1,
      cover: DATA_COVER,
      entries: [
        { id: "tt1", title: "Keyed", kind: "movie", poster: RPDB, backdrop: TMDB_BACKDROP, logo: METAHUB, year: 1994, at: 2 },
        { id: "tt2", title: "Plain", kind: "movie", poster: METAHUB, at: 1 },
        { id: "tt3", title: "All keyed", kind: "series", poster: RPDB, backdrop: RPDB, logo: RPDB, at: 0 },
      ],
    },
    { id: "l2", name: "Empty", at: 2, entries: [] },
    { id: "l3", name: "Damaged", at: 3 },
    "junk",
  ];
  const seed = () => {
    put("watching", watching);
    put("lists", lists);
    put("favorites", ["p1:101"]);
  };
  const entries = (f: ReturnType<typeof buildSettingsFile>) => f.keys.watching.data as Array<Record<string, unknown>>;
  const listsOf = (f: ReturnType<typeof buildSettingsFile>) => f.keys.lists.data as Array<{ entries?: Array<Record<string, unknown>>; cover?: string }>;

  it("drops the keyed fields of Continue Watching, and keeps every entry with everything else it had", () => {
    seed();
    const w = entries(buildSettingsFile({ logins: false }));
    expect(w).toHaveLength(watching.length);
    expect(w[0]).toEqual({ id: "tt1", title: "Keyed", logo: METAHUB, rating: 8, posSec: 120, at: 4 });
    expect(w[0]).not.toHaveProperty("art");
    expect(w[1]).toEqual(watching[1]);
    expect(w[2]).toEqual({ id: "tt3", title: "Both keyed", at: 2 });
    expect(w[2]).not.toHaveProperty("art");
    expect(w[2]).not.toHaveProperty("logo");
    expect(w[3]).toEqual(watching[3]);
    expect(w.slice(4)).toEqual(["junk", null, 7]);
  });

  it("drops the keyed fields of the lists' entries, and keeps the lists, the entries and the cover", () => {
    seed();
    const l = listsOf(buildSettingsFile({ logins: false }));
    expect(l).toHaveLength(lists.length);
    expect(l[0].entries).toHaveLength(3);
    expect(l[0].entries![0]).toEqual({ id: "tt1", title: "Keyed", kind: "movie", backdrop: TMDB_BACKDROP, logo: METAHUB, year: 1994, at: 2 });
    expect(l[0].entries![0]).not.toHaveProperty("poster");
    expect(l[0].entries![1]).toEqual((lists[0] as { entries: unknown[] }).entries[1]);
    expect(l[0].entries![2]).toEqual({ id: "tt3", title: "All keyed", kind: "series", at: 0 });
    // The cover is the person's own upload, not an addon's artwork.
    expect(l[0].cover).toBe(DATA_COVER);
    expect(l[1]).toEqual(lists[1]);
    expect(l[2]).toEqual(lists[2]);
    expect(l[3]).toBe("junk");
  });

  it("is a file with no key's worth of an RPDB address anywhere in its text", () => {
    seed();
    const text = JSON.stringify(buildSettingsFile({ logins: false }));
    expect(text).not.toContain(FAKE_RPDB_KEY);
    expect(text).not.toContain("api.ratingposterdb.com/FAKE");
    expect(text).toContain("images.metahub.space");
    expect(text).toContain("image.tmdb.org");
  });

  it("keeps a signed-in AIOStreams title's art whose tag points at TMDB, and drops one whose tag holds an RPDB address", () => {
    put("watching", [
      { id: "a1", title: "Plain", art: aio(AIO_BACKDROP_TAG, "", "Backdrop/0"), logo: aio(AIO_LOGO_TAG, "", "Logo"), at: 2 },
      { id: "a2", title: "Keyed", art: aio(tagOf("0", RPDB), "", "Backdrop/0"), logo: aio(AIO_TAG), at: 1 },
    ]);
    const w = entries(buildSettingsFile({ logins: false }));
    expect(w).toEqual([
      { id: "a1", title: "Plain", art: aio(AIO_BACKDROP_TAG, "", "Backdrop/0"), logo: aio(AIO_LOGO_TAG, "", "Logo"), at: 2 },
      { id: "a2", title: "Keyed", logo: aio(AIO_TAG), at: 1 },
    ]);
    // Neither the key nor the way it was written is in the file.
    const text = JSON.stringify(buildSettingsFile({ logins: false }));
    expect(text).not.toContain(FAKE_RPDB_KEY);
    expect(text).not.toContain(b64url(RPDB));
    // As stored, with logins.
    expect(entries(buildSettingsFile({ logins: true }))[1].art).toBe(aio(tagOf("0", RPDB), "", "Backdrop/0"));
  });

  it("with logins keeps every address as stored, keyed or not", () => {
    seed();
    const f = buildSettingsFile({ logins: true });
    expect(f.keys.watching).toEqual({ v: 1, data: watching });
    expect(f.keys.lists).toEqual({ v: 1, data: lists });
    expect(JSON.stringify(f)).toContain(FAKE_RPDB_KEY);
  });

  it("changes nothing that is stored, and nothing else in the file", () => {
    seed();
    const before = JSON.stringify([...mem]);
    const f = buildSettingsFile({ logins: false });
    expect(JSON.stringify([...mem])).toBe(before);
    // The favourite is stored, and is not in a file made without the playlists.
    expect(f.keys).not.toHaveProperty("favorites");
    expect(f.includesLogins).toBe(false);
    expect(Object.keys(f.keys).sort()).toEqual(["lists", "watching"]);
  });

  it("looks only at the artwork fields of the two keys that have any", () => {
    expect(Object.keys(ART_FIELDS).sort()).toEqual(["lists", "watching"]);
    for (const k of Object.keys(ART_FIELDS)) expect(groupOf(k), k).toBe("yours");
    // A keyed address in some other field is not artwork, and is left.
    put("watching", [{ id: "tt1", title: RPDB, label: RPDB, fileName: RPDB, bingeGroup: RPDB, at: 1 }]);
    expect(entries(buildSettingsFile({ logins: false }))[0]).toEqual({ id: "tt1", title: RPDB, label: RPDB, fileName: RPDB, bingeGroup: RPDB, at: 1 });
  });

  it("is what an import then brings: the entry, with no artwork field to restore", () => {
    seed();
    const file = JSON.stringify(buildSettingsFile({ logins: false }));
    mem.clear();
    expect(applySettingsFile(file)).toMatchObject({ ok: true });
    const w = JSON.parse(stored("watching")!).data as Array<Record<string, unknown>>;
    expect(w[0]).toEqual({ id: "tt1", title: "Keyed", logo: METAHUB, rating: 8, posSec: 120, at: 4 });
    expect(w[1].art).toBe(METAHUB_BACKDROP);
  });

  it("takes a store that is not the shape it expects as it is", () => {
    put("watching", { not: "a list" });
    put("lists", [{ id: "l1", name: "x", at: 1, entries: "nope" }, { entries: [null, 3, "x", []] }]);
    const f = buildSettingsFile({ logins: false });
    expect(f.keys.watching).toEqual({ v: 1, data: { not: "a list" } });
    expect(f.keys.lists).toEqual({ v: 1, data: [{ id: "l1", name: "x", at: 1, entries: "nope" }, { entries: [null, 3, "x", []] }] });
  });
});
