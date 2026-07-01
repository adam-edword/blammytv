import { load, save } from "../../lib/storage";

/** Which tab the app opens on. Mirrors the header's TabKey. */
export type StartupTab = "live" | "stream" | "discover";

const KEY = "startupTab";
const VERSION = 1;

export function loadStartupTab(): StartupTab {
  const stored = load<StartupTab>(KEY, VERSION, "live");
  return stored === "stream" || stored === "discover" ? stored : "live";
}

export function saveStartupTab(tab: StartupTab): void {
  save(KEY, VERSION, tab);
}
