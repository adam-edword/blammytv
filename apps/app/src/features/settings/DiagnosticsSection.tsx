import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { APP_VERSION } from "../../lib/version";
import { isTauri, tauriAboutVersions, tauriLogTail } from "../../lib/tauri";
import { aboutRows } from "./aboutRows";
import { LOG_LINES, composeDiagnostics } from "./diagnostics";

/**
 * Settings → App → Privacy and data → Copy Diagnostics (plan 025, P4b): the
 * versions and the end of the log, on the clipboard as text, for a message
 * that says what went wrong. Support was screenshots.
 *
 * Asked when the button is pressed and not before, so nothing is read, here or
 * in native, unless somebody wants it. Each of the two native answers may be
 * missing (a build from before the log has no `log_tail`; one from before v0.11.36
 * has no `about_versions`; a plain browser has neither) and the copy happens
 * anyway with what the page knows, saying so when it was the log that was
 * missing. Everything is scrubbed on the way (diagnostics.ts).
 *
 * Nothing leaves the PC but through the clipboard. Whether to paste it is the
 * person's.
 *
 * There is no Open Log Folder beside it. The one command that opens anything
 * (`open_external`) opens https addresses and nothing else, on purpose, and a
 * folder is not one.
 */
type Phase = "idle" | "busy" | "copied" | "failed";

/** How long the button says what happened. */
const SAID_MS = 1500;

/** The text to copy: asked of native where there is a native. */
async function diagnosticsText(): Promise<string> {
  const native = isTauri();
  const [about, tail] = native
    ? await Promise.allSettled([tauriAboutVersions(), tauriLogTail(LOG_LINES)])
    : [undefined, undefined];
  return composeDiagnostics({
    app: APP_VERSION,
    rows: about?.status === "fulfilled" ? aboutRows(about.value) : [],
    userAgent: navigator.userAgent,
    log: tail?.status === "fulfilled" ? tail.value : null,
    when: new Date(),
  });
}

export function DiagnosticsSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    if (phase === "busy") return;
    setPhase("busy");
    let ok = true;
    try {
      await navigator.clipboard.writeText(await diagnosticsText());
    } catch {
      ok = false;
    }
    setPhase(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("idle"), SAID_MS);
  };

  return (
    <div className="customize-row" data-setting="copy-diagnostics">
      <div>
        <h4 className="customize-row__title">Copy Diagnostics</h4>
        <p className="settings__section-note settings__section-note--dim">
          The app has no analytics and sends no reports. Diagnostics leave this
          PC only when you copy them.
        </p>
      </div>
      <Button
        variant="secondary"
        type="button"
        className="settings-button"
        // Not `disabled`: pressing it with the keyboard would take its focus.
        aria-disabled={phase === "busy"}
        onClick={() => void copy()}
      >
        {phase === "busy"
          ? "Copying…"
          : phase === "copied"
            ? "Copied"
            : phase === "failed"
              ? "Couldn't Copy"
              : "Copy"}
      </Button>
    </div>
  );
}
