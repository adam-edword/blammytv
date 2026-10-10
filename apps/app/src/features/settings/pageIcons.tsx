import type { ReactNode } from "react";
import { EyeDropperIcon, PlayIcon, SettingsIcon, TvIcon, UserIcon } from "../../ui/icons";
import type { SettingsTab } from "./settingsTab";

/**
 * What each page wears: in Settings' rail at 18, and in the palette at 16
 * beside a row found on it. The set had no person, so Accounts' is drawn
 * beside the others (ui/icons). One place, so the two can't come to disagree.
 */
export function pageIcon(tab: SettingsTab, size: number): ReactNode {
  switch (tab) {
    case "sources":
      return <TvIcon size={size} />;
    case "playback":
      return <PlayIcon size={size} />;
    case "appearance":
      return <EyeDropperIcon size={size} />;
    case "accounts":
      return <UserIcon size={size} />;
    case "app":
      return <SettingsIcon size={size} />;
  }
}
