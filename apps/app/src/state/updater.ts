import { createContext, useContext } from "react";

/** Self-update state, shared by the launch banner and the Settings button.
 * The provider lives in UpdaterProvider.tsx; this is the pure context + hook. */
export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "installing"
  | "uptodate"
  | "error";

export interface UpdaterValue {
  status: UpdaterStatus;
  /** The new version when status === "available". */
  version?: string;
  error?: string;
  /** Re-check for an update (used by the manual Settings button). */
  check: () => Promise<void>;
  /** Download + install the available update and relaunch. */
  install: () => Promise<void>;
}

export const UpdaterContext = createContext<UpdaterValue | null>(null);

export function useUpdater(): UpdaterValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used within UpdaterProvider");
  return ctx;
}
