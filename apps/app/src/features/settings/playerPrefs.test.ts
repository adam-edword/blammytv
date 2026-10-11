import { beforeEach, describe, expect, it, vi } from "vitest";

// The node-env seam again (see upNext.test.ts): localStorage and the event
// dispatch stood in for.
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

const {
  AUDIO_CHANNEL_TABS,
  POPOUT_CORNERS,
  POPOUT_SIZE_TABS,
  SUBTITLE_SIZE_TABS,
  loadAudioChannels,
  loadPopoutCorner,
  loadPopoutSize,
  loadSubtitleSize,
  mpvAudioChannels,
  onAudioChannelsChange,
  onPopoutCornerChange,
  onPopoutSizeChange,
  onSubtitleSizeChange,
  popoutPlace,
  saveAudioChannels,
  savePopoutCorner,
  savePopoutSize,
  saveSubtitleSize,
  subScale,
} = await import("./playerPrefs");

const put = (key: string, data: unknown, v = 1) =>
  store.set(`blammytv.${key}`, JSON.stringify({ v, data }));

beforeEach(() => {
  store.clear();
  listeners.clear();
});

describe("Audio Channels", () => {
  it("is Automatic by default, and a fresh profile stores nothing", () => {
    expect(loadAudioChannels()).toBe("auto");
    expect(store.size).toBe(0);
  });

  it("keeps each choice", () => {
    for (const v of ["stereo", "5.1", "7.1", "auto"] as const) {
      saveAudioChannels(v);
      expect(loadAudioChannels()).toBe(v);
    }
  });

  it("reads anything that is not one of the four as Automatic", () => {
    for (const junk of ["quadraphonic", "Stereo", "auto-safe", "5", 5.1, 2, "", null, true, [], {}]) {
      store.clear();
      put("audioChannels", junk);
      expect(loadAudioChannels(), JSON.stringify(junk)).toBe("auto");
    }
  });

  it("reads another version of the key as nothing stored", () => {
    put("audioChannels", "7.1", 2);
    expect(loadAudioChannels()).toBe("auto");
  });

  it("offers Automatic, Stereo, 5.1 and 7.1, in that order", () => {
    expect(AUDIO_CHANNEL_TABS.map((t) => t.label)).toEqual(["Automatic", "Stereo", "5.1", "7.1"]);
    expect(AUDIO_CHANNEL_TABS.map((t) => t.key)).toEqual(["auto", "stereo", "5.1", "7.1"]);
  });

  it("tells native mpv's words: Automatic is auto-safe, the rest as they are", () => {
    expect(mpvAudioChannels("auto")).toBe("auto-safe");
    expect(mpvAudioChannels("stereo")).toBe("stereo");
    expect(mpvAudioChannels("5.1")).toBe("5.1");
    expect(mpvAudioChannels("7.1")).toBe("7.1");
  });

  it("tells listeners what was chosen, until they stop listening", () => {
    const seen: string[] = [];
    const off = onAudioChannelsChange((v) => seen.push(v));
    saveAudioChannels("stereo");
    saveAudioChannels("7.1");
    off();
    saveAudioChannels("5.1");
    expect(seen).toEqual(["stereo", "7.1"]);
  });

  it("gives a listener a choice it offers, whatever an event carries", () => {
    const seen: string[] = [];
    onAudioChannelsChange((v) => seen.push(v));
    window.dispatchEvent(new CustomEvent("blammytv:audio-channels", { detail: "quadraphonic" }));
    expect(seen).toEqual(["auto"]);
  });
});

