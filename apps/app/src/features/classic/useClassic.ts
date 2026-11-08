import { useSyncExternalStore } from "react";
import { subscribeShowing } from "../settings/themePack";

/** Whether the Classic pack (Windows 2000, tier 3) is on. Classic-only
 * components and branches read this; one face, so Light and Dark alike. */
export const classicShowing = (): boolean => document.documentElement.dataset.themePack === "classic";

export function useClassic(): boolean {
  return useSyncExternalStore(subscribeShowing, classicShowing, () => false);
}
