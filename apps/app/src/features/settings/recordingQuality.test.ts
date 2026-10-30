import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: the browser globals the storage seam and the change event read.
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

const setSmaller = vi.fn<(on: boolean) => Promise<void>>(() => Promise.resolve());
vi.mock("../../lib/tauri", () => ({ tauriRecSetSmaller: (on: boolean) => setSmaller(on) }));

const { loadRecordingQuality, resetRecordingQualitySync, saveRecordingQuality, watchRecordingQuality } =
  await import("./recordingQuality");

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.clear();
  listeners.clear();
  setSmaller.mockClear();
  setSmaller.mockImplementation(() => Promise.resolve());
  resetRecordingQualitySync();
});

describe("recording quality", () => {
  it("is Original Quality with nothing stored", () => {
    expect(loadRecordingQuality()).toBe("original");
  });

  it("keeps what was saved", () => {
    saveRecordingQuality("smaller");
    expect(loadRecordingQuality()).toBe("smaller");
    saveRecordingQuality("original");
    expect(loadRecordingQuality()).toBe("original");
  });

  it("is stored under its own key, versioned like the others", () => {
    saveRecordingQuality("smaller");
    expect(store.get("blammytv.recordingQuality")).toBe(JSON.stringify({ v: 1, data: "smaller" }));
  });

  it("reads a value this build doesn't offer as Original Quality", () => {
    store.set("blammytv.recordingQuality", JSON.stringify({ v: 1, data: "tiny" }));
    expect(loadRecordingQuality()).toBe("original");
  });
});

describe("recording quality, sent to native", () => {
  it("at launch says false for the default, so a waiting shrink is let go", () => {
    const off = watchRecordingQuality();
    expect(setSmaller.mock.calls).toEqual([[false]]);
    off();
  });

  it("at launch says true when Smaller Files is stored", () => {
    saveRecordingQuality("smaller");
    setSmaller.mockClear();
    const off = watchRecordingQuality();
    expect(setSmaller.mock.calls).toEqual([[true]]);
    off();
  });

  it("says each change, false included, and one call for the same value twice", () => {
    const off = watchRecordingQuality();
    saveRecordingQuality("smaller");
    saveRecordingQuality("smaller");
    saveRecordingQuality("original");
    expect(setSmaller.mock.calls).toEqual([[false], [true], [false]]);
    off();
  });

  it("stops listening when told to", () => {
    const off = watchRecordingQuality();
    off();
    saveRecordingQuality("smaller");
    expect(setSmaller.mock.calls).toEqual([[false]]);
  });

  it("takes a native without the command quietly, and tries again at the next change", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    setSmaller.mockImplementation(() => Promise.reject("unknown command"));
    const off = watchRecordingQuality();
    await settle();
    setSmaller.mockImplementation(() => Promise.resolve());
    saveRecordingQuality("original"); // the same value as the failed push: sent again
    expect(setSmaller.mock.calls).toEqual([[false], [false]]);
    expect(info).toHaveBeenCalled();
    off();
    info.mockRestore();
  });
});
