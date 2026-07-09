import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../../lib/version";
import {
  isTauri,
  tauriCheckUpdate,
  tauriInstallUpdate,
} from "../../lib/tauri";

/**
 * Settings → Updates: the manual sibling of the header's UpdateChip. Shows
 * the running version and a "Check for updates" button; a found update
 * turns the button into a one-click install (download + relaunch). The
 * chip's silent launch check covers the ambient case — this row exists so
 * a user can ask "am I current?" on demand and see the answer in place.
 */
type Phase =
  | { at: "idle" }
  | { at: "checking" }
  | { at: "current" }
  | { at: "found"; version: string }
  | { at: "installing"; version: string }
  | { at: "error"; message: string };

export function UpdatesSection() {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  // "You're up to date" fades back to the plain button after a beat.
  const revertTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(revertTimer.current), []);

  if (!isTauri()) return null; // browser dev: no updater to talk to

  const check = () => {
    setPhase({ at: "checking" });
    tauriCheckUpdate().then(
      (version) => {
        if (version) setPhase({ at: "found", version });
        else {
          setPhase({ at: "current" });
          window.clearTimeout(revertTimer.current);
          revertTimer.current = window.setTimeout(
            () => setPhase({ at: "idle" }),
            4000,
          );
        }
      },
      (e) =>
        setPhase({
          at: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
    );
  };

  const install = (version: string) => {
    setPhase({ at: "installing", version });
    // On success the app restarts into the new build — no done state.
    tauriInstallUpdate().catch((e) =>
      setPhase({
        at: "error",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  };

  return (
    <section className="settings-section">
      <h3 className="settings__section-title">Updates</h3>
      <div className="customize-row">
        <div>
          <h4 className="customize-row__title">BlammyTV v{APP_VERSION}</h4>
          <p className="settings__section-note settings__section-note--dim">
            {phase.at === "found"
              ? `Version ${phase.version} is ready to install.`
              : phase.at === "installing"
                ? "Downloading and installing — the app restarts by itself."
                : phase.at === "error"
                  ? `Update check hit a snag: ${phase.message}`
                  : "Updates install themselves with one click and keep your playlists."}
          </p>
        </div>
        {phase.at === "found" || phase.at === "installing" ? (
          <button
            type="button"
            className="settings-button settings-button--accent"
            disabled={phase.at === "installing"}
            onClick={() => phase.at === "found" && install(phase.version)}
          >
            {phase.at === "installing"
              ? "Installing…"
              : `Install v${phase.version}`}
          </button>
        ) : (
          <button
            type="button"
            className="settings-button"
            disabled={phase.at === "checking"}
            onClick={check}
          >
            {phase.at === "checking"
              ? "Checking…"
              : phase.at === "current"
                ? "You're up to date ✓"
                : phase.at === "error"
                  ? "Try again"
                  : "Check for updates"}
          </button>
        )}
      </div>
    </section>
  );
}
