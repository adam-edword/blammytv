import { beforeEach, describe, expect, it, vi } from "vitest";

// The node-env seam again (see languagePrefs.test.ts): localStorage and the
// event dispatch stood in for.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
const listeners = new Set<(e: Event) => void>();
vi.stubGlobal("window", {
  dispatchEvent: (e: Event) => {
    listeners.forEach((l) => l(e));
    return true;
  },
  addEventListener: (_: string, l: (e: Event) => void) => void listeners.add(l),
  removeEventListener: (_: string, l: (e: Event) => void) => void listeners.delete(l),
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
  AUTOPLAY_CHOICES,
  AUTOPLAY_TABS,
  LAST_MINUTE,
  UP_NEXT_CARD_TABS,
  countdownFrom,
  loadAutoplayNext,
  loadUpNextCard,
  onUpNextCardChange,
  saveAutoplayNext,
  saveUpNextCard,
  upNextWindow,
} = await import("./upNext");

const put = (key: string, data: unknown, v = 1) =>
  store.set(`blammytv.${key}`, JSON.stringify({ v, data }));

beforeEach(() => {
  store.clear();
  listeners.clear();
});

describe("Autoplay Next Episode", () => {
  it("is 10 seconds by default, which is what the card always counted", () => {
    expect(loadAutoplayNext()).toBe(10);
    expect(store.size).toBe(0);
  });

  it("keeps each choice, off included", () => {
    for (const v of AUTOPLAY_CHOICES) {
      saveAutoplayNext(v);
      expect(loadAutoplayNext()).toBe(v);
    }
  });

  it("reads anything that is not one of the choices as 10", () => {
    for (const junk of [7, -5, 11, "10", "off", null, true, [], {}, 5.5]) {
      store.clear();
      put("autoplayNext", junk);
      expect(loadAutoplayNext(), JSON.stringify(junk)).toBe(10);
    }
  });

  it("reads another version of the key as nothing stored", () => {
    put("autoplayNext", 20, 2);
    expect(loadAutoplayNext()).toBe(10);
  });

  it("counts down from the number, and off is a card that waits", () => {
    expect(countdownFrom(5)).toBe(5);
    expect(countdownFrom(10)).toBe(10);
    expect(countdownFrom(20)).toBe(20);
    expect(countdownFrom(0)).toBeNull();
  });

  it("offers Off, 5s, 10s and 20s, keyed by their seconds", () => {
    expect(AUTOPLAY_TABS.map((t) => t.label)).toEqual(["Off", "5s", "10s", "20s"]);
    expect(AUTOPLAY_TABS.map((t) => Number(t.key))).toEqual([...AUTOPLAY_CHOICES]);
  });
});

describe("Up Next Card", () => {
  it("is at the credits by default, which is what it always was", () => {
    expect(loadUpNextCard()).toBe("credits");
    expect(store.size).toBe(0);
  });

  it("keeps each choice and tells listeners", () => {
    const seen: string[] = [];
    const off = onUpNextCardChange((v) => seen.push(v));
    for (const v of ["last", "never", "credits"] as const) {
      saveUpNextCard(v);
      expect(loadUpNextCard()).toBe(v);
    }
    off();
    saveUpNextCard("last");
    expect(seen).toEqual(["last", "never", "credits"]);
  });

  it("reads anything else as at the credits", () => {
    for (const junk of ["Last", "minute", 60, null, true, {}]) {
      store.clear();
      put("upNextCard", junk);
      expect(loadUpNextCard(), JSON.stringify(junk)).toBe("credits");
    }
  });

  it("offers the three, in the order Settings draws them", () => {
    expect(UP_NEXT_CARD_TABS.map((t) => t.key)).toEqual(["credits", "last", "never"]);
    expect(UP_NEXT_CARD_TABS.map((t) => t.label)).toEqual(["At the credits", "Last minute", "Never"]);
  });
});

describe("upNextWindow", () => {
  const at = (pos: number, dur = 1440) => ({ pos, dur });

  it("at the credits follows the overlay's credits reading, whatever the clock says", () => {
    expect(upNextWindow("credits", true, at(10))).toBe(true);
    expect(upNextWindow("credits", false, at(1430))).toBe(false);
    expect(upNextWindow("credits", true, null)).toBe(true);
  });

  it("never is never", () => {
    expect(upNextWindow("never", true, at(1430))).toBe(false);
    expect(upNextWindow("never", false, at(1430))).toBe(false);
  });

  it("last minute opens 60 seconds from the end, markers or none", () => {
    expect(LAST_MINUTE).toBe(60);
    expect(upNextWindow("last", false, at(1379.9))).toBe(false);
    expect(upNextWindow("last", false, at(1380))).toBe(true);
    expect(upNextWindow("last", false, at(1439))).toBe(true);
    // The credits reading is not what it goes by.
    expect(upNextWindow("last", true, at(600))).toBe(false);
  });

  it("last minute needs a clock with a length", () => {
    expect(upNextWindow("last", false, null)).toBe(false);
    expect(upNextWindow("last", false, at(30, 0))).toBe(false);
  });
});
