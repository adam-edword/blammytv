import { beforeEach, describe, expect, it, vi } from "vitest";

// Same node-env seam as themePacks.test.ts/playbackPrefs.test.ts: vitest
// runs without a DOM here, so localStorage and the bits of `document`/
// `navigator` this module touches are stubbed by hand rather than pulled
// from jsdom (not a repo dependency). `fetch` is stubbed the same way —
// there's no real keybox to talk to in a test run.
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

vi.stubGlobal("navigator", { onLine: true });

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  activate,
  applyInstalledPacks,
  deactivate,
  installedPacks,
  isValidKeyShape,
  licenseStatus,
  machineId,
  normalizeKey,
} from "./license";
import {
  DEFAULT_PACK,
  applyThemePack,
  loadThemePack,
  saveThemePack,
  type ThemePackMeta,
} from "./themePacks";

const GOOD_KEY = "BTV-AAAA-BBBB-CCCC-DDDD";
const NEON_CSS = ':root[data-theme-pack="neon"]{--surface:#111}';
const THEMES: ThemePackMeta[] = [
  {
    id: "neon",
    name: "Neon",
    blurb: "A paid pack.",
    supportsLight: false,
    preview: { bg: "#000000", surface: "#111111", accent: "#c22727" },
  },
];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => {
      throw new Error("not json");
    },
  } as unknown as Response;
}

/** Lets a fire-and-forget background revalidate (applyInstalledPacks)
 * settle before assertions run — it goes through a handful of microtask
 * hops (fetch -> json -> the payload fetches), so a macrotask flush is
 * the reliable way to wait it out. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Activates a fresh license against a mocked keybox, the way a real
 * activate() call would populate storage — used as setup for tests that
 * exercise deactivate()/revalidate() against already-licensed state. */
async function activateNeon(): Promise<void> {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/validate")) {
      return Promise.resolve(jsonResponse(200, { ok: true, pass: false, themes: THEMES }));
    }
    return Promise.resolve(textResponse(200, NEON_CSS));
  });
  const result = await activate(GOOD_KEY);
  expect(result.ok).toBe(true);
  fetchMock.mockReset();
}

beforeEach(() => {
  store.clear();
  delete fakeDocumentElement.dataset.themePack;
  fakeHeadChildren.length = 0;
  fetchMock.mockReset();
});

describe("normalizeKey / isValidKeyShape", () => {
  it("trims and uppercases", () => {
    expect(normalizeKey("  btv-aaaa-bbbb-cccc-dddd  ")).toBe(GOOD_KEY);
  });

  it("accepts the canonical shape", () => {
    expect(isValidKeyShape("BTV-AAAA-1234-BBBB-5678")).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isValidKeyShape("NOT-A-KEY")).toBe(false);
    expect(isValidKeyShape("BTV-AAAA-BBBB-CCCC")).toBe(false);
    expect(isValidKeyShape("BTV-AAAA-BBBB-CCCC-DDDDD")).toBe(false);
    // Shape-check runs post-normalize; lowercase alone must fail here.
    expect(isValidKeyShape("btv-aaaa-bbbb-cccc-dddd")).toBe(false);
  });
});

describe("machineId", () => {
  it("creates a uuid on first call and persists it after", () => {
    const id = machineId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(machineId()).toBe(id);
  });
});

