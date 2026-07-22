import { useEffect, useState } from "react";
import {
  isTauri,
  tauriCheckUpdate,
  tauriInstallUpdate,
} from "../lib/tauri";

/**
 * The update banner: a small glass chip that slides in beside the header
 * actions when a newer release exists, wearing the brand's gradient ring
 * (the boot logo's sweep — "something new"). One click downloads, installs,
 * and relaunches; there are no dialogs and no nagging. Absent entirely when
 * the app is current.
 *
 * The check runs once, a few seconds after launch, so it never competes
 * with the catalog load. `?update=<version>` forces the chip for styling /
 * headless screenshots (browser included); install is Tauri-only.
 */
const CHECK_DELAY_MS = 6_000;

type Phase =
  | { at: "hidden" }
  | { at: "ready"; version: string }
  | { at: "installing"; version: string }
  | { at: "error"; version: string };

export function UpdateChip() {
  const [phase, setPhase] = useState<Phase>({ at: "hidden" });

  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("update");
    if (forced) {
      setPhase({ at: "ready", version: forced });
      return;
    }
    if (!isTauri()) return;
    let stale = false;
    const id = window.setTimeout(() => {
      tauriCheckUpdate().then(
        (version) => {
          if (!stale && version) setPhase({ at: "ready", version });
        },
        () => {}, // offline / rate-limited — stay hidden, try next launch
      );
    }, CHECK_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(id);
    };
  }, []);

  if (phase.at === "hidden") return null;
  const busy = phase.at === "installing";

  return (
    <button
      type="button"
      className={"update-chip" + (busy ? " update-chip--busy" : "")}
      disabled={busy}
      // On success the app restarts into the new build, so there is no
      // "done" state to render; a failure re-arms the click as a retry.
      onClick={() => {
        setPhase({ at: "installing", version: phase.version });
        tauriInstallUpdate().catch(() =>
          setPhase({ at: "error", version: phase.version }),
        );
      }}
      title={
        busy
          ? "Downloading and installing — the app restarts by itself"
          : "Download and restart into the new version"
      }
    >
      <span className="update-chip__dot" aria-hidden />
      {phase.at === "ready" && <>v{phase.version} ready</>}
      {phase.at === "installing" && <>Installing…</>}
      {phase.at === "error" && <>Update failed — retry</>}
    </button>
  );
}
