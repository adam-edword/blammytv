import { APP_VERSION } from "../../lib/version";
import { isEnvelope, readRaw, writeRaw, type Envelope } from "../../lib/storage";
import { hasTokenRun } from "../../lib/scrub";

/**
 * Export and Import settings (plan 025, P4c): which of the app's stored keys
 * go in a settings file, which only when asked, which never, and the rules for
 * building the file and for applying one.
 *
 * Every key the app stores (lib/storage.ts, prefix `blammytv.`) is filed in
 * exactly one group below. settingsExport.test.ts reads the source for every
 * key a `load`, `save`, `loadList` or `remove` is given and fails on one that
 * is in no group, so a new setting cannot be left out by being forgotten.
 *
 *   looks, playback, yours   always exported. Appearance and playback
 *                            settings; your lists, favourites, Continue
 *                            Watching, watched episodes, guide fixes, followed
 *                            teams and multi-view layouts.
 *   logins                   only when the person ticks the box. Everything
 *                            Clear All Login Info clears that lives in storage
 *                            (AppPage.tsx `clearLogins`): the playlists, which
 *                            hold provider passwords, MACs and URLs, the
 *                            AIOStreams manifest, and the hero sources.
 *   never                    in no file, whatever the box says and whatever a
 *                            file claims. The Trakt, MyAnimeList, AIOStreams and
 *                            Jellyfin sign-ins' bookkeeping and queues (the sessions
 *                            themselves are in the OS vault, native's), the
 *                            TMDB key, caches, one-time flags, and window or
 *                            panel state.
 *
 * `clearLogins` stays the definition of a login. Only the playlists, the
 * manifest and the hero sources are stored keys of that kind; the other things
 * it clears are sign-ins (never, the Jellyfin one included), the catalog mirror (`vodCache`, a cache) and
 * the guide's copy on disk (IndexedDB, not here). The test reads `clearLogins`
 * too, so a call added to it makes it fail until this file has been looked at.
 *
 * Artwork is the one thing in an always-exported group that can hold a key. A
 * title's poster, backdrop or logo is stored as the address the addon gave, and
 * an addon can rewrite its posters through a service that puts the person's key
 * in the address (RPDB does). So an export WITHOUT logins leaves out any stored
 * artwork address that looks like it carries one (`artCarriesKey`), the field
 * and not the entry. With them it is all there, as the move-everything export
 * it is. Import is unchanged. Continue Watching and your lists are the only
 * always-exported keys with artwork fields (`ART_FIELDS`), and the app never
 * fills an artwork field back in, so a title that lost its tile shows a blank
 * one. A signed-in AIOStreams' artwork carries its source address inside an
 * image tag, so it is judged by the address the tag decodes to, and its own
 * tiles stay unless that address carries a key.
 *
 * The onboarding flags (`btv:onboarded`, `btv:welcome-played`) are not under
 * the prefix and not here: only a key listed below is ever read or written.
 */
