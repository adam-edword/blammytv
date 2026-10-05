import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAioUrl, saveAioUrl } from "../settings/aiostreams";
import { loadAioWatched, replaceAioWatched } from "../stream/watched";
import {
  dropFromQueue,
  forgetAiojf,
  forgetCount,
  loadAiojf,
  loadQueue,
  noteSignIn,
  playedSettled,
  queuePlayed,
  saveAiojf,
} from "./store";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

describe("the queue of played marks AIOStreams has not taken yet", () => {
  beforeEach(() => localStorage.clear());

  it("keeps an id once, however often it was finished", () => {
    queuePlayed("a1");
    queuePlayed("a1");
    queuePlayed("b2");
    expect(loadQueue()).toEqual(["a1", "b2"]);
  });

  it("drops only what was sent, so one queued meanwhile stays", () => {
    queuePlayed("a1");
    queuePlayed("b2");
    const sending = loadQueue();
    queuePlayed("c3");
    dropFromQueue(sending);
    expect(loadQueue()).toEqual(["c3"]);
  });

  it("reads a damaged queue as empty", () => {
    localStorage.setItem("blammytv.aiojfQueue", JSON.stringify({ v: 1, data: { not: "a list" } }));
    expect(loadQueue()).toEqual([]);
  });
});

describe("which of AIOStreams' answers settle a played mark", () => {
  it("settles on a 2xx, and on a 404 it will never change", () => {
    for (const status of [200, 204, 404]) expect(playedSettled(status), String(status)).toBe(true);
  });

  it("keeps the mark for a 401 and for every kind of not now", () => {
    for (const status of [401, 403, 408, 429, 500, 502, 503, 400, 0]) expect(playedSettled(status), String(status)).toBe(false);
  });
});

describe("signing out", () => {
  beforeEach(() => localStorage.clear());

  it("clears the bookkeeping, the queue and the ticks, and moves the count a sync checks against", () => {
    saveAiojf({ lastSync: 5, base: "http://x/jellyfin", unpackable: 2 });
    queuePlayed("a1");
    replaceAioWatched({ episodes: { tt1: ["tt1:1:1"] }, films: ["tt2"] });
    const before = forgetCount();
    forgetAiojf();
    expect(forgetCount()).toBe(before + 1);
    expect(loadAiojf()).toEqual({});
    expect(loadQueue()).toEqual([]);
    expect(loadAioWatched()).toEqual({ episodes: {}, films: [] });
  });
});

describe("the sign-in this device holds", () => {
  beforeEach(() => localStorage.clear());
  const BASE = "https://aio.example.com/jellyfin";
  const on = { supported: true, connected: true, userName: "Adam", userId: "u1", base: BASE };

  it("is recorded from a connected status, with the user's name and no id", () => {
    noteSignIn(on, true);
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
    expect(JSON.stringify(loadAiojf())).not.toContain("u1");
  });

  it("follows a changed user or base", () => {
    noteSignIn(on, true);
    noteSignIn({ ...on, userName: "Eve" }, true);
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Eve" });
  });

  it("is cleared by a status that is not connected", () => {
    noteSignIn(on, true);
    noteSignIn({ supported: true, connected: false }, false);
    expect(loadAiojf().signedIn).toBeUndefined();
  });

  it("is not recorded for a build that cannot open sources, and is cleared on one that stops", () => {
    noteSignIn(on, false);
    expect(loadAiojf().signedIn).toBeUndefined();
    noteSignIn(on, true);
    noteSignIn(on, false);
    expect(loadAiojf().signedIn).toBeUndefined();
  });

  it("is not touched by a build that has no sync at all, which can tell nothing", () => {
    noteSignIn(on, true);
    noteSignIn({ supported: false, connected: false }, false);
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
  });

  it("is not recorded without a base to read from", () => {
    noteSignIn({ supported: true, connected: true, userName: "Adam" }, true);
    expect(loadAiojf().signedIn).toBeUndefined();
  });

  it("stays through a sync's saves and goes with a sign-out", () => {
    noteSignIn(on, true);
    saveAiojf({ lastSync: 5, problem: undefined });
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
    forgetAiojf();
    expect(loadAiojf().signedIn).toBeUndefined();
  });
});

describe("a manifest URL, once there is a sign-in (plan 024, D4)", () => {
  const BASE = "https://aio.example.com/jellyfin";
  const on = { supported: true, connected: true, userName: "Adam", userId: "u1", base: BASE };
  const MANIFEST = "https://aio.example.com/stremio/abc/manifest.json";
  // saveAioUrl says it changed on the window; there is none in these tests.
  const said = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    said.mockClear();
    vi.stubGlobal("window", { dispatchEvent: said });
  });
  // Only the window: unstubAllGlobals would take the localStorage above too.
  afterEach(() => void Reflect.deleteProperty(globalThis, "window"));

  it("is deleted when a sign-in first lands, and the sign-in is kept", () => {
    saveAioUrl(MANIFEST);
    said.mockClear();
    noteSignIn(on, true);
    expect(loadAioUrl()).toBe("");
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
    // It said the URL changed, so Settings' field lets go of it.
    expect(said).toHaveBeenCalledTimes(1);
  });

  it("takes the catalog mirror with it: its key held the URL (stream/source.ts configKey)", () => {
    saveAioUrl(MANIFEST);
    // As diskSave writes it: keyed by `manifest:<url>` inside configKey.
    const mirror = JSON.stringify({ v: 2, data: { key: JSON.stringify([`manifest:${MANIFEST}`, [], 40]), at: 1, items: [], rows: [], featured: [] } });
    localStorage.setItem("blammytv.vodCache", mirror);
    noteSignIn(on, true);
    expect(localStorage.getItem("blammytv.vodCache")).toBeNull();
    expect([...mem.values()].some((v) => v.includes(MANIFEST))).toBe(false);
  });

  it("leaves the catalog mirror alone when there was no URL to delete (a sign-in's own mirror)", () => {
    const mirror = JSON.stringify({ v: 2, data: { key: JSON.stringify([`signin:${BASE}|Adam`, [], 40]), at: 1, items: [], rows: [], featured: [] } });
    localStorage.setItem("blammytv.vodCache", mirror);
    noteSignIn(on, true);
    noteSignIn(on, true);
    expect(localStorage.getItem("blammytv.vodCache")).toBe(mirror);
  });

  it("is kept on a build that cannot open sources, which records no sign-in", () => {
    saveAioUrl(MANIFEST);
    localStorage.setItem("blammytv.vodCache", "{}");
    noteSignIn(on, false);
    expect(loadAioUrl()).toBe(MANIFEST);
    expect(loadAiojf().signedIn).toBeUndefined();
    // Its mirror is the manifest's, still in use.
    expect(localStorage.getItem("blammytv.vodCache")).toBe("{}");
  });

  it("is deleted for a sign-in recorded before D4 too, the next time it is read", () => {
    // v0.11.17 recorded sign-ins without deleting anything.
    noteSignIn(on, true);
    saveAioUrl(MANIFEST);
    noteSignIn(on, true);
    expect(loadAioUrl()).toBe("");
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
  });

  it("is stored, changed and removed without touching the sign-in", () => {
    noteSignIn(on, true);
    saveAioUrl(MANIFEST);
    saveAioUrl(MANIFEST + "?x=1");
    saveAioUrl("");
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
  });
});
