import type { SettingsTab } from "./settingsTab";

/**
 * Every row in Settings, as a list the palette can search (plan 025, P2).
 *
 * Ctrl+K, "subtitle", Enter, and Settings opens on Playback with the row lit.
 * That is settings search without a second search box.
 *
 * A STATIC LIST, as VS Code's settings registry is. The rows can't be read
 * off the DOM: Settings is closed when the palette is asked, and a page only
 * mounts while it is showing. So the list has to be written down, and a list
 * written down can drift from the screens. verify-settings-find holds the two
 * together: every row on every page and pill must carry a `data-setting` that
 * is in here with that page and world, and every row in here must be on its
 * page.
 *
 * `label` is the row's visible title, word for word, except where the screen's
 * words change with state: Trakt's row reads "Trakt: name" once signed in, the
 * update row is "BlammyTV v0.11.27", and Add Playlist's title follows the type
 * picked ("Add Xtream Playlist"). Those take the plain name here.
 *
 * `world` is the Live TV / Stream pill the row sits under, on a page that has
 * one (Sources, Appearance). A row above the pill, or on a page with none,
 * has no world.
 *
 * `keywords` are the other words a person would type, lowercase. Add one when
 * a word is missing; don't take one out.
 */
export interface SettingRow {
  /** What the row's `data-setting` says. Unique. */
  id: string;
  label: string;
  page: SettingsTab;
  world?: "live" | "stream";
  keywords: readonly string[];
}

export const SETTINGS_INDEX: readonly SettingRow[] = [
  {
    id: "playlists",
    label: "Your playlists",
    page: "sources",
    world: "live",
    keywords: ["playlist", "xtream", "m3u", "stalker", "mag", "iptv", "live tv", "channels", "guide", "epg", "refresh", "folders", "categories", "hide"],
  },
  {
    id: "add-playlist",
    label: "Add a playlist",
    page: "sources",
    world: "live",
    keywords: ["add", "new", "xtream", "m3u", "stalker", "mag", "server", "username", "password", "portal", "mac", "url"],
  },
  {
    id: "content",
    label: "Content",
    page: "sources",
    world: "live",
    keywords: ["adult", "nsfw", "hide", "filter", "mature", "18+"],
  },
  {
    id: "aiostreams",
    label: "AIOStreams",
    page: "sources",
    world: "stream",
    keywords: ["sign in", "login", "manifest", "addon", "stream", "jellyfin", "sync", "url", "address", "aio", "stremio", "connect"],
  },
  {
    id: "connection-test",
    label: "Connection Test",
    page: "sources",
    world: "stream",
    keywords: ["test", "check", "debug", "network", "problem", "error", "403"],
  },
  {
    id: "one-click-play",
    label: "One-Click Play Movies",
    page: "playback",
    keywords: ["autoplay", "cached", "instant", "one click"],
  },
  {
    id: "source-failover",
    label: "Auto Source Failover",
    page: "playback",
    keywords: ["fallback", "retry", "dead", "next source"],
  },
  {
    id: "autoplay-next",
    label: "Autoplay Next Episode",
    page: "playback",
    keywords: ["next episode", "binge", "countdown", "autoplay"],
  },
  {
    id: "up-next-card",
    label: "Up Next Card",
    page: "playback",
    keywords: ["up next", "popup", "card", "corner", "credits"],
  },
  {
    id: "skipping",
    label: "Skipping",
    page: "playback",
    keywords: ["skip", "intro", "recap", "credits", "preview", "chapters", "outro", "automatic", "auto skip", "combine"],
  },
  {
    id: "preferred-language",
    label: "Preferred Language",
    page: "playback",
    keywords: ["audio", "subtitle", "subtitles", "subs", "captions", "dub", "language"],
  },
  {
    id: "accent",
    label: "Accent",
    page: "appearance",
    keywords: ["colour", "color", "theme", "highlight"],
  },
  {
    id: "color-mode",
    label: "Appearance",
    page: "appearance",
    keywords: ["light", "dark", "mode", "theme", "system", "windows"],
  },
  {
    id: "startup-tab",
    label: "Startup Tab",
    page: "appearance",
    keywords: ["start", "launch", "open on", "default tab"],
  },
  {
    id: "clock-format",
    label: "Clock Format",
    page: "appearance",
    keywords: ["12", "24", "hour", "time", "am", "pm"],
  },
  {
    id: "featured-carousel",
    label: "Featured Carousel",
    page: "appearance",
    world: "stream",
    keywords: ["hero", "banner", "slider"],
  },
  {
    id: "hero-sources",
    label: "Hero Slider Sources",
    page: "appearance",
    world: "stream",
    keywords: ["hero", "carousel", "catalogs"],
  },
  {
    id: "card-details",
    label: "Card Details",
    page: "appearance",
    world: "stream",
    keywords: ["poster", "rating", "year", "cards", "runtime", "genre"],
  },
  {
    id: "player-overlay",
    label: "Player Overlay",
    page: "appearance",
    world: "stream",
    keywords: ["overlay", "info", "osd"],
  },
  {
    id: "row-size",
    label: "Catalog Row Size",
    page: "appearance",
    world: "stream",
    keywords: ["row size", "titles per row", "catalog", "cap"],
  },
  {
    id: "channel-numbers",
    label: "Channel Numbers",
    page: "appearance",
    world: "live",
    keywords: ["number", "numbers", "lcn"],
  },
  {
    id: "reset-appearance",
    label: "Reset Appearance",
    page: "appearance",
    keywords: ["reset", "default", "defaults", "restore", "factory"],
  },
  {
    id: "trakt",
    label: "Trakt",
    page: "accounts",
    keywords: ["scrobble", "history", "watched", "sync", "watchlist"],
  },
  {
    id: "mal",
    label: "MyAnimeList",
    page: "accounts",
    keywords: ["mal", "anime", "sync", "my anime list"],
  },
  {
    id: "updates",
    label: "Updates",
    page: "app",
    keywords: ["update", "version", "check for updates", "upgrade", "install"],
  },
  {
    id: "replay-onboarding",
    label: "Replay Onboarding",
    page: "app",
    keywords: ["welcome", "setup", "tour", "onboarding"],
  },
  {
    id: "clear-logins",
    label: "Clear All Login Info",
    page: "app",
    keywords: ["sign out", "log out", "logout", "delete", "credentials", "password", "clear", "remove", "forget"],
  },
];

export function settingById(id: string): SettingRow | undefined {
  return SETTINGS_INDEX.find((r) => r.id === id);
}

/**
 * The rows a typed query finds, best first: a label that starts with it, then
 * a label that contains it, then a keyword that does. Registry order inside
 * each band, so the order a page lists its rows in is the order ties come out
 * in. Case doesn't matter. Nothing typed finds nothing: the palette's list
 * before typing is places, not every row of Settings.
 */
export function findSettings(query: string, limit: number): SettingRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: SettingRow[] = [];
  const has: SettingRow[] = [];
  const keyed: SettingRow[] = [];
  for (const r of SETTINGS_INDEX) {
    const label = r.label.toLowerCase();
    if (label.startsWith(q)) starts.push(r);
    else if (label.includes(q)) has.push(r);
    else if (r.keywords.some((k) => k.includes(q))) keyed.push(r);
  }
  return [...starts, ...has, ...keyed].slice(0, limit);
}

/**
 * A request for Settings to land on a row (the palette's, via App). `world` is
 * the pill the row sits under, for the pages that have one. `n` counts the
 * requests, so the same row asked for twice is a new request and not the one
 * App already holds.
 */
export interface SettingsFind {
  row: string;
  world?: "live" | "stream";
  n: number;
}