describe("Subtitle Size", () => {
  it("is Normal by default, and a fresh profile stores nothing", () => {
    expect(loadSubtitleSize()).toBe("normal");
    expect(store.size).toBe(0);
  });

  it("keeps each choice", () => {
    for (const v of ["small", "large", "larger", "normal"] as const) {
      saveSubtitleSize(v);
      expect(loadSubtitleSize()).toBe(v);
    }
  });

  it("reads anything that is not one of the four as Normal", () => {
    for (const junk of ["huge", "Large", "1.25", 1.25, 0, "", null, true, [], {}]) {
      store.clear();
      put("subtitleSize", junk);
      expect(loadSubtitleSize(), JSON.stringify(junk)).toBe("normal");
    }
    put("subtitleSize", "large", 3);
    expect(loadSubtitleSize()).toBe("normal");
  });

  it("offers Small, Normal, Large and Larger, in that order", () => {
    expect(SUBTITLE_SIZE_TABS.map((t) => t.label)).toEqual(["Small", "Normal", "Large", "Larger"]);
  });

  it("scales them 0.8, 1, 1.25 and 1.5", () => {
    expect(SUBTITLE_SIZE_TABS.map((t) => subScale(t.key))).toEqual([0.8, 1, 1.25, 1.5]);
  });

  it("scales inside the range native keeps (0.5 to 2)", () => {
    for (const t of SUBTITLE_SIZE_TABS) {
      expect(subScale(t.key)).toBeGreaterThanOrEqual(0.5);
      expect(subScale(t.key)).toBeLessThanOrEqual(2);
    }
  });

  it("tells listeners what was chosen, until they stop listening", () => {
    const seen: string[] = [];
    const off = onSubtitleSizeChange((v) => seen.push(v));
    saveSubtitleSize("large");
    off();
    saveSubtitleSize("small");
    expect(seen).toEqual(["large"]);
  });
});

describe("Pop-out", () => {
  it("is Large and centred by default, which is what it always was", () => {
    expect(loadPopoutSize()).toBe("large");
    expect(loadPopoutCorner()).toBe("center");
    expect(popoutPlace()).toEqual({ size: "large", corner: "center" });
    expect(store.size).toBe(0);
  });

  it("keeps each size and each corner", () => {
    for (const v of ["small", "medium", "large"] as const) {
      savePopoutSize(v);
      expect(loadPopoutSize()).toBe(v);
    }
    for (const v of ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const) {
      savePopoutCorner(v);
      expect(loadPopoutCorner()).toBe(v);
    }
  });

  it("reads anything else as the default", () => {
    for (const junk of ["huge", "Small", "25%", 25, "", null, true, [], {}]) {
      store.clear();
      put("popoutSize", junk);
      expect(loadPopoutSize(), JSON.stringify(junk)).toBe("large");
    }
    for (const junk of ["top", "centre", "Top-Left", "+24+24", 1, "", null, true, [], {}]) {
      store.clear();
      put("popoutCorner", junk);
      expect(loadPopoutCorner(), JSON.stringify(junk)).toBe("center");
    }
    put("popoutSize", "small", 2);
    put("popoutCorner", "top-left", 2);
    expect(popoutPlace()).toEqual({ size: "large", corner: "center" });
  });

  it("hands popout_open both, as they stand when it opens", () => {
    savePopoutSize("small");
    savePopoutCorner("bottom-right");
    expect(popoutPlace()).toEqual({ size: "small", corner: "bottom-right" });
    savePopoutCorner("top-left");
    expect(popoutPlace()).toEqual({ size: "small", corner: "top-left" });
  });

  it("offers three sizes and the centre then four corners", () => {
    expect(POPOUT_SIZE_TABS.map((t) => t.label)).toEqual(["Small", "Medium", "Large"]);
    expect(POPOUT_SIZE_TABS.map((t) => t.key)).toEqual(["small", "medium", "large"]);
    expect(POPOUT_CORNERS.map((t) => t.label)).toEqual([
      "Centre",
      "Top left",
      "Top right",
      "Bottom left",
      "Bottom right",
    ]);
    // The keys are the words native reads (mpvprefs.rs).
    expect(POPOUT_CORNERS.map((t) => t.key)).toEqual([
      "center",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
  });

  it("tells listeners, each for its own", () => {
    const sizes: string[] = [];
    const corners: string[] = [];
    onPopoutSizeChange((v) => sizes.push(v));
    onPopoutCornerChange((v) => corners.push(v));
    savePopoutSize("medium");
    savePopoutCorner("top-right");
    expect(sizes).toEqual(["medium"]);
    expect(corners).toEqual(["top-right"]);
  });
});
