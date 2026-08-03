import { load, save } from "../../lib/storage";
import type { SettingsTab } from "./SettingsModal";

/**
 * Which Settings tab you were last on.
 *
 * Persisted rather than held in the modal, because the modal is unmounted
 * when it closes: changing a theme, going to look at the result, then
 * coming back to change another put you on General every time.
 *
 * Validated by comparison rather than trusted, the same as startupTab and
 * cornerStyle. A stored value is a string from disk and the type parameter
 * on `load` is a promise nobody enforces; an unknown tab renders nothing.
 */

const KEY = "settingsTab";
const VERSION = 1;
const TABS: SettingsTab[] = ["general", "customize"];

export function loadSettingsTab(): SettingsTab {
  const stored = load<SettingsTab>(KEY, VERSION, "general");
  return TABS.includes(stored) ? stored : "general";
}

export function saveSettingsTab(tab: SettingsTab): void {
  save(KEY, VERSION, tab);
}
