import { useSyncExternalStore } from "react";
import { subscribeShowing } from "../settings/themePack";

/** Whether the Fluent pack is on, in either face: its tier-3 chrome and
 * screens branch on this. */
export const fluentShowing = (): boolean => document.documentElement.dataset.themePack === "fluent";

export function useFluent(): boolean {
  return useSyncExternalStore(subscribeShowing, fluentShowing, () => false);
}
