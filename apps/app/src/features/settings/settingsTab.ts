import { load, save } from "../../lib/storage";

/**
 * Settings' six pages, in the order the rail lists them. Each is one
 * question (the filing rule from 0.8.0, see SettingsModal), named by one word.
 * The palette lists the same six, so the names live here and nowhere else.
 */
export const SETTINGS_PAGES = [
  { key: "sources", label: "Sources" },
  { key: "playback", label: "Playback" },
  { key: "appearance", label: "Appearance" },
  { key: "home", label: "Home" },
  { key: "accounts", label: "Accounts" },
  { key: "app", label: "App" },
] as const;

export type SettingsTab = (typeof SETTINGS_PAGES)[number]["key"];

/**
 * Which Settings page you were last on.
 *
 * Persisted rather than held in the modal, because the modal is unmounted
 * when it closes: changing a theme, going to look at the result, then
 * coming back to change another put you on the first page every time.
 *
 * Validated by comparison rather than trusted, the same as startupTab and
 * cornerStyle. A stored value is a string from disk and the type parameter
 * on `load` is a promise nobody enforces; an unknown page renders nothing.
 *
 * THE TWO OLD TABS ARE MAPPED, NOT DROPPED (v0.11.26). Settings was General
 * and Customize until the five pages; the key is the same and its version
 * stays, because a version bump would send everyone who last left Customize
 * to Sources instead of to the page that holds what that tab mostly was.
 * General held Sources first; Customize was the look. (Home, the sixth page,
 * came with plan 033 and moves nothing.)
 */

const KEY = "settingsTab";
const VERSION = 1;
const OLD: Record<string, SettingsTab> = { general: "sources", customize: "appearance" };
const FIRST: SettingsTab = "sources";

export function loadSettingsTab(): SettingsTab {
  const stored = load<string>(KEY, VERSION, FIRST);
  if (Object.hasOwn(OLD, stored)) return OLD[stored];
  return SETTINGS_PAGES.some((p) => p.key === stored) ? (stored as SettingsTab) : FIRST;
}

export function saveSettingsTab(tab: SettingsTab): void {
  save(KEY, VERSION, tab);
}
