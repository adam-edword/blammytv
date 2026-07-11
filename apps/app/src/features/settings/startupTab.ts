import { load, save } from "../../lib/storage";

/** Which tab the app opens on. Mirrors the header's TabKey. */
export type StartupTab = "live" | "stream" | "discover";

/** The picker options — ONE list for Settings and onboarding, so the
 * two rails can never drift apart. Labels mirror the nav hierarchy
 * (v0.3.37+): Discover is a Stream page, so the option says where it
 * actually lands. */
export const STARTUP_TABS: Array<{ key: StartupTab; label: string }> = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream · Home" },
  { key: "discover", label: "Stream · Discover" },
];

const KEY = "startupTab";
const VERSION = 1;

export function loadStartupTab(): StartupTab {
  const stored = load<StartupTab>(KEY, VERSION, "live");
  return stored === "stream" || stored === "discover" ? stored : "live";
}

export function saveStartupTab(tab: StartupTab): void {
  save(KEY, VERSION, tab);
}
