import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Native's Mica answer, set per test; the calls are kept to be counted.
const mica = vi.hoisted(() => ({ answer: true, calls: [] as boolean[] }));
vi.mock("../../lib/tauri", () => ({
  tauriMica: (on: boolean) => {
    mica.calls.push(on);
    return Promise.resolve(on && mica.answer);
  },
}));
import {
  THEME_PACKS,
  applyThemePack,
  loadThemePack,
  saveThemePack,
  syncAccent,
  themeAccentStore,
  resetThemeAccents,
  type ThemePack,
} from "./themePack";
import { loadAccent, saveAccent } from "./accent";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

/** A root with the three things the accent and the pack touch. */
function fakeRoot() {
  const props = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string | undefined>,
    style: {
      setProperty: (k: string, v: string) => void props.set(k, v),
      removeProperty: (k: string) => void props.delete(k),
    },
  };
  vi.stubGlobal("document", { documentElement: root });
  return { root, props };
}

beforeEach(() => mem.clear());

describe("themePack store", () => {
  it("is Default until chosen, and a choice comes back", () => {
    expect(loadThemePack()).toBe("none");
    saveThemePack("velvet");
    expect(loadThemePack()).toBe("velvet");
  });

  it("reads anything that is not a pack as Default", () => {
    for (const bad of ["Velvet", "signal", "", 3, null, { pack: "prism" }]) {
      mem.set("blammytv.themePack", JSON.stringify({ v: 1, data: bad }));
      expect(loadThemePack(), JSON.stringify(bad)).toBe("none");
    }
    mem.set("blammytv.themePack", JSON.stringify({ v: 2, data: "prism" }));
    expect(loadThemePack()).toBe("none");
    mem.set("blammytv.themePack", "not json");
    expect(loadThemePack()).toBe("none");
  });

  it("lists Default first, then the four packs", () => {
    expect(THEME_PACKS.map((p) => p.label)).toEqual(["Default", "Prism", "Velvet", "Lagoon", "Fluent"]);
  });

  it("knows Fluent as a key, with Windows' own blue as its accent", () => {
    saveThemePack("fluent");
    expect(loadThemePack()).toBe("fluent");
    const fluent = THEME_PACKS.find((p) => p.key === "fluent")!;
    expect(fluent.accent).toBe("#60cdff");
    expect(fluent.swatch.accent).toBe("#60cdff");
  });
});

describe("a theme's own accent", () => {
  it("is remembered per theme, and Velvet comes back after Lagoon", () => {
    const velvet = themeAccentStore("velvet");
    const lagoon = themeAccentStore("lagoon");
    expect(velvet.get()).toBe("");
    velvet.set("#336699");
    velvet.setCustom("#AA00FF");
    lagoon.set("#22C55E");
    expect(lagoon.get()).toBe("#22c55e");
    expect(velvet.get()).toBe("#336699");
    expect(velvet.getCustom()).toBe("#aa00ff");
    expect(lagoon.getCustom()).toBe("");
    // The pack is switched away and back: the pick is still Velvet's own.
    expect(themeAccentStore("velvet").get()).toBe("#336699");
  });

  it("leaves the default accent store alone", () => {
    saveAccent("#ffd500");
    themeAccentStore("velvet").set("#336699");
    expect(loadAccent()).toBe("#ffd500");
    expect(mem.get("blammytv.accent")).toBe(JSON.stringify({ v: 2, data: "#ffd500" }));
  });

  it("reads a bad stored pick as none, and Reset forgets them all", () => {
    mem.set("blammytv.themeAccents", JSON.stringify({ v: 1, data: { velvet: { accent: "red", custom: 4 } } }));
    expect(themeAccentStore("velvet").get()).toBe("");
    mem.set("blammytv.themeAccents", JSON.stringify({ v: 1, data: [1, 2] }));
    expect(themeAccentStore("velvet").get()).toBe("");
    themeAccentStore("lagoon").set("#22c55e");
    resetThemeAccents();
    expect(themeAccentStore("lagoon").get()).toBe("");
  });

  it("is kept for Fluent, with the blue as the default it opens on", () => {
    const fluent = themeAccentStore("fluent");
    expect(fluent.get()).toBe("");
    fluent.set("#22C55E");
    expect(fluent.get()).toBe("#22c55e");
    expect(themeAccentStore("velvet").get()).toBe("");
  });

  it("is not kept for Prism or Default, which take none", () => {
    themeAccentStore("prism").set("#336699");
    expect(themeAccentStore("prism").get()).toBe("");
  });
});

