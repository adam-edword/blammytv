import { load, remove, save } from "../../lib/storage";
import {
  DEFAULT_PACK,
  applyThemePack,
  injectPackCss,
  loadThemePack,
  saveThemePack,
  type ThemePackId,
  type ThemePackMeta,
} from "./themePacks";

/**
 * Paid theme unlock. Talks to the "keybox" (a small license server built in
 * parallel with this module — see the contract below) to turn a purchased
 * key into installed theme-pack CSS. Two constraints shape everything here:
 *
 * - FAIL-OPEN: once a theme is unlocked, it must keep rendering with the
 *   network dead, the keybox down, or a rate limit in the way.
 *   applyInstalledPacks() (called from main.tsx before first paint) is
 *   entirely local — it never awaits a fetch before painting, and its
 *   optional background revalidate can only ever refresh or leave state
 *   alone, never brick a theme someone already owns (see revalidate()).
 * - ANONYMOUS: machineId() is a random UUID, not a hardware fingerprint —
 *   it exists only so the keybox can count activations per key.
 *
 * Server contract (a separate service, not this app's own backend):
 *   POST {keyboxUrl()}/validate  {key, machine}
 *     -> 200 {ok:true, pass, themes: ThemePackMeta[]}  (themes = every
 *        pack the key entitles, not just the one being activated)
 *     -> 200 {ok:false, reason: "unknown_key" | "activation_limit"}
 *     -> 429 on rate limit
 *   GET {keyboxUrl()}/payload/{themeId}
 *     headers {x-license-key, x-machine}
 *     -> 200 text/css (a `:root[data-theme-pack="<id>"]{...}` block)
 *     -> 403
 */

/** Placeholder host — FLAGGED TO OWNER: swap for the real keybox once it
 * ships. */
export const DEFAULT_KEYBOX = "https://themes.blammy.example";

const KEYBOX_OVERRIDE_KEY = "blammytv.keyboxUrl";

/** Dev/test seam: a RAW localStorage string, not one of storage.ts's
 * {v,data} envelopes — pointing the app at a local fake keybox is one
 * `localStorage.setItem("blammytv.keyboxUrl", …)` call, not a migration. */
export function keyboxUrl(): string {
  try {
    return localStorage.getItem(KEYBOX_OVERRIDE_KEY) || DEFAULT_KEYBOX;
  } catch {
    return DEFAULT_KEYBOX;
  }
}

const MACHINE_KEY = "license.machine";
const KEY_KEY = "license.key";
const ENTITLEMENT_KEY = "license.entitlement";
const PAYLOADS_KEY = "license.payloads";
const VERSION = 1;

/** Anonymous per-install id, created once and persisted forever — NEVER
 * derived from hardware. Only used so the keybox can enforce a per-key
 * activation limit. */
export function machineId(): string {
  const existing = load<string>(MACHINE_KEY, VERSION, "");
  if (existing) return existing;
  const id = crypto.randomUUID();
  save(MACHINE_KEY, VERSION, id);
  return id;
}

/** BTV-XXXX-XXXX-XXXX-XXXX. Case/whitespace on input is expected (users
 * paste from email) — normalize before ever checking or sending a key. */
const KEY_SHAPE = /^BTV-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

export function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidKeyShape(key: string): boolean {
  return KEY_SHAPE.test(key);
}

export interface Entitlement {
  pass: boolean;
  themes: ThemePackMeta[];
  /** epoch-ms this entitlement was last confirmed by the keybox. */
  at: number;
}

interface ValidateOk {
  ok: true;
  pass: boolean;
  themes: ThemePackMeta[];
}
interface ValidateFail {
  ok: false;
  reason: "unknown_key" | "activation_limit";
}
type ValidateResponse = ValidateOk | ValidateFail;

const NETWORK_MESSAGE =
  "Couldn't reach the theme server — check your connection and try again";

/** POST /validate. Returns null on any transport/shape failure (network
 * down, a non-2xx status incl. 429, an unparseable body) — every caller
 * folds that case into the same network message, so there's nothing finer
 * to report here. */
