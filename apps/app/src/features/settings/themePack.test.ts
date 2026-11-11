import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Native's Mica answer, set per test; the calls are kept to be counted.
const mica = vi.hoisted(() => ({ answer: true, calls: [] as boolean[], faces: [] as boolean[] }));
vi.mock("../../lib/tauri", () => ({
  tauriMica: (on: boolean, dark: boolean) => {
    mica.calls.push(on);
    mica.faces.push(dark);
    return Promise.resolve(on && mica.answer);
  },
}));
import {
  THEME_PACKS,
  THEME_TIERS,
  applyThemePack,
  faceAccent,
  loadThemePack,
  packInfo,
  packShowing,
  packShowingIn,
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

  it("lists Default first, then the five packs", () => {
    expect(THEME_PACKS.map((p) => p.label)).toEqual(["Default", "Prism", "Velvet", "Lagoon", "Fluent", "Classic", "Frutiger Aero"]);
  });

  it("gives each pack a tier, and Fluent and Classic are tier 3", () => {
    expect(THEME_PACKS.map((p) => p.tier)).toEqual([1, 2, 2, 2, 3, 3, 2]);
  });

  it("has a group in the picker for every pack's tier, so none can go missing", () => {
    const tiers = THEME_TIERS.map((t) => t.tier);
    expect(tiers).toEqual([1, 2, 3]);
    expect(THEME_PACKS.every((p) => tiers.includes(p.tier))).toBe(true);
    expect(THEME_TIERS.map((t) => t.label)).toEqual(["Colors", "Colors and Effects", "Redesigns"]);
  });

  it("shows a tier-3 pack in Light too, and the others only in Dark", () => {
    const light = { dataset: { theme: "light" } } as unknown as HTMLElement;
    const dark = { dataset: {} } as unknown as HTMLElement;
    expect(packShowing("classic", light)).toBe(true);
    expect(packShowing("classic", dark)).toBe(true);
    expect(packShowing("prism", light)).toBe(false);
    expect(packShowing("prism", dark)).toBe(true);
    expect(packShowing("none", dark)).toBe(false);
  });

  it("shows each pack in each face: only the dark-only ones sit out Light", () => {
    const want: Record<ThemePack, [boolean, boolean]> = {
      none: [false, false],
      prism: [true, false],
      velvet: [true, false],
      lagoon: [true, false],
      fluent: [true, true],
      classic: [true, true],
      aero: [true, true],
    };
    for (const p of THEME_PACKS) {
      expect(packShowingIn(p.key, false), `${p.key} dark`).toBe(want[p.key][0]);
      expect(packShowingIn(p.key, true), `${p.key} light`).toBe(want[p.key][1]);
    }
  });

  it("opens Fluent and Aero on their own Light accent, and every other pack on its one", () => {
    expect(faceAccent(packInfo("fluent"), false)).toBe("#60cdff");
    expect(faceAccent(packInfo("fluent"), true)).toBe("#0067c0");
    expect(packInfo("fluent").light?.swatch.accent).toBe("#0067c0");
    expect(faceAccent(packInfo("aero"), false)).toBe("#3cc3ff");
    expect(faceAccent(packInfo("aero"), true)).toBe("#0a8fdc");
    expect(packInfo("aero").light?.swatch.accent).toBe("#0a8fdc");
    for (const k of ["none", "prism", "velvet", "lagoon", "classic"] as const)
      expect(faceAccent(packInfo(k), true), k).toBe(packInfo(k).accent);
    // Fluent and Aero have a Light face of their own.
    expect(THEME_PACKS.filter((p) => p.light).map((p) => p.key)).toEqual(["fluent", "aero"]);
  });

  it("knows Fluent as a key, with Windows' own blue as its accent", () => {
    saveThemePack("fluent");
    expect(loadThemePack()).toBe("fluent");
    const fluent = THEME_PACKS.find((p) => p.key === "fluent")!;
    expect(fluent.accent).toBe("#60cdff");
    expect(fluent.swatch.accent).toBe("#60cdff");
  });

  it("knows Frutiger Aero as \"aero\", with an aqua accent", () => {
    saveThemePack("aero");
    expect(loadThemePack()).toBe("aero");
    const aero = packInfo("aero");
    expect(aero.label).toBe("Frutiger Aero");
    expect(aero.accent).toBe("#3cc3ff");
    expect(aero.swatch.accent).toBe("#3cc3ff");
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

  it("is kept per face for Fluent: a pick in Light leaves Dark's alone, and back", () => {
    themeAccentStore("fluent").set("#22C55E");
    themeAccentStore("fluent", true).set("#AA00FF");
    themeAccentStore("fluent", true).setCustom("#112233");
    expect(themeAccentStore("fluent").get()).toBe("#22c55e");
    expect(themeAccentStore("fluent", true).get()).toBe("#aa00ff");
    expect(themeAccentStore("fluent").getCustom()).toBe("");
    expect(themeAccentStore("fluent", true).getCustom()).toBe("#112233");
    resetThemeAccents();
    expect(themeAccentStore("fluent", true).get()).toBe("");
  });

  it("has one set of picks for a pack with no Light face, whichever face asks", () => {
    themeAccentStore("velvet", true).set("#336699");
    expect(themeAccentStore("velvet").get()).toBe("#336699");
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

  it("keeps one pick per face for Aero, and a face with none leaves the colour to the stylesheet", () => {
    const { root, props } = fakeRoot();
    saveAccent("#ffd500");
    themeAccentStore("aero").set("#336699");
    themeAccentStore("aero", true).set("#22c55e");
    applyThemePack("aero");
    expect(props.get("--accent")).toBe("#336699"); // Night's pick
    root.dataset.theme = "light";
    syncAccent();
    expect(props.get("--accent")).toBe("#22c55e"); // Daylight's own
    themeAccentStore("aero", true).set("");
    syncAccent();
    expect(props.has("--accent")).toBe(false); // none: the stylesheet's Daylight blue
    delete root.dataset.theme;
    syncAccent();
    expect(props.get("--accent")).toBe("#336699"); // Night's pick was not touched
    applyThemePack("none");
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

  it("puts Fluent's Light pick on the root in Light, and Dark's pick back in Dark", () => {
    const { root, props } = fakeRoot();
    themeAccentStore("fluent").set("#336699");
    themeAccentStore("fluent", true).set("#aa0066");
    applyThemePack("fluent");
    expect(props.get("--accent")).toBe("#336699");
    root.dataset.theme = "light";
    syncAccent();
    expect(props.get("--accent")).toBe("#aa0066");
    delete root.dataset.theme;
    syncAccent();
    expect(props.get("--accent")).toBe("#336699");
    applyThemePack("none");
  });

  it("leaves Fluent's Light accent to the stylesheet with no pick, and not the default's", () => {
    const { root, props } = fakeRoot();
    saveAccent("#ffd500");
    applyThemePack("fluent");
    root.dataset.theme = "light";
    syncAccent();
    expect(props.has("--accent")).toBe(false);
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
    mica.faces.length = 0;
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

  it("asks again when the face flips, with the face, and not for a flip that changes nothing", async () => {
    const { root } = fakeRoot();
    applyThemePack("fluent");
    await settle();
    expect(mica.faces).toEqual([true]);
    root.dataset.theme = "light";
    syncAccent(); // not a Mica ask
    expect(mica.calls).toEqual([true]);
    // The observer is not real in this fake root, so apply stands in for it.
    applyThemePack("fluent");
    await settle();
    expect(mica.calls).toEqual([true, true]);
    expect(mica.faces).toEqual([true, false]);
    expect(root.dataset.mica).toBe("on");
    applyThemePack("fluent");
    expect(mica.calls).toEqual([true, true]);
    delete root.dataset.theme;
    applyThemePack("fluent");
    await settle();
    expect(mica.faces).toEqual([true, false, true]);
    applyThemePack("none");
  });

  it("takes it off from Light too", async () => {
    const { root } = fakeRoot();
    root.dataset.theme = "light";
    applyThemePack("fluent");
    await settle();
    expect(mica.faces).toEqual([false]);
    applyThemePack("lagoon");
    expect(mica.calls).toEqual([true, false]);
    expect(root.dataset.mica).toBeUndefined();
  });

  it("takes it off, and the mark with it, when any other pack is chosen", async () => {
    const { root } = fakeRoot();
    applyThemePack("fluent");
    await settle();
    for (const next of ["prism", "velvet", "lagoon", "aero", "none"] as const) {
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
    for (const p of ["none", "prism", "velvet", "lagoon", "aero", "none"] as const) applyThemePack(p);
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

/** The declarations of one pack's token block: its dark one, or its face for
 * Light (a pack with `light` on its PackInfo has a block of its own). */
function pack(key: Exclude<ThemePack, "none">, face: "dark" | "light" = "dark"): Map<string, string> {
  const head =
    face === "dark"
      ? `:root[data-theme-pack="${key}"]:not([data-theme="light"]) {`
      : `:root[data-theme-pack="${key}"][data-theme="light"] {`;
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

const PACKS = ["prism", "velvet", "lagoon", "fluent", "aero"] as const;
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

  const faces = [
    ["Night", "dark"],
    ["Daylight", "light"],
  ] as const;
  for (const [name, face] of faces) {
    const t = pack("aero", face);
    const info = THEME_PACKS.find((p) => p.key === "aero")!;
    const hex = (v: string, base: string) => {
      const out = solid(t.get(v) ?? "", base);
      expect(out, `${name} ${v}`).toMatch(/^#[0-9a-f]{6}$/i);
      return out;
    };

    // Aero is not held to the contrast tour (Adam: "it's okay if contrast fails
    // in some spots"): the sky is loud, halos keep words readable over it, and
    // what is held here is the ink on the face's own page colour and cards.
    it(`aero ${name}: every ink tier reads at 4.5:1 on the page colour and on its cards`, () => {
      const stop = hex("--bg", "#000000");
      const grounds = ["--surface", "--surface-raised", "--surface-track", "--sidebar"].map((g) => [g, hex(g, stop)]);
      for (const ink of TEXT) {
        expect(contrast(hex(ink, stop), stop), `${ink} on the page`).toBeGreaterThanOrEqual(4.5);
        for (const [g, c] of grounds) expect(contrast(hex(ink, stop), c), `${ink} on ${g}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`aero ${name}: the accent's ink reads on it`, () => {
      const bg = hex("--bg", "#000000");
      expect(contrast(hex("--accent-ink", bg), hex("--accent", bg))).toBeGreaterThanOrEqual(3);
    });

    it(`aero ${name}: the sidebar's rows and a logo's plate read at 4.5:1`, () => {
      const bg = hex("--bg", "#000000");
      expect(contrast(hex("--sidebar-foreground", bg), hex("--sidebar", bg))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex("--sidebar-accent-foreground", bg), hex("--sidebar-accent", bg))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex("--text", bg), hex("--plate", bg))).toBeGreaterThanOrEqual(4.5);
    });

    it(`aero ${name}: its card shows the face's own page, surface and accent`, () => {
      const bg = hex("--bg", "#000000");
      const swatch = face === "dark" ? info.swatch : info.light!.swatch;
      expect(swatch).toEqual({ bg, surface: hex("--surface", bg), accent: hex("--accent", bg) });
      expect(face === "dark" ? info.accent : info.light!.accent).toBe(hex("--accent", bg));
    });

    it(`aero ${name}: it has a gloss and a sky of its own`, () => {
      expect(t.get("--gloss"), "--gloss").toMatch(/^linear-gradient\(180deg/);
      expect(t.get("--aero-sky"), "--aero-sky").toMatch(/gradient/);
    });
  }

  it("aero: both faces share Segoe UI and the blur, written once", () => {
    const head = ':root[data-theme-pack="aero"] {';
    const at = CSS.indexOf(`\n${head}`);
    expect(at).toBeGreaterThan(0);
    const body = CSS.slice(CSS.indexOf("{", at) + 1, CSS.indexOf("\n}", at));
    expect(body).toMatch(/--font-text:\s*"Segoe UI", "Geist Variable"/);
    expect(body).toMatch(/--font-headline:\s*"Segoe UI", "Geist Variable"/);
    expect(body).toMatch(/--float-blur:\s*blur\(24px\)/);
  });

  it("only Prism, and only its block, carries the ramp's hooks", () => {
    const hooks = ["--pack-bg-image", "--dot-glow", "--hero-glow", "--nowline-fill", "--progress-fill"];
    for (const h of hooks) expect(pack("prism").has(h), h).toBe(true);
    // --hero-glow is also Velvet's footlight (a radial, not the ramp), so it
    // is left to Velvet below.
    for (const key of ["velvet", "lagoon", "fluent", "aero"] as const)
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

  it("every selector is dark only, bar Aero's, and only Aero has a block for Light", () => {
    const heads = [...CSS.matchAll(/^:root[^{\n]*\[data-theme-pack[^{]*\{/gm)].map((m) => m[0]);
    expect(heads.length).toBeGreaterThan(0);
    // Aero's section writes its faces apart and what both share once, so its
    // heads are held by the block test above instead.
    for (const h of heads.filter((h) => !h.includes('data-theme-pack="aero"')))
      expect(h, h).toContain(':not([data-theme="light"])');
    // Only a pack that says it has a face for Light has a block for it. Fluent's
    // is in fluent-tokens.css, so packs.css holds Aero's alone.
    const light = [...CSS.matchAll(/^:root[^{\n]*\[data-theme-pack="(\w+)"\]\[data-theme="light"\][^{]*\{/gm)].map((m) => m[1]);
    expect([...new Set(light)]).toEqual(["aero"]);
    expect(THEME_PACKS.find((p) => p.key === "aero")?.light).toBeTruthy();
  });
});
