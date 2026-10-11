import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// localStorage and window events, as playerPrefs.test.ts has them.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
const listeners = new Map<string, Set<(e: Event) => void>>();
vi.stubGlobal("window", {
  dispatchEvent: (e: Event) => {
    listeners.get((e as unknown as { type: string }).type)?.forEach((l) => l(e));
    return true;
  },
  addEventListener: (t: string, l: (e: Event) => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(l);
  },
  removeEventListener: (t: string, l: (e: Event) => void) => void listeners.get(t)?.delete(l),
});
vi.stubGlobal(
  "CustomEvent",
  class {
    detail: unknown;
    constructor(
      public type: string,
      init?: { detail?: unknown },
    ) {
      this.detail = init?.detail;
    }
  } as unknown as typeof CustomEvent,
);

// The native side: every call recorded, answered as a test says.
const mpvPrefs = vi.fn<(audio: string, scale: number) => Promise<void>>(() => Promise.resolve());
vi.mock("../../lib/tauri", () => ({ tauriMpvPrefs: (a: string, s: number) => mpvPrefs(a, s) }));

const { pushPlayerPrefs, resetPlayerPrefsSync, watchPlayerPrefs } = await import("./playerPrefsSync");
const { saveAudioChannels, saveSubtitleSize } = await import("./playerPrefs");

const put = (key: string, data: unknown) =>
  store.set(`blammytv.${key}`, JSON.stringify({ v: 1, data }));
/** Let a rejected promise's catch run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.clear();
  listeners.clear();
  mpvPrefs.mockClear();
  mpvPrefs.mockImplementation(() => Promise.resolve());
  resetPlayerPrefsSync();
});
afterEach(() => vi.restoreAllMocks());

describe("the player settings, sent to native", () => {
  it("at launch sends what is stored, both values in one call", () => {
    put("audioChannels", "7.1");
    put("subtitleSize", "large");
    const off = watchPlayerPrefs();
    expect(mpvPrefs.mock.calls).toEqual([["7.1", 1.25]]);
    off();
  });

  it("sends the defaults on a fresh profile: mpv's auto-safe, and a scale of 1", () => {
    const off = watchPlayerPrefs();
    expect(mpvPrefs.mock.calls).toEqual([["auto-safe", 1]]);
    off();
  });

  it("sends both values again when either changes", () => {
    const off = watchPlayerPrefs();
    mpvPrefs.mockClear();
    saveAudioChannels("stereo");
    saveSubtitleSize("larger");
    saveAudioChannels("5.1");
    expect(mpvPrefs.mock.calls).toEqual([
      ["stereo", 1],
      ["stereo", 1.5],
      ["5.1", 1.5],
    ]);
    off();
  });

  it("is one call for one payload: launch twice (StrictMode) or save the same choice", () => {
    const a = watchPlayerPrefs();
    const b = watchPlayerPrefs();
    expect(mpvPrefs).toHaveBeenCalledTimes(1);
    saveAudioChannels("auto");
    expect(mpvPrefs).toHaveBeenCalledTimes(1);
    a();
    b();
  });

  it("stops sending once told to stop", () => {
    const off = watchPlayerPrefs();
    off();
    mpvPrefs.mockClear();
    saveAudioChannels("stereo");
    saveSubtitleSize("small");
    expect(mpvPrefs).not.toHaveBeenCalled();
  });
});

describe("a native build that has no such command", () => {
  it("is taken quietly: the rejection is caught and settings still save", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mpvPrefs.mockImplementation(() => Promise.reject("command mpv_prefs not found"));
    const off = watchPlayerPrefs();
    await settle();
    saveAudioChannels("stereo");
    await settle();
    expect(() => saveSubtitleSize("large")).not.toThrow();
    await settle();
    // Tried again at each change, said once.
    expect(mpvPrefs).toHaveBeenCalledTimes(3);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[1])).toContain("not found");
    off();
  });

  it("does not cost the setting its place: it is stored whatever native said", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    mpvPrefs.mockImplementation(() => Promise.reject("nope"));
    const off = watchPlayerPrefs();
    saveAudioChannels("7.1");
    await settle();
    expect(JSON.parse(store.get("blammytv.audioChannels")!).data).toBe("7.1");
    off();
  });

  it("pushes again after a failed push, even for the same payload", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    mpvPrefs.mockImplementationOnce(() => Promise.reject("nope"));
    pushPlayerPrefs();
    await settle();
    pushPlayerPrefs();
    expect(mpvPrefs).toHaveBeenCalledTimes(2);
  });
});
