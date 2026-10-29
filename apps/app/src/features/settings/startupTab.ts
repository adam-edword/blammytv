import { load, save } from "../../lib/storage";

/** Which tab the app opens on. Mirrors the header's TabKey. */
export type StartupTab = "home" | "live" | "stream" | "discover";

/** The picker options — ONE list for Settings and onboarding, so the
 * two rails can never drift apart. Labels mirror the nav hierarchy
 * (v0.3.37+): Discover is a Stream page, so the option says where it
 * actually lands. A side's own name means its first page. "Stream" was
 * "Stream · Home" until v0.9.98, when "Home" left the app; it came back as the
 * page behind the logo (plan 033), which is what "Home" means here. */
export const STARTUP_TABS: Array<{ key: StartupTab; label: string }> = [
  { key: "home", label: "Home" },
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
  { key: "discover", label: "Stream · Discover" },
];

/**
 * The places worth offering, given what is set up: Live TV needs a playlist,
 * and the Stream pages need something to stream from. In STARTUP_TABS' order.
 * Home sits with Stream because in phase 1 every row on it is a film or a
 * show; phase 2's live rows widen it to `live || stream`.
 */
export function startupChoices({ live, stream }: { live: boolean; stream: boolean }) {
  return STARTUP_TABS.filter((t) => (t.key === "live" ? live : stream));
}

/** Where a launch opens, and so what the picker shows as chosen: the stored
 * tab if it is on offer, else Stream if that is (where a launch fell back to
 * before), else the first choice. Never saved, so a source added later gets
 * the stored tab back. App's launch reads the same, so the two can't differ. */
export function shownStartup(stored: StartupTab, choices: ReadonlyArray<{ key: StartupTab }>): StartupTab {
  if (choices.some((c) => c.key === stored)) return stored;
  if (choices.some((c) => c.key === "stream")) return "stream";
  return choices[0]?.key ?? stored;
}

const KEY = "startupTab";
const VERSION = 1;

export function loadStartupTab(): StartupTab {
  const stored = load<StartupTab>(KEY, VERSION, "live");
  return stored === "home" || stored === "stream" || stored === "discover" ? stored : "live";
}

export function saveStartupTab(tab: StartupTab): void {
  save(KEY, VERSION, tab);
}