export const KEY_GROUPS = {
  looks: [
    "accent",
    "accent-custom",
    "theme",
    "clockFormat",
    "startupTab",
    "showChannelNumber",
    "showHero",
    "cardMeta",
    "overlayMeta",
    "rowCap",
    // The Sports screen's own settings (plan 025 keeps them where they are
    // used): they are how it looks and what it shows.
    "compactResults",
    "hideFinishedRow",
    "sportsRankedOnly",
  ],
  playback: [
    "oneClickPlay",
    "sourceFailover",
    "autoplayNext",
    "upNextCard",
    "skipping",
    "preferredAudioLang",
    "preferredSubLang",
    // The track you picked by hand for a show, and the global one.
    "playbackPrefs",
    "playbackPrefsByShow",
    "audioChannels",
    "subtitleSize",
    "popoutSize",
    "popoutCorner",
    // Settings → Sources → Content: what the app shows, not a login.
    "showAdult",
  ],
  yours: [
    "favorites",
    "recents",
    "guideFixes",
    "lists",
    "watching",
    "watchedEpisodes",
    "sports-follows",
    "multiviewGrid",
    "multiviewLayouts",
    "multiviewSplits",
    "multiviewVolume",
    "multiviewScores",
  ],
  logins: ["playlists", "aiostreams", "heroSources"],
  never: [
    // The sign-ins' bookkeeping and queues. The tokens are in the OS vault.
    "trakt",
    "traktQueue",
    "mal",
    "aiojf",
    "aiojfQueue",
    // A Jellyfin server of your own (plan 027): the sign-in's bookkeeping,
    // where it is and who. The token is in the OS vault, and the address is
    // the one thing in it worth keeping private, so no file carries it.
    "jellyfin",
    // What was read from that server, kept for the next launch: the catalog
    // mirror (titles, and the address in their art) and the ids its titles
    // have there. Caches, cleared with the sign-in (jellyfin/store.ts).
    "jfVodCache",
    "jfIds",
    // Sync bookkeeping tied to an account: what Trakt, MAL and AIOStreams
    // each count as played, and AIOStreams' packed ids.
    "aioWatched",
    "malWatched",
    "aiojfIds",
    "tmdbKey",
    // Caches. `vodCache` also has the manifest URL in its key.
    "vodCache",
    "aniskipIndex",
    "kitsuMalIndex",
    "discoverArt",
    // One-time flags. `myList` and `skipBehavior` are the keys `lists` and
    // `skipping` replaced: read once to migrate and left alone since, so the
    // new keys carry everything.
    "multiviewNoticeSeen",
    "listsMigrated",
    "myList",
    "skipBehavior",
    // Window and panel state, which is this screen's and not a preference:
    // the Settings page you were on, the Sports sidebar and theater folds and
    // the theater's width, the Guide's card width.
    "settingsTab",
    "sportsSidebarCollapsed",
    "sportsTheaterFolded",
    "sportsTheaterRailShut",
    "sportsTheaterSideWidth",
    "guideCardW",
    // Diagnostic records kept for support, not settings.
    "sportsPairingLog",
    "fullscreenChecks",
  ],
} as const;

export type KeyGroup = keyof typeof KEY_GROUPS;

/** The groups an export always holds, in the order the file lists them. */
const ALWAYS: readonly KeyGroup[] = ["looks", "playback", "yours"];

const GROUP_OF: ReadonlyMap<string, KeyGroup> = new Map(
  (Object.keys(KEY_GROUPS) as KeyGroup[]).flatMap((g) =>
    (KEY_GROUPS[g] as readonly string[]).map((k): [string, KeyGroup] => [k, g]),
  ),
);

/** Which group a key is filed in; none for a key this build has never stored. */
export const groupOf = (key: string): KeyGroup | undefined => GROUP_OF.get(key);

/** What `app`, `kind` and `format` have to say for a file to be ours. */
export const FILE_APP = "BlammyTV";
export const FILE_KIND = "settings";
export const FILE_FORMAT = 1;

export interface SettingsFile {
  app: typeof FILE_APP;
  kind: typeof FILE_KIND;
  format: number;
  /** The app version that wrote it. Informational: `format` is the contract. */
  version: string;
  /** ISO time. */
  exported: string;
  /** Whether the box was ticked: the playlists, the manifest and the hero
   * sources are in the file, and an import may write them. */
  includesLogins: boolean;
  /** Key (without the prefix) to its stored envelope, as it is on disk. */
  keys: Record<string, Envelope<unknown>>;
}

/** Hosts whose artwork addresses carry the person's key in the path. */
const KEYED_ART_HOSTS: ReadonlySet<string> = new Set(["api.ratingposterdb.com"]);

/** Query parameters named as a key is. */
const KEY_PARAMS: ReadonlySet<string> = new Set(["key", "apikey", "api_key", "token", "access_token", "auth"]);

