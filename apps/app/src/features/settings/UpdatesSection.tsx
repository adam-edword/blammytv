import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
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
import { Hint } from "../../ui/Hint";

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
    // Then ask what is WAITING, not what this check staged: a bundle the
    // launch-time check already staged comes back from frontend_check as
    // "" (nothing new to do), and the row said "You're up to date" over it
    // (0.10.3, Adam: "checking for update doesn't do anything").
    void tauriFrontendCheck()
      .catch(() => "")
      .then(() => tauriFrontendStatus())
      .then((s) => setPending(s.pending))
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
          {phase.at === "found"
            ? `Version ${phase.version} is ready to install.`
            : pending
            ? `Version ${pending} is ready. It applies the next time you open BlammyTV.`
            : phase.at === "installing"
              ? "Downloading and installing. The app restarts by itself."
              : phase.at === "error"
                ? `Update check hit a snag: ${phase.message}`
                : "Updates install themselves with one click and keep your playlists."}
        </p>
      </div>
      {/* An installer found beats a waiting bundle (plan 016 F20): it
        * carries a frontend of its own, and a native update is the one a
        * bundle can't bring. It used to hide behind "Restart now". */}
      {phase.at === "found" || phase.at === "installing" ? (
        // Installing restarts the app, so it waits for playback to finish
        // like Restart now does (F20).
        <Hint
          label="Finish watching first. Then install."
          off={phase.at === "installing" || !isPlaying()}
        >
        <Button
          variant="default"
          type="button"
          className="settings-button settings-button--accent"
          disabled={phase.at === "installing"}
          onClick={() => {
            if (phase.at !== "found" || isPlaying()) return;
            install(phase.version);
          }}
          aria-disabled={phase.at === "found" && isPlaying()}
        >
          {phase.at === "installing"
            ? "Installing…"
            : `Install v${phase.version}`}
        </Button>
        </Hint>
      ) : pending ? (
        // Restarting mid-playback would kill the stream to save a wait
        // that costs nothing — the update lands on the next launch either
        // way. Read at click time, so starting playback after Settings
        // opened still counts.
        // Greyed by aria-disabled, not disabled: a disabled button gets no
        // pointer and so no hint, and the hint is the reason it is grey.
        // The click is refused in the handler either way.
        <Hint
          label="Finish watching first. It applies on its own next launch."
          off={!isPlaying()}
        >
        <Button
          // `default` IS the accent state. `.settings-button--accent` used
          // to mix 22% accent into the neutral face; since v0.9.54 that
          // colour comes from the variant's utilities, which outrank the
          // app layer, so the modifier could not have painted. The class
          // stays as the harness hook and the section's own selector.
          variant="default"
          type="button"
          className="settings-button settings-button--accent"
          onClick={() => {
            if (isPlaying()) return;
            void tauriFrontendApply().catch(() => {});
          }}
          aria-disabled={isPlaying()}
        >
          Restart now
        </Button>
        </Hint>
      ) : (
        <Button
          variant="secondary"
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
        </Button>
      )}
    </div>
  );
}