async function callValidate(key: string): Promise<ValidateResponse | null> {
  let res: Response;
  try {
    res = await fetch(`${keyboxUrl()}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, machine: machineId() }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null; // covers 429 and any server-side 4xx/5xx
  try {
    return (await res.json()) as ValidateResponse;
  } catch {
    return null;
  }
}

async function fetchPayload(
  themeId: ThemePackId,
  key: string,
): Promise<string> {
  const res = await fetch(
    `${keyboxUrl()}/payload/${encodeURIComponent(themeId)}`,
    { headers: { "x-license-key": key, "x-machine": machineId() } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fetch every entitled theme's CSS, store the ones that land, and inject
 * them live. Partial failure is expected (one payload host hiccup
 * shouldn't cost the whole activation) — Promise.allSettled, not
 * Promise.all; whatever already landed in a previous call stays cached. */
async function fetchAndStorePayloads(
  themes: ThemePackMeta[],
  key: string,
): Promise<void> {
  const results = await Promise.allSettled(
    themes.map(async (t) => ({ id: t.id, css: await fetchPayload(t.id, key) })),
  );
  const payloads = load<Record<string, string>>(PAYLOADS_KEY, VERSION, {});
  for (const r of results) {
    if (r.status === "fulfilled") {
      payloads[r.value.id] = r.value.css;
      injectPackCss(r.value.id, r.value.css);
    }
  }
  save(PAYLOADS_KEY, VERSION, payloads);
}

export type ActivateResult =
  | { ok: true; themes: string[] }
  | { ok: false; message: string };

/** Normalize/validate the shape, hit /validate, and on success fetch and
 * inject every entitled theme's CSS before resolving — the picker never
 * renders a "licensed but blank" card. */
export async function activate(rawKey: string): Promise<ActivateResult> {
  const key = normalizeKey(rawKey);
  if (!isValidKeyShape(key)) {
    return { ok: false, message: "That doesn't look like a BlammyTV key" };
  }

  const body = await callValidate(key);
  if (body === null) return { ok: false, message: NETWORK_MESSAGE };
  if (!body.ok) {
    return {
      ok: false,
      message:
        body.reason === "activation_limit"
          ? "This key is already active on 3 machines"
          : "That key wasn't recognized — check for typos",
    };
  }

  save(KEY_KEY, VERSION, key);
  const entitlement: Entitlement = {
    pass: body.pass,
    themes: body.themes,
    at: Date.now(),
  };
  save(ENTITLEMENT_KEY, VERSION, entitlement);
  await fetchAndStorePayloads(body.themes, key);

  return { ok: true, themes: body.themes.map((t) => t.id) };
}

/** Entitled themes this build can actually render — the entitlement lists
 * everything a key unlocks, but only ids with a cached payload have CSS to
 * show (a payload fetch can fail even after a successful activate()). */
export function installedPacks(): ThemePackMeta[] {
  const entitlement = load<Entitlement | null>(ENTITLEMENT_KEY, VERSION, null);
  if (!entitlement) return [];
  const payloads = load<Record<string, string>>(PAYLOADS_KEY, VERSION, {});
  return entitlement.themes.filter((t) => t.id in payloads);
}

export interface LicenseStatus {
  /** A key + entitlement are on file, whether or not it's currently a
   * Themes Pass — used to switch the settings row between "paste a key"
   * and "licensed" states. */
  active: boolean;
  pass: boolean;
  installedCount: number;
}

/** Settings-row summary — the one read CustomizeTab needs that isn't just
 * "the list of installed packs". */
export function licenseStatus(): LicenseStatus {
  const key = load<string>(KEY_KEY, VERSION, "");
  const entitlement = load<Entitlement | null>(ENTITLEMENT_KEY, VERSION, null);
  return {
    active: key !== "" && entitlement !== null,
    pass: entitlement?.pass ?? false,
    installedCount: installedPacks().length,
  };
}

/**
 * FAIL-OPEN STARTUP PATH — call before first paint, alongside the other
 * applyX() calls in main.tsx. Re-injects every cached payload straight
 * from localStorage; NO network is involved, so a dead connection (or a
 * dead keybox) can never brick a theme someone already paid for.
 *
 * Then, only if the browser reports it's online, kicks an unawaited
 * background revalidate to pick up entitlement changes (a renewed key, a
 * newly-added pack). It can only ever refresh local state or leave it
 * alone — see revalidate()'s own comment for the one exception.
 */
export function applyInstalledPacks(): void {
  const payloads = load<Record<string, string>>(PAYLOADS_KEY, VERSION, {});
  for (const [id, css] of Object.entries(payloads)) injectPackCss(id, css);

  if (typeof navigator !== "undefined" && navigator.onLine) {
    void revalidate();
  }
}

/** Background revalidate: silent on every failure. The ONE case allowed to
 * clear local state is an explicit {ok:false, reason:"unknown_key"} — the
 * keybox affirmatively saying this key doesn't exist. Rate limits, network
 * blips, and activation_limit all leave cached themes exactly as they
 * were; a temporary hiccup must never cost someone a theme they own. */
async function revalidate(): Promise<void> {
  const key = load<string>(KEY_KEY, VERSION, "");
  if (!key) return;
  try {
    const body = await callValidate(key);
    if (body === null) return;
    if (!body.ok) {
      if (body.reason === "unknown_key") clearLicenseState();
      return;
    }
    const entitlement: Entitlement = {
      pass: body.pass,
      themes: body.themes,
      at: Date.now(),
    };
    save(ENTITLEMENT_KEY, VERSION, entitlement);
    await fetchAndStorePayloads(body.themes, key);
  } catch {
    /* stays silent — the cached theme already on screen is unaffected */
  }
}

function clearLicenseState(): void {
  const payloads = load<Record<string, string>>(PAYLOADS_KEY, VERSION, {});
  for (const id of Object.keys(payloads)) {
    document.head.querySelector(`style[data-pack-css="${id}"]`)?.remove();
  }
  remove(KEY_KEY);
  remove(ENTITLEMENT_KEY);
  remove(PAYLOADS_KEY);
}

/** Reversible by re-pasting the key, so no confirmation step. Falls back
 * to the default pack if the one on screen was one of the ones this key
 * licensed. */
export function deactivate(): void {
  const entitlement = load<Entitlement | null>(ENTITLEMENT_KEY, VERSION, null);
  const wasActive =
    entitlement?.themes.some((t) => t.id === loadThemePack()) ?? false;

  clearLicenseState();

  if (wasActive) {
    applyThemePack(DEFAULT_PACK);
    saveThemePack(DEFAULT_PACK);
  }
}
