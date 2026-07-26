import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../../lib/version";
import {
  isTauri,
  tauriCheckUpdate,
  tauriFrontendApply,
  tauriFrontendCheck,
  tauriFrontendStatus,
  tauriInstallUpdate,
} from "../../lib/tauri";
import { isPlaying } from "../../lib/playingNow";

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
  // Hot channel (plan 008): a staged frontend waiting to be served. It
  // applies on the next launch whether or not anyone touches this row —
  // that alone is the bulk of the win — so the button is an accelerator,
  // not a requirement.
  const [pending, setPending] = useState("");
  useEffect(() => {
    if (isTauri())
      void tauriFrontendStatus()
        .then((s) => setPending(s.pending))
        .catch(() => {});
  }, []);
  // "You're up to date" fades back to the plain button after a beat.
  const revertTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(revertTimer.current), []);

  if (!isTauri()) return null; // browser dev: no updater to talk to

  const check = () => {
    setPhase({ at: "checking" });
    // The hot channel first: a frontend-only release never appears in
    // latest.json, so checking only the native side would report "up to
    // date" while a bundle sat waiting to be fetched.
    void tauriFrontendCheck()
      .then((v) => v && setPending(v))
      .catch(() => {});
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

  // A row, not a section with its own 32px heading: it sits inside
  // General's "App" group, whose heading already does that job.
  return (
    <div className="customize-row">
      <div>
        <h4 className="customize-row__title">BlammyTV v{APP_VERSION}</h4>
        <p className="settings__section-note settings__section-note--dim">
          {pending
            ? `Version ${pending} is ready. It applies the next time you open BlammyTV.`
            : phase.at === "found"
            ? `Version ${phase.version} is ready to install.`
            : phase.at === "installing"
              ? "Downloading and installing. The app restarts by itself."
              : phase.at === "error"
                ? `Update check hit a snag: ${phase.message}`
                : "Updates install themselves with one click and keep your playlists."}
        </p>
      </div>
      {pending ? (
        // Restarting mid-playback would kill the stream to save a wait
        // that costs nothing — the update lands on the next launch either
        // way. Read at click time, so starting playback after Settings
        // opened still counts.
        <button
          type="button"
          className="settings-button settings-button--accent"
          onClick={() => {
            if (isPlaying()) return;
            void tauriFrontendApply().catch(() => {});
          }}
          disabled={isPlaying()}
          title={
            isPlaying()
              ? "Finish watching first — this applies on its own next launch"
              : undefined
          }
        >
          Restart now
        </button>
      ) : phase.at === "found" || phase.at === "installing" ? (
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
  );
}
