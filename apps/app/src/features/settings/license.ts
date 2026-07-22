import { load, remove, save } from "../../lib/storage";
import {
  BUNDLED_INTENSE_IDS,
  DEFAULT_PACK,
  INTENSE_PACKS,
  THEME_PACKS,
  applyThemePack,
  loadThemePack,
  saveThemePack,
  type ThemePackId,
  type ThemePackMeta,
} from "./themePacks";

/**
 * Paid theme unlock. Talks to the "keybox" (a small license server) to turn a
 * purchased key into an entitlement. Two constraints shape everything here:
 *
 * - FAIL-OPEN: intense theme CSS is BUNDLED in the app (styles/
 *   intense-packs.css), not fetched — so a dead network / dead keybox can
 *   never blank a theme. The license only decides whether a paid pack may
 *   PERSIST; the CSS is always present. applyInstalledPacks() (main.tsx,
 *   before first paint) is entirely local and can only ever demote a pack
 *   the machine doesn't own — never brick one it does.
 * - ANONYMOUS: machineId() is a random UUID, not a hardware fingerprint —
 *   it exists only so the keybox can count activations per key.
 *
 * Server contract (a separate service, not this app's own backend):
 *   POST {keyboxUrl()}/validate  {key, machine}
 *     -> 200 {ok:true, pass, themes: ThemePackMeta[]}  (themes = every
 *        pack the key entitles; pass = a Themes Pass, which owns them all)
 *     -> 200 {ok:false, reason: "unknown_key" | "activation_limit"}
 *     -> 429 on rate limit
 * The keybox's GET /payload/:id (CSS delivery) is no longer consumed — themes
 * ship bundled — but stays server-side for older clients.
 */

/** The production keybox (Adam's domain, 2026-07-12). */
export const DEFAULT_KEYBOX = "https://themes.eddtv.org";

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
/** Legacy: builds before the bundled-themes shift cached fetched payload CSS
 * here. Nothing writes it now; clearLicenseState purges any stale copy. */
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

export type ActivateResult =
  | { ok: true; themes: string[] }
  | { ok: false; message: string };

/** Normalize/validate the shape, hit /validate, and on success record the
 * entitlement. No CSS is fetched — the themes are bundled; the entitlement
 * only unlocks the right to persist them (see ownsPack). */
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

  return { ok: true, themes: body.themes.map((t) => t.id) };
}

/** Does this machine own (may persist) the given pack? Free THEME_PACKS are
 * always owned; a bundled intense pack is owned iff the current entitlement
 * is a pass or explicitly lists it. No network — reads the cached
 * entitlement, so it holds offline (fail-open). */
export function ownsPack(id: ThemePackId): boolean {
  if (THEME_PACKS.some((p) => p.id === id)) return true;
  const entitlement = load<Entitlement | null>(ENTITLEMENT_KEY, VERSION, null);
  if (!entitlement) return false;
  return entitlement.pass || entitlement.themes.some((t) => t.id === id);
}

/** Owned intense packs this build can render — pass owns every bundled one;
 * otherwise the entitled ids intersected with what's bundled (entitlement can
 * list ids a stale build predates). Returns our own local metas (price etc.),
 * not the keybox's. */
export function installedPacks(): ThemePackMeta[] {
  const entitlement = load<Entitlement | null>(ENTITLEMENT_KEY, VERSION, null);
  if (!entitlement) return [];
  if (entitlement.pass) return [...INTENSE_PACKS];
  const owned = new Set(entitlement.themes.map((t) => t.id));
  return INTENSE_PACKS.filter((p) => owned.has(p.id));
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
 * applyX() calls in main.tsx. Intense CSS is bundled, so there is nothing to
 * inject; this only guards persistence: if the saved pack is an intense one
 * the machine no longer owns (de-licensed on another machine, entitlement
 * cleared, or forced via devtools), demote it to the default so a paid look
 * doesn't keep painting for free.
 *
 * Then, only if online, kicks an unawaited background revalidate to pick up
 * entitlement changes. It can only refresh cached entitlement or — on an
 * explicit unknown_key — clear it and demote; a network blip never touches
 * state.
 */
export function applyInstalledPacks(): void {
  demoteIfUnowned();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    void revalidate();
  }
}

/** If the persisted pack is a bundled intense one this machine doesn't own,
 * snap back to the default (DOM + storage). No-op for free packs and for
 * owned intense packs. */
function demoteIfUnowned(): void {
  const current = loadThemePack();
  if (BUNDLED_INTENSE_IDS.has(current) && !ownsPack(current)) {
    applyThemePack(DEFAULT_PACK);
    saveThemePack(DEFAULT_PACK);
  }
}

/** Background revalidate: silent on every failure. The ONE case allowed to
 * clear local state is an explicit {ok:false, reason:"unknown_key"} — the
 * keybox affirmatively saying this key doesn't exist. Rate limits, network
 * blips, and activation_limit all leave the cached entitlement (and the
 * pack on screen) exactly as they were. */
async function revalidate(): Promise<void> {
  const key = load<string>(KEY_KEY, VERSION, "");
  if (!key) return;
  try {
    const body = await callValidate(key);
    if (body === null) return;
    if (!body.ok) {
      if (body.reason === "unknown_key") {
        clearLicenseState();
        demoteIfUnowned();
      }
      return;
    }
    const entitlement: Entitlement = {
      pass: body.pass,
      themes: body.themes,
      at: Date.now(),
    };
    save(ENTITLEMENT_KEY, VERSION, entitlement);
  } catch {
    /* stays silent — the bundled theme already on screen is unaffected */
  }
}

function clearLicenseState(): void {
  remove(KEY_KEY);
  remove(ENTITLEMENT_KEY);
  remove(PAYLOADS_KEY); // purge any legacy fetched-payload cache
}

/** Reversible by re-pasting the key, so no confirmation step. Falls back to
 * the default pack if the active one was a bundled intense pack (clearing the
 * license means it's no longer owned). */
export function deactivate(): void {
  const wasIntense = BUNDLED_INTENSE_IDS.has(loadThemePack());

  clearLicenseState();

  if (wasIntense) {
    applyThemePack(DEFAULT_PACK);
    saveThemePack(DEFAULT_PACK);
  }
}