const decoded = (piece: string): string => {
  try {
    return decodeURIComponent(piece);
  } catch {
    return piece;
  }
};

/** The three rules, asked of an address. */
function plainKeyed(u: URL): boolean {
  // A user name or password in front of the host is a login, whatever else.
  if (u.username || u.password) return true;
  if (KEYED_ART_HOSTS.has(u.hostname.toLowerCase())) return true;
  let found = false;
  u.searchParams.forEach((value, name) => {
    if (KEY_PARAMS.has(name.toLowerCase()) || hasTokenRun(value)) found = true;
  });
  return found || u.pathname.split("/").some((segment) => hasTokenRun(decoded(segment)));
}

/** A Jellyfin image address as AIOStreams' sign-in gives one (aiojf/browse.ts):
 * the path ends in `/Items/<an item id, 32 lower case hex>/Images/<Type>`, and
 * `/<index>` for a backdrop. What is ahead of it is the person's own instance. */
const JELLYFIN_IMAGE = /\/Items\/[0-9a-f]{32}\/Images\/[A-Za-z]+(?:\/\d+)?$/;

/** What an image tag's host code stands for. Code 0 is not a host: the rest of
 * the tag is the whole address (an RPDB poster arrives that way). */
const TAG_HOSTS: ReadonlyMap<string, string> = new Map([
  ["1", "https://images.metahub.space/"],
  ["2", "https://image.tmdb.org/t/p/"],
  ["3", "https://artworks.thetvdb.com/"],
  ["4", "https://assets.fanart.tv/"],
  ["5", "https://images.metahub.space/background/medium/"],
]);

/** An image tag opens with a signature of this many characters, then the one
 * character that is the host code. */
const TAG_SIGNATURE = 11;

/** The text of unpadded or padded base64url that is UTF-8, or null when it is
 * not either. */