describe("activate", () => {
  it("rejects a bad shape before ever touching the network", async () => {
    const result = await activate("not-a-key");
    expect(result).toEqual({
      ok: false,
      message: "That doesn't look like a BlammyTV key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path: normalizes, stores key/entitlement/payloads, and injects css", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/validate")) {
        return Promise.resolve(
          jsonResponse(200, { ok: true, pass: false, themes: THEMES }),
        );
      }
      expect(String(url)).toContain("/payload/neon");
      return Promise.resolve(textResponse(200, NEON_CSS));
    });

    const result = await activate("  btv-aaaa-bbbb-cccc-dddd  ");

    expect(result).toEqual({ ok: true, themes: ["neon"] });
    expect(installedPacks()).toEqual(THEMES);
    expect(licenseStatus()).toEqual({
      active: true,
      pass: false,
      installedCount: 1,
    });
    const styleEl = fakeHead.querySelector('style[data-pack-css="neon"]');
    expect(styleEl?.textContent).toBe(NEON_CSS);

    // The validate call carried the normalized key and a machine id.
    const [, validateInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(validateInit.body as string);
    expect(sentBody.key).toBe(GOOD_KEY);
    expect(sentBody.machine).toBe(machineId());
  });

  it("maps unknown_key to a plain message and stores nothing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, reason: "unknown_key" }),
    );

    const result = await activate(GOOD_KEY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/recognized/i);
    expect(installedPacks()).toEqual([]);
    expect(licenseStatus().active).toBe(false);
  });

  it("maps activation_limit to the 3-machines message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, reason: "activation_limit" }),
    );

    const result = await activate(GOOD_KEY);

    expect(result).toEqual({
      ok: false,
      message: "This key is already active on 3 machines",
    });
  });

  it("maps a transport failure to the network message and stores nothing", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await activate(GOOD_KEY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/couldn't reach/i);
    expect(installedPacks()).toEqual([]);
  });

  it("maps a 429 to the same network message", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response);

    const result = await activate(GOOD_KEY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/couldn't reach/i);
  });
});

describe("applyInstalledPacks (fail-open startup path)", () => {
  it("re-injects cached payloads synchronously with fetch entirely unavailable", async () => {
    await activateNeon();
    // Simulate a fresh page load: the head is empty again, exactly as it
    // is before main.tsx runs, but the cached payload from a PRIOR session
    // is already in localStorage.
    fakeHeadChildren.length = 0;
    fetchMock.mockImplementation(() => {
      throw new Error("no network");
    });

    applyInstalledPacks();

    // Synchronous — the cached CSS is back on the page before this line
    // runs, with no fetch having resolved.
    const styleEl = fakeHead.querySelector('style[data-pack-css="neon"]');
    expect(styleEl?.textContent).toBe(NEON_CSS);

    // The doomed background revalidate settles silently; nothing throws
    // out of applyInstalledPacks and the cached state survives.
    await flush();
    expect(installedPacks()).toEqual(THEMES);
  });

  it("skips the background revalidate entirely while offline", async () => {
    await activateNeon();
    vi.stubGlobal("navigator", { onLine: false });

    applyInstalledPacks();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
  });

  it("background revalidate leaves state alone on activation_limit", async () => {
    await activateNeon();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, reason: "activation_limit" }),
    );

    applyInstalledPacks();
    await flush();

    expect(installedPacks()).toEqual(THEMES);
    expect(fakeHead.querySelector('style[data-pack-css="neon"]')).not.toBeNull();
  });

  it("background revalidate clears state only on an explicit unknown_key", async () => {
    await activateNeon();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, reason: "unknown_key" }),
    );

    applyInstalledPacks();
    await flush();

    expect(installedPacks()).toEqual([]);
    expect(fakeHead.querySelector('style[data-pack-css="neon"]')).toBeNull();
  });
});

describe("deactivate", () => {
  it("clears storage and style elements, and resets the active pack if it was licensed", async () => {
    await activateNeon();
    saveThemePack("neon");
    applyThemePack("neon");
    expect(fakeDocumentElement.dataset.themePack).toBe("neon");

    deactivate();

    expect(installedPacks()).toEqual([]);
    expect(licenseStatus().active).toBe(false);
    expect(fakeHead.querySelector('style[data-pack-css="neon"]')).toBeNull();
    expect(loadThemePack()).toBe(DEFAULT_PACK);
    expect(fakeDocumentElement.dataset.themePack).toBeUndefined();
  });

  it("leaves the active pack alone if a different pack was on screen", async () => {
    await activateNeon();
    saveThemePack("void");
    applyThemePack("void");

    deactivate();

    expect(loadThemePack()).toBe("void");
    expect(fakeDocumentElement.dataset.themePack).toBe("void");
  });
});
