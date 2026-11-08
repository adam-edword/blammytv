import type { SettingsTab } from "../settings/settingsTab";

/** The docs page for each Settings tab, which Classic's ? balloon links to.
 * Only the balloon's link opens it; the ? itself never leaves the app. */
const DOCS = "https://docs.eddtv.org";
const PAGES: Record<SettingsTab, string> = {
  home: "/using/home/",
  sources: "/sources/",
  playback: "/troubleshooting/playback/",
  appearance: "/using/appearance/",
  accounts: "/sources/",
  app: "/how-it-works/updates/",
};

export const helpUrl = (tab: SettingsTab): string => DOCS + PAGES[tab];
