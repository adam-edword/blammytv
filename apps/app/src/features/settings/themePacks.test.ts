import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PACK,
  THEME_PACKS,
  applyThemePack,
  injectPackCss,
  loadThemePack,
  saveThemePack,
} from "./themePacks";

// Same node-env seam as playbackPrefs.test.ts/watching.test.ts — vitest runs
// without a DOM here, so localStorage and the bits of `document` this module
// touches (documentElement.dataset, head.querySelector/createElement) are
// stubbed by hand rather than pulled from jsdom (not a repo dependency).
// The stub instances are kept in local, plainly-typed handles so assertions
// don't have to fight lib.dom's real (read-only) Document/HTMLCollection
// types — only the global `document` binding itself needs to satisfy them.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

interface FakeStyle {
  dataset: Record<string, string>;
  textContent: string;
  remove: () => void;
}

const fakeDocumentElement = { dataset: {} as Record<string, string> };
const fakeHeadChildren: FakeStyle[] = [];
const fakeHead = {
  children: fakeHeadChildren,
  appendChild(el: FakeStyle) {
    fakeHeadChildren.push(el);
    return el;
  },
  querySelector(selector: string): FakeStyle | null {
    const match = /style\[data-pack-css="([^"]+)"\]/.exec(selector);
    if (!match) return null;
    return fakeHeadChildren.find((el) => el.dataset.packCss === match[1]) ?? null;
  },
};

vi.stubGlobal("document", {
  documentElement: fakeDocumentElement,
  head: fakeHead,
  createElement(tag: string): FakeStyle {
    void tag; // always "style" here — no need to branch on it
    const el: FakeStyle = {
      dataset: {},
      textContent: "",
      remove: () => {
        const i = fakeHeadChildren.indexOf(el);
        if (i >= 0) fakeHeadChildren.splice(i, 1);
      },
    };
    return el;
  },
});

describe("themePacks", () => {
  beforeEach(() => {
    store.clear();
    delete fakeDocumentElement.dataset.themePack;
    fakeHeadChildren.length = 0;
  });

  it("defaults to classic", () => {
    expect(loadThemePack()).toBe("classic");
    expect(DEFAULT_PACK).toBe("classic");
  });

  it("round-trips a saved pack", () => {
    saveThemePack("void");
    expect(loadThemePack()).toBe("void");
  });

  it("returns an unknown stored id as-is (forward-compat for paid packs)", () => {
    saveThemePack("neon-2027");
    expect(loadThemePack()).toBe("neon-2027");
  });

  it("lists classic first, then void, slate, paper", () => {
    expect(THEME_PACKS.map((p) => p.id)).toEqual([
      "classic",
      "void",
      "slate",
      "paper",
    ]);
  });

  it("applies a pack via the root dataset attribute", () => {
    applyThemePack("slate");
    expect(fakeDocumentElement.dataset.themePack).toBe("slate");
  });

  it("removes the attribute for classic", () => {
    applyThemePack("slate");
    applyThemePack("classic");
    expect(fakeDocumentElement.dataset.themePack).toBeUndefined();
  });

  it("injects a style element carrying the pack id and css", () => {
    injectPackCss("void", ":root { --surface: #050505; }");
    const el = fakeHead.querySelector('style[data-pack-css="void"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe(":root { --surface: #050505; }");
  });

  it("replaces rather than duplicates on re-injection of the same id", () => {
    injectPackCss("void", "/* first */");
    injectPackCss("void", "/* second */");
    const matches = fakeHeadChildren.filter((el) => el.dataset.packCss === "void");
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toBe("/* second */");
  });

  it("lets two different pack ids coexist", () => {
    injectPackCss("void", "/* void */");
    injectPackCss("slate", "/* slate */");
    expect(fakeHeadChildren).toHaveLength(2);
    expect(
      fakeHead.querySelector('style[data-pack-css="void"]')?.textContent,
    ).toBe("/* void */");
    expect(
      fakeHead.querySelector('style[data-pack-css="slate"]')?.textContent,
    ).toBe("/* slate */");
  });
});