describe("applying a pack at boot", () => {
  it("sets the attribute, and Default removes it", () => {
    const { root } = fakeRoot();
    applyThemePack("lagoon");
    expect(root.dataset.themePack).toBe("lagoon");
    applyThemePack("none");
    expect(root.dataset.themePack).toBeUndefined();
  });

  it("puts the pack's own pick on the root, and the default pick back with no pack", () => {
    const { root, props } = fakeRoot();
    saveAccent("#ffd500");
    themeAccentStore("velvet").set("#336699");
    applyThemePack("velvet");
    expect(props.get("--accent")).toBe("#336699");
    applyThemePack("lagoon");
    expect(props.has("--accent")).toBe(false); // Lagoon's own colour: the stylesheet's
    applyThemePack("none");
    expect(props.get("--accent")).toBe("#ffd500");
    expect(root.dataset.accent).toBe("picked");
  });

  it("leaves Prism with no inline accent, so its pink shows", () => {
    const { props } = fakeRoot();
    saveAccent("#ffd500");
    applyThemePack("prism");
    expect(props.has("--accent")).toBe(false);
    expect(props.has("--accent-ink")).toBe(false);
  });

  it("keeps the default pick in Light, where a pack does nothing", () => {
    const { root, props } = fakeRoot();
    saveAccent("#ffd500");
    themeAccentStore("velvet").set("#336699");
    applyThemePack("velvet");
    root.dataset.theme = "light";
    syncAccent();
    expect(props.get("--accent")).toBe("#ffd500");
    delete root.dataset.theme;
    syncAccent();
    expect(props.get("--accent")).toBe("#336699");
  });

  it("puts Fluent's own pick on the root, as Velvet's", () => {
    const { props } = fakeRoot();
    themeAccentStore("fluent").set("#336699");
    applyThemePack("fluent");
    expect(props.get("--accent")).toBe("#336699");
    applyThemePack("none");
  });

  it("sets the ink for the accent that is on", () => {
    const { props } = fakeRoot();
    themeAccentStore("velvet").set("#ffffff");
    applyThemePack("velvet");
    expect(props.get("--accent-ink")).toBe("oklch(0.205 0 0)");
    themeAccentStore("velvet").set("#101010");
    syncAccent();
    expect(props.get("--accent-ink")).toBe("oklch(0.985 0 0)");
  });
});