function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(text)) return null;
  const bare = text.replace(/=+$/, "");
  if (bare.length % 4 === 1) return null;
  try {
    const standard = bare.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(bare.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(standard), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The address an AIOStreams image tag points to, or null when it does not
 * decode. A tag is an 11 character signature, one host code character, and the
 * base64url of the rest of the address (code 0: the whole address). The
 * signature is the instance's own and is not checked: this only reads where
 * the tag would send a request, to judge it. Null for a tag that is too short,
 * has a code it does not know, is not base64url or UTF-8, or does not make an
 * http or https address.
 */
function tagAddress(tag: string): URL | null {
  if (tag.length <= TAG_SIGNATURE + 1) return null;
  const code = tag[TAG_SIGNATURE];
  const rest = fromBase64Url(tag.slice(TAG_SIGNATURE + 1));
  if (rest === null || rest === "") return null;
  const host = TAG_HOSTS.get(code);
  if (code !== "0" && host === undefined) return null;
  try {
    const u = new URL(code === "0" ? rest : host + rest);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** A signed-in AIOStreams image address, judged by its query alone: the item id
 * is an opaque id and not a secret. A name that is a key's is a key; each `tag`
 * is judged by the address it points to, and one that does not decode is
 * dropped; any other value goes through the token rule. */
function jellyfinImageKeyed(u: URL): boolean {
  let found = false;
  u.searchParams.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (KEY_PARAMS.has(lower)) found = true;
    else if (lower === "tag") {
      const target = tagAddress(value);
      if (target === null || plainKeyed(target)) found = true;
    } else if (hasTokenRun(value)) found = true;
  });
  return found;
}

/**
 * Whether an artwork address looks like it carries a key. Any of:
 *
 *  - a user name or password in front of the host (`https://me:pw@…`);
 *  - its host is one that puts the key in the path (RPDB);
 *  - a query parameter is named key, apikey, api_key, token, access_token or
 *    auth, in any case;
 *  - a path segment or a query value is something lib/scrub.ts's token rule
 *    would redact (`hasTokenRun`): 32 or more of its characters, 16 or more of
 *    them letters or digits.
 *
 * The token rule is asked of one path segment at a time, because it counts the
 * slash as part of a run: the whole path of a TMDB image, `/t/p/w500/` and its
 * 27-character file name, is one run of 37. Only http and https addresses are
 * judged; anything else (a relative path, a data address, text that is not an
 * address) is not an artwork address from an addon and is kept.
 *
 * AIOStreams' own sign-in art is the exception to the path rule (`jellyfinImageKeyed`):
 * its item id is 32 hex, which the token rule would redact, and its tag is long,
 * which it would too, so every tile of a signed-in person would go. The id is not a
 * secret, so those addresses are judged by their query, and a tag by the address
 * it decodes to (`tagAddress`): an RPDB poster arrives as one, with its key
 * inside, and is dropped; a TMDB or metahub one is kept as stored.
 *
 * It errs towards dropping, as scrub does: an address with a long hash in it
 * loses its tile in a file made without logins, and one that kept a key does
 * not.
 */
export function artCarriesKey(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return true;
  return JELLYFIN_IMAGE.test(u.pathname) ? jellyfinImageKeyed(u) : plainKeyed(u);
}

/** The fields that hold an addon's artwork address, in the entries of each
 * always-exported key that has any. `lists` has a `cover` too, which is an
 * image the person uploaded (a data address of their own), and is not one. */
export const ART_FIELDS = {
  watching: ["art", "logo"],
  lists: ["poster", "backdrop", "logo"],
} as const;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** An entry without the artwork fields that carry a key: a copy when there are
 * any, the entry itself when there are none or it is not an object. */
function withoutKeyedArt(entry: unknown, fields: readonly string[]): unknown {
  if (!isRecord(entry)) return entry;
  const drop = fields.filter((f) => typeof entry[f] === "string" && artCarriesKey(entry[f]));
  if (drop.length === 0) return entry;
  const copy = { ...entry };
  for (const f of drop) delete copy[f];
  return copy;
}

/** A stored envelope as a file made without logins holds it: Continue Watching
 * and the lists lose the artwork fields that carry a key, entry by entry, and
 * everything else is as it was. Never changes what is stored. */
function withoutKeyedArtIn(key: string, env: Envelope<unknown>): Envelope<unknown> {
  const { data } = env;
  if (key === "watching" && Array.isArray(data))
    return { v: env.v, data: data.map((e) => withoutKeyedArt(e, ART_FIELDS.watching)) };
  if (key === "lists" && Array.isArray(data))
    return {
      v: env.v,
      data: data.map((list) =>
        isRecord(list) && Array.isArray(list.entries)
          ? { ...list, entries: list.entries.map((e) => withoutKeyedArt(e, ART_FIELDS.lists)) }
          : list,
      ),
    };
  return env;
}

/** A stored key as an envelope, or null if there is none or it is not one. */
function storedEnvelope(key: string): Envelope<unknown> | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isEnvelope(parsed) ? { v: parsed.v, data: parsed.data } : null;
  } catch {
    return null;
  }
}

/**
 * The settings file, as an object. A key that is not stored, or is stored as
 * something that is not an envelope, is left out. With `logins` false the file
 * holds no playlist, no manifest and no hero source, and none of the artwork
 * addresses that look like they carry a key (`artCarriesKey`); with it true it
 * holds those too, and every artwork address as stored; the `never` group is
 * in neither.
 */
export function buildSettingsFile(opts: { logins: boolean; now?: Date }): SettingsFile {
  const groups: readonly KeyGroup[] = opts.logins ? [...ALWAYS, "logins"] : ALWAYS;
  const keys: Record<string, Envelope<unknown>> = {};
  for (const g of groups)
    for (const k of KEY_GROUPS[g] as readonly string[]) {
      const env = storedEnvelope(k);
      if (env) keys[k] = opts.logins ? env : withoutKeyedArtIn(k, env);
    }
  return {
    app: FILE_APP,
    kind: FILE_KIND,
    format: FILE_FORMAT,
    version: APP_VERSION,
    exported: (opts.now ?? new Date()).toISOString(),
    includesLogins: opts.logins,
    keys,
  };
}

