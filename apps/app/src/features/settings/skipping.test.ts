import { beforeEach, describe, expect, it, vi } from "vitest";

// Same node-env seam as languagePrefs.test.ts: no DOM, so localStorage and the
// event dispatch are stood in for. The window keeps its listeners, so the
// change event can be seen arriving.
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
  DEFAULT_SKIPPING,
  fromSkipBehavior,
  loadSkipping,
  normalizeSkipping,
  onSkippingChange,
  saveSkipping,
} = await import("./skipping");

const put = (key: string, data: unknown, v = 1) =>
  store.set(`blammytv.${key}`, JSON.stringify({ v, data }));
const stored = (key: string) => JSON.parse(store.get(`blammytv.${key}`) ?? "null");

const ALL_OFF = { intro: "off", recap: "off", credits: "off", preview: "off", combine: false };

beforeEach(() => {
  store.clear();
  listeners.clear();
});

describe("skipping defaults", () => {
  it("is a button for every type with combine off, which is what the old normal was", () => {
    expect(loadSkipping()).toEqual({
      intro: "button",
      recap: "button",
      credits: "button",
      preview: "button",
      combine: false,
    });
    expect(loadSkipping()).toEqual(DEFAULT_SKIPPING);
  });

  it("stores nothing just by being read on a fresh profile", () => {
    loadSkipping();
    expect(store.size).toBe(0);
  });
});

describe("skipping round trip", () => {
  it("keeps each type's mode and the combine switch", () => {
    saveSkipping({ intro: "auto", recap: "off", credits: "auto", preview: "button", combine: true });
    expect(loadSkipping()).toEqual({ intro: "auto", recap: "off", credits: "auto", preview: "button", combine: true });
    expect(stored("skipping")).toEqual({
      v: 1,
      data: { intro: "auto", recap: "off", credits: "auto", preview: "button", combine: true },
    });
  });

  it("tells listeners, and stops when they unsubscribe", () => {
    const seen: unknown[] = [];
    const off = onSkippingChange((v) => seen.push(v));
    saveSkipping({ ...DEFAULT_SKIPPING, intro: "auto" });
    off();
    saveSkipping({ ...DEFAULT_SKIPPING, intro: "off" });
    expect(seen).toEqual([{ ...DEFAULT_SKIPPING, intro: "auto" }]);
  });
});

describe("skipping validation", () => {
  it("takes the default for a field that is not right, and keeps the ones that are", () => {
    put("skipping", { intro: "auto", recap: "sometimes", credits: 3, combine: "yes" });
    expect(loadSkipping()).toEqual({ ...DEFAULT_SKIPPING, intro: "auto" });
  });

  it("reads a value that is not an object as the defaults", () => {
    for (const junk of ["hidden", 7, [], true, null]) {
      store.clear();
      put("skipping", junk);
      expect(loadSkipping(), JSON.stringify(junk)).toEqual(DEFAULT_SKIPPING);
    }
  });

  it("combine is on only for a real true", () => {
    expect(normalizeSkipping({ combine: true }).combine).toBe(true);
    for (const v of [1, "true", "on", null, undefined]) expect(normalizeSkipping({ combine: v }).combine).toBe(false);
  });

  it("a version of the key this build does not know is read as nothing stored", () => {
    put("skipping", { ...DEFAULT_SKIPPING, intro: "auto" }, 99);
    expect(loadSkipping()).toEqual(DEFAULT_SKIPPING);
  });

  it("normalizes what the change event sends", () => {
    const seen: unknown[] = [];
    onSkippingChange((v) => seen.push(v));
    window.dispatchEvent(new CustomEvent("blammytv:skipping", { detail: { intro: "bogus", combine: true } }));
    expect(seen).toEqual([{ ...DEFAULT_SKIPPING, combine: true }]);
  });
});

describe("the move from Skip Behavior", () => {
  it("hidden is every type off", () => {
    expect(fromSkipBehavior("hidden")).toEqual(ALL_OFF);
    put("skipBehavior", "hidden");
    expect(loadSkipping()).toEqual(ALL_OFF);
  });

  it("combine is every type a button, with combine on", () => {
    expect(fromSkipBehavior("combine")).toEqual({ ...DEFAULT_SKIPPING, combine: true });
    put("skipBehavior", "combine");
    expect(loadSkipping()).toEqual({
      intro: "button",
      recap: "button",
      credits: "button",
      preview: "button",
      combine: true,
    });
  });

  it("normal, and anything the old loader read as normal, is the defaults", () => {
    for (const old of ["normal", "bogus", 5, null, undefined]) {
      expect(fromSkipBehavior(old), String(old)).toBeNull();
    }
    put("skipBehavior", "normal");
    expect(loadSkipping()).toEqual(DEFAULT_SKIPPING);
  });

  it("happens once: the choice is written to the new key, and the old key is not asked again", () => {
    put("skipBehavior", "hidden");
    loadSkipping();
    expect(stored("skipping")).toEqual({ v: 1, data: ALL_OFF });
    // Even if the old key changed afterwards, the new one is what counts.
    put("skipBehavior", "combine");
    expect(loadSkipping()).toEqual(ALL_OFF);
  });

  it("never overrides a choice already made under the new key", () => {
    put("skipBehavior", "hidden");
    put("skipping", { ...DEFAULT_SKIPPING, recap: "auto" });
    expect(loadSkipping()).toEqual({ ...DEFAULT_SKIPPING, recap: "auto" });
  });

  it("an old key from another version is not trusted", () => {
    put("skipBehavior", "hidden", 2);
    expect(loadSkipping()).toEqual(DEFAULT_SKIPPING);
  });
});