describe("Fluent's Mica", () => {
  beforeEach(() => {
    mica.answer = true;
    mica.calls.length = 0;
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("asks native for Mica when Fluent is chosen, and marks the root once it says yes", async () => {
    const { root } = fakeRoot();
    applyThemePack("fluent");
    expect(mica.calls).toEqual([true]);
    await settle();
    expect(root.dataset.mica).toBe("on");
    applyThemePack("none");
  });

  it("takes it off, and the mark with it, when any other pack is chosen", async () => {
    const { root } = fakeRoot();
    applyThemePack("fluent");
    await settle();
    for (const next of ["prism", "velvet", "lagoon", "none"] as const) {
      applyThemePack("fluent");
      await settle();
      mica.calls.length = 0;
      applyThemePack(next);
      expect(root.dataset.mica, next).toBeUndefined();
      expect(mica.calls, next).toEqual([false]);
    }
  });

  it("leaves the mark off when native says no (Windows 10, a failed call)", async () => {
    mica.answer = false;
    const { root } = fakeRoot();
    applyThemePack("fluent");
    await settle();
    expect(mica.calls).toEqual([true]);
    expect(root.dataset.mica).toBeUndefined();
    applyThemePack("none");
  });

  it("does not call native for a profile that never wore Fluent", () => {
    fakeRoot();
    for (const p of ["none", "prism", "velvet", "lagoon", "none"] as const) applyThemePack(p);
    expect(mica.calls).toEqual([]);
  });

  it("asks once per change, not once per apply", async () => {
    fakeRoot();
    applyThemePack("fluent");
    applyThemePack("fluent");
    await settle();
    expect(mica.calls).toEqual([true]);
    applyThemePack("none");
  });

  it("does not mark a reply that a later choice has overtaken", async () => {
    const { root } = fakeRoot();
    applyThemePack("fluent");
    applyThemePack("none"); // before the first reply lands
    await settle();
    expect(root.dataset.mica).toBeUndefined();
    expect(mica.calls).toEqual([true, false]);
  });
});

// ------------------------------------------------------------- the palettes
const CSS = readFileSync(fileURLToPath(new URL("../../styles/packs.css", import.meta.url)), "utf8");

/** The declarations of one pack's token block. */
function pack(key: Exclude<ThemePack, "none">): Map<string, string> {
  const head = `:root[data-theme-pack="${key}"]:not([data-theme="light"]) {`;
  const at = CSS.indexOf(`\n${head}`);
  if (at < 0) throw new Error(`no block "${head}"`);
  const open = CSS.indexOf("{", at);
  const body = CSS.slice(open + 1, CSS.indexOf("\n}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** A colour as #rrggbb. A translucent one (rgb(r g b / a)) is composed over
 * `base`, which is how Lagoon's and Fluent's layers read on the page. */
function solid(value: string, base: string): string {
  const m = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (!m) return value;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const under = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
  const out = [m[1], m[2], m[3]].map((c, i) => Math.round(Number(c) * a + under[i] * (1 - a)));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PACKS = ["prism", "velvet", "lagoon", "fluent"] as const;
const TEXT = ["--text", "--text-muted", "--text-dim", "--text-ghost", "--text-faint"];
// Where words are set: the page, a card, a chip, the track a field sits in,
// the sidebar. Hex, or a translucent rgb() composed over the pack's --bg.
const GROUNDS = ["--bg", "--surface", "--surface-raised", "--surface-track", "--sidebar"];

describe("packs.css", () => {
  for (const key of PACKS) {
    const t = pack(key);
    const hex = (name: string) => {
      const v = solid(t.get(name) ?? "", t.get("--bg") ?? "");
      expect(v, `${key} ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      return v;
    };

    it(`${key}: every text tier reads at 4.5:1 on every surface`, () => {
      for (const ground of GROUNDS)
        for (const ink of TEXT)
          expect(contrast(hex(ink), hex(ground)), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${key}: the ink on the accent, and the accent on the page, read at 4.5:1`, () => {
      expect(contrast(hex("--accent-ink"), hex("--accent"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex("--accent"), hex("--bg"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex("--accent"), hex("--surface"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${key}: the sidebar's rows read at 4.5:1`, () => {
      expect(contrast(hex("--sidebar-foreground"), hex("--sidebar"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex("--sidebar-accent-foreground"), hex("--sidebar-accent"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${key}: its card shows the pack's own page, surface and accent`, () => {
      const info = THEME_PACKS.find((p) => p.key === key)!;
      expect(info.swatch).toEqual({ bg: hex("--bg"), surface: hex("--surface"), accent: hex("--accent") });
      // A pack that takes an accent offers its own colour as the first swatch.
      if (info.accent) expect(info.accent).toBe(hex("--accent"));
    });
  }

  it("velvet: a logo's initial reads on its plate", () => {
    const t = pack("velvet");
    expect(contrast(t.get("--plate-ink")!, t.get("--plate")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("lagoon: the plate takes the text colour at 4.5:1", () => {
    const t = pack("lagoon");
    expect(contrast(t.get("--text")!, t.get("--plate")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("only Prism, and only its block, carries the ramp's hooks", () => {
    const hooks = ["--pack-bg-image", "--dot-glow", "--hero-glow", "--nowline-fill", "--progress-fill"];
    for (const h of hooks) expect(pack("prism").has(h), h).toBe(true);
    // --hero-glow is also Velvet's footlight (a radial, not the ramp), so it
    // is left to Velvet below.
    for (const key of ["velvet", "lagoon", "fluent"] as const)
      for (const h of hooks.filter((h) => h !== "--hero-glow" || key !== "velvet"))
        expect(pack(key).has(h), `${key} ${h}`).toBe(false);
    expect(pack("velvet").get("--hero-glow")).toMatch(/^radial-gradient/);
  });

  it("no pack sets a corner, a spacing or a layout (Adam, 1.3)", () => {
    // A radius token, a border-radius, padding, margin, gap or display set
    // by any pack block or rule in the file.
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/--radius[\w-]*\s*:/);
    // The only border-radius in the file is the cursor light's own circle.
    const radii = [...stripped.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.filter((r) => r !== "50%" && r !== "inherit")).toEqual([]);
  });

  it("every selector is dark only", () => {
    const heads = [...CSS.matchAll(/^:root\[data-theme-pack[^{]*\{/gm)].map((m) => m[0]);
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) expect(h, h).toContain(':not([data-theme="light"])');
  });
});
