import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "../lib/tauri";
import { checkForUpdate, installUpdate } from "../lib/updater";
import {
  UpdaterContext,
  type UpdaterStatus,
  type UpdaterValue,
} from "./updater";

/** Auto-checks for an update once on launch (desktop only) and exposes a manual
 * re-check + install. Both the launch banner and the Settings button read this. */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [version, setVersion] = useState<string>();
  const [error, setError] = useState<string>();

  const check = useCallback(async () => {
    if (!isTauri()) return;
    setStatus("checking");
    setError(undefined);
    try {
      const v = await checkForUpdate();
      if (v) {
        setVersion(v);
        setStatus("available");
      } else {
        setStatus("uptodate");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const install = useCallback(async () => {
    setStatus("installing");
    setError(undefined);
    try {
      await installUpdate(); // app relaunches on success
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  // Auto-check once on launch. Silent: only surfaces if an update is found.
  useEffect(() => {
    if (isTauri()) void check();
  }, [check]);

  const value: UpdaterValue = { status, version, error, check, install };

  return (
    <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>
  );
}
