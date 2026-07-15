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

// Intense theme CSS is bundled, not injected — the only DOM this module
// touches now is documentElement.dataset (applyThemePack sets/clears the
// data-theme-pack attribute for the demotion path).
const fakeDocumentElement = { dataset: {} as Record<string, string> };
vi.stubGlobal("document", { documentElement: fakeDocumentElement });

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
  ownsPack,
} from "./license";
import {
  DEFAULT_PACK,
  INTENSE_PACKS,
  applyThemePack,
  loadThemePack,
  saveThemePack,
  type ThemePackMeta,
} from "./themePacks";

const GOOD_KEY = "BTV-AAAA-BBBB-CCCC-DDDD";

// The keybox entitlement lists real bundled ids. terminal is our reference
// intense pack; installedPacks() maps owned ids back to our LOCAL metas.
const TERMINAL_META = INTENSE_PACKS.find((p) => p.id === "terminal")!;
const SUPPORTER_META = INTENSE_PACKS.find((p) => p.id === "supporter")!;
const ENTITLED: ThemePackMeta[] = [
  {
    id: "terminal",
    name: "Terminal",
    blurb: "keybox meta",
    supportsLight: false,
    preview: { bg: "#000", surface: "#111", accent: "#c22727" },
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

/** Lets a fire-and-forget background revalidate (applyInstalledPacks)
 * settle before assertions run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Activates a fresh license (entitles "terminal") against a mocked keybox,
 * the way a real activate() would populate storage. */
async function activateTerminal(pass = false): Promise<void> {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).endsWith("/validate")) {
      return Promise.resolve(
        jsonResponse(200, { ok: true, pass, themes: pass ? [] : ENTITLED }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const result = await activate(GOOD_KEY);
  expect(result.ok).toBe(true);
  fetchMock.mockReset();
}

beforeEach(() => {
  store.clear();
  delete fakeDocumentElement.dataset.themePack;
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

  it("happy path: normalizes, stores entitlement, and fetches NO payload", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/validate")) {
        return Promise.resolve(
          jsonResponse(200, { ok: true, pass: false, themes: ENTITLED }),
        );
      }
      throw new Error(`unexpected fetch (no payload should be fetched): ${url}`);
    });

    const result = await activate("  btv-aaaa-bbbb-cccc-dddd  ");

    expect(result).toEqual({ ok: true, themes: ["terminal"] });
    // Bundled CSS — installedPacks returns our LOCAL meta for the owned id.
    expect(installedPacks()).toEqual([TERMINAL_META]);
    expect(licenseStatus()).toEqual({
      active: true,
      pass: false,
      installedCount: 1,
    });
    // Only /validate is ever called — no /payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/validate");

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

describe("ownsPack", () => {
  it("free packs are always owned, even with no license", () => {
    expect(ownsPack("void")).toBe(true);
    expect(ownsPack("classic")).toBe(true);
    // Nebula went free in v0.6.0.
    expect(ownsPack("nebula")).toBe(true);
  });

  it("an intense pack is unowned without an entitlement", () => {
    expect(ownsPack("terminal")).toBe(false);
  });

  it("owns exactly the entitled intense ids after activation", async () => {
    await activateTerminal();
    expect(ownsPack("terminal")).toBe(true);
    expect(ownsPack("supporter")).toBe(false);
  });

  it("a pass owns every intense pack", async () => {
    await activateTerminal(true);
    expect(ownsPack("terminal")).toBe(true);
    expect(ownsPack("supporter")).toBe(true);
  });
});

describe("installedPacks", () => {
  it("returns owned bundled metas, and every intense pack for a pass", async () => {
    await activateTerminal();
    expect(installedPacks()).toEqual([TERMINAL_META]);
  });

  it("a pass installs every bundled intense pack (incl. the secret one)", async () => {
    await activateTerminal(true);
    expect(installedPacks()).toEqual([TERMINAL_META, SUPPORTER_META]);
  });
});

describe("applyInstalledPacks (fail-open startup path)", () => {
  it("a bundled owned pack still renders on reload with the keybox dead", async () => {
    await activateTerminal();
    saveThemePack("terminal");
    applyThemePack("terminal");
    fetchMock.mockImplementation(() => {
      throw new Error("no network");
    });

    applyInstalledPacks();
    await flush();

    // Owned via cached entitlement — never demoted, no fetch needed.
    expect(loadThemePack()).toBe("terminal");
    expect(fakeDocumentElement.dataset.themePack).toBe("terminal");
  });

  it("demotes a persisted-but-unowned intense pack to the default", () => {
    // No entitlement on file, but the pack was forced (e.g. via devtools).
    saveThemePack("terminal");
    applyThemePack("terminal");

    applyInstalledPacks();

    expect(loadThemePack()).toBe(DEFAULT_PACK);
    // The default (BlammyTV/slate) is a real attribute pack now, not the
    // attribute-less classic.
    expect(fakeDocumentElement.dataset.themePack).toBe(DEFAULT_PACK);
  });

  it("skips the background revalidate entirely while offline", async () => {
    await activateTerminal();
    saveThemePack("terminal");
    vi.stubGlobal("navigator", { onLine: false });

    applyInstalledPacks();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
  });

  it("background revalidate leaves state alone on activation_limit", async () => {
    await activateTerminal();
    saveThemePack("terminal");
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, reason: "activation_limit" }),
    );

    applyInstalledPacks();
    await flush();

    expect(ownsPack("terminal")).toBe(true);
    expect(loadThemePack()).toBe("terminal");
  });

  it("background revalidate clears entitlement and demotes on unknown_key", async () => {
    await activateTerminal();
    saveThemePack("terminal");
    applyThemePack("terminal");
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, reason: "unknown_key" }),
    );

    applyInstalledPacks();
    await flush();

    expect(installedPacks()).toEqual([]);
    expect(ownsPack("terminal")).toBe(false);
    expect(loadThemePack()).toBe(DEFAULT_PACK);
  });
});

describe("deactivate", () => {
  it("clears storage and resets the active pack if it was a bundled intense one", async () => {
    await activateTerminal();
    saveThemePack("terminal");
    applyThemePack("terminal");
    expect(fakeDocumentElement.dataset.themePack).toBe("terminal");

    deactivate();

    expect(installedPacks()).toEqual([]);
    expect(licenseStatus().active).toBe(false);
    expect(loadThemePack()).toBe(DEFAULT_PACK);
    expect(fakeDocumentElement.dataset.themePack).toBe(DEFAULT_PACK);
  });

  it("leaves the active pack alone if a free pack was on screen", async () => {
    await activateTerminal();
    saveThemePack("void");
    applyThemePack("void");

    deactivate();

    expect(loadThemePack()).toBe("void");
    expect(fakeDocumentElement.dataset.themePack).toBe("void");
  });
});
