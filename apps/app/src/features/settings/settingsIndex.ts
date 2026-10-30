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
 * `playlist-advanced` is drawn once for each playlist (their Advanced
 * disclosure, closed or open), so a find lands on the first. The two rows for an
 * Xtream playlist's movies and shows (`playlist-library`, and its rows
 * under it) are drawn only for a playlist whose provider has some, or that is
 * switched off, and the rows only while it is on: a find for one that is not
 * drawn opens the page and lights nothing, as for any row that is not there.
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
    label: "Playlists",
    page: "sources",
    world: "live",
    keywords: ["playlist", "xtream", "m3u", "stalker", "mag", "iptv", "live tv", "channels", "guide", "epg", "refresh", "folders", "categories", "hide"],
  },
  {
    id: "playlist-advanced",
    label: "Advanced",
    page: "sources",
    world: "live",
    keywords: ["extra guide", "guide url", "xmltv", "epg url", "user-agent", "user agent", "useragent", "agent", "headers", "blocked", "refused", "403", "provider"],
  },
  {
    id: "playlist-library",
    label: "Show in Stream and Discover",
    page: "sources",
    world: "live",
    keywords: ["movies and shows", "movies", "shows", "films", "series", "tv shows", "library", "vod", "on demand", "xtream", "provider", "playlist", "turn off", "switch", "hide"],
  },
  {
    id: "playlist-library-folders",
    label: "Your Rows",
    page: "sources",
    world: "live",
    keywords: ["more folders", "folders", "pick", "choose", "add", "remove", "order", "reorder", "drag", "movie folders", "show folders", "categories", "genres", "xtream", "provider", "playlist", "library"],
  },
  {
    id: "add-playlist",
    label: "Add Playlist",
    page: "sources",
    world: "live",
    keywords: ["add a playlist", "add", "new", "xtream", "m3u", "stalker", "mag", "server", "username", "password", "portal", "mac", "url"],
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
    id: "jellyfin",
    label: "Jellyfin",
    page: "sources",
    world: "stream",
    keywords: ["sign in", "server", "own", "library", "quick connect", "address", "password", "home server", "connect"],
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
    label: "Switch Sources When One Fails",
    page: "playback",
    keywords: ["auto source failover", "failover", "fallback", "retry", "dead", "next source", "switch source"],
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
    id: "audio-channels",
    label: "Speaker Setup",
    page: "playback",
    keywords: ["audio channels", "channels", "surround", "5.1", "7.1", "stereo", "receiver", "speakers", "downmix", "audio", "sound", "hdmi"],
  },
  {
    id: "subtitle-size",
    label: "Subtitle Size",
    page: "playback",
    keywords: ["subtitles", "subs", "captions", "font", "text size", "bigger", "delay", "timing"],
  },
  {
    id: "popout",
    label: "Pop-Out Window",
    page: "playback",
    keywords: ["pop-out", "popout", "pop out", "pip", "picture in picture", "window", "corner", "floating", "position", "size"],
  },
  {
    id: "popout-app",
    label: "Pop Out Films and Shows In",
    page: "playback",
    keywords: ["vlc", "external player", "other player", "video player", "videolan", "open in vlc", "pop out", "pop-out", "popout"],
  },
  {
    id: "recordings-folder",
    label: "Recordings Folder",
    page: "playback",
    keywords: ["record", "recording", "recordings", "dvr", "folder", "directory", "path", "save", "where", "videos", "location"],
  },
  {
    id: "recording-quality",
    label: "Recording Quality",
    page: "playback",
    keywords: ["record", "recording", "recordings", "dvr", "smaller", "smaller files", "original", "size", "space", "disk", "compress", "shrink", "hevc", "h265", "x265", "reencode", "encode", "gpu"],
  },
  {
    id: "accent",
    label: "Accent Color",
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
    keywords: ["start", "launch", "open on", "default tab", "home"],
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
    id: "carousel-style",
    label: "Carousel Style",
    page: "appearance",
    world: "stream",
    keywords: ["hero", "banner", "slider", "shelf", "large", "big", "wide", "watch now", "layout"],
  },
  {
    id: "hero-sources",
    label: "Carousel Catalogs",
    page: "appearance",
    world: "stream",
    keywords: ["hero slider sources", "hero slider", "hero", "slider", "carousel", "catalogs", "sources"],
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
    label: "Info While Playing",
    page: "appearance",
    world: "stream",
    keywords: ["player overlay", "overlay", "info", "osd"],
  },
  {
    id: "row-size",
    label: "Titles per Row",
    page: "appearance",
    world: "stream",
    keywords: ["catalog row size", "row size", "titles per row", "catalog", "cap"],
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
    id: "home-rows",
    label: "Home Rows",
    page: "home",
    keywords: ["home", "rows", "order", "reorder", "drag", "rename", "layout"],
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
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    page: "app",
    keywords: ["shortcuts", "keyboard", "keys", "key", "hotkeys", "bindings", "controls"],
  },
  {
    id: "about",
    label: "About",
    page: "app",
    keywords: ["version", "build", "mpv", "ffmpeg", "vulkan", "info", "help"],
  },
  {
    id: "replay-onboarding",
    label: "Replay Setup",
    page: "app",
    keywords: ["replay onboarding", "welcome", "setup", "tour", "onboarding"],
  },
  {
    id: "copy-diagnostics",
    label: "Copy Diagnostics",
    page: "app",
    keywords: ["diagnostics", "log", "logs", "support", "debug", "bug", "report", "help", "problem", "privacy", "analytics", "telemetry", "clipboard", "data"],
  },
  {
    id: "export-settings",
    label: "Export Settings",
    page: "app",
    keywords: ["export", "backup", "back up", "save", "file", "json", "move", "transfer", "migrate", "another pc", "new pc", "copy settings"],
  },
  {
    id: "import-settings",
    label: "Import Settings",
    page: "app",
    keywords: ["import", "restore", "backup", "back up", "load", "file", "json", "move", "transfer", "migrate", "another pc", "new pc", "replace"],
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