/** `blammytv-settings-2026-10-12.json`: the day on this PC's clock. */
export function settingsFileName(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `blammytv-settings-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}

/** What a person reads when a file is no use. One line each, and none of them
 * repeats anything the file said. */
export const NOT_A_SETTINGS_FILE = "That isn't a BlammyTV settings file.";
export const FILE_TOO_NEW = "That settings file is from a newer BlammyTV. Update the app, then try again.";
export const NOTHING_TO_IMPORT = "There is nothing in that file to import.";
export const COULD_NOT_WRITE = "Couldn't write the settings, so nothing was changed.";

export type Parsed =
  | { ok: true; includesLogins: boolean; keys: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Read a settings file's text. Nothing is written here. It has to be JSON, an
 * object with `app` "BlammyTV" and `kind` "settings", a `format` this build
 * knows (a newer one is said to be newer, anything else is not ours) and a
 * `keys` object. A byte order mark ahead of the text (Notepad adds one) is
 * ignored.
 */
export function parseSettingsFile(text: string): Parsed {
  const no: Parsed = { ok: false, reason: NOT_A_SETTINGS_FILE };
  let file: unknown;
  try {
    file = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return no;
  }
  if (typeof file !== "object" || file === null || Array.isArray(file)) return no;
  const f = file as Record<string, unknown>;
  if (f.app !== FILE_APP || f.kind !== FILE_KIND) return no;
  if (typeof f.format !== "number" || !Number.isInteger(f.format) || f.format < 1) return no;
  if (f.format > FILE_FORMAT) return { ok: false, reason: FILE_TOO_NEW };
  if (typeof f.keys !== "object" || f.keys === null || Array.isArray(f.keys)) return no;
  return { ok: true, includesLogins: f.includesLogins === true, keys: f.keys as Record<string, unknown> };
}

export type Imported = { ok: true; written: number } | { ok: false; reason: string };

/**
 * Apply a settings file's text. Only a key this build files in looks, playback
 * or yours is written, and one in logins only when the file says it includes
 * logins; a key in never is not written whatever the file says, and nor is one
 * this build has no group for. Each is written only if it is an envelope,
 * `{ v: number, data }`, and as exactly that. A key the file does not mention
 * is left as it is.
 *
 * All or nothing as far as the store allows: the keys are checked first, then
 * written, and a write the store refuses puts back every key already written.
 * A file that fails its checks changes nothing, and `reason` says why in a
 * line that holds nothing from the file. The caller reloads the window on
 * `written > 0` so every module reads afresh.
 *
 * Nothing here logs. What the file holds is the person's, and some of it
 * (playlists) is a password.
 */
export function applySettingsFile(text: string): Imported {
  const parsed = parseSettingsFile(text);
  if (!parsed.ok) return parsed;
  const todo: Array<{ key: string; raw: string }> = [];
  for (const [key, value] of Object.entries(parsed.keys)) {
    const group = groupOf(key);
    if (!group || group === "never") continue;
    if (group === "logins" && !parsed.includesLogins) continue;
    if (!isEnvelope(value)) continue;
    todo.push({ key, raw: JSON.stringify({ v: value.v, data: value.data }) });
  }
  if (todo.length === 0) return { ok: false, reason: NOTHING_TO_IMPORT };
  const before = todo.map(({ key }) => ({ key, raw: readRaw(key) }));
  for (let i = 0; i < todo.length; i++) {
    if (writeRaw(todo[i].key, todo[i].raw)) continue;
    for (const { key, raw } of before.slice(0, i)) writeRaw(key, raw);
    return { ok: false, reason: COULD_NOT_WRITE };
  }
  return { ok: true, written: todo.length };
}
