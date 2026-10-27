import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { finishFirst, isPlaying } from "../../lib/playingNow";
import { isTauri, tauriHasSettingsFiles, tauriSettingsExport, tauriSettingsImport } from "../../lib/tauri";
import { Hint } from "../../ui/Hint";
import { ConfirmButton } from "./ConfirmButton";
import { NOT_A_SETTINGS_FILE, applySettingsFile, buildSettingsFile, settingsFileName } from "./settingsExport";

/**
 * Settings → App → Privacy and data → Export Settings and Import Settings (plan
 * 025, P4c): your settings in a file you choose, to move to another PC or keep
 * as a backup, and back from one.
 *
 * What goes in the file, and what an import will take from one, is
 * settingsExport.ts. Playlists and the AIOStreams manifest have passwords in
 * them, so they go in only when the box is ticked, and it is off every time
 * this page opens. So do the favourites, recents, guide fixes and multi-view
 * grid: they name the playlists' channels, and a playlist id is this PC's own.
 * The Trakt, MyAnimeList, AIOStreams and Jellyfin sign-ins never go in a file.
 *
 * The file dialogs are native's (`settings_export`, `settings_import`): the
 * page never names a path, and it is handed only the file name, to say "Saved
 * as". A native build from before them has neither command, and the two
 * buttons wait for the next app update, with a Hint that says so. In a plain
 * browser there is no dialog to open and they say that.
 *
 * Import asks twice (ConfirmButton), refuses while something is playing, and
 * reloads the window when it has written, so every module reads the new values
 * afresh. A file that fails its checks changes nothing, and the row says why in
 * a line. Nothing here logs: not the file, not what is in it.
 */

type Files = "yes" | "update" | "app";

/** Whether the file dialogs can be used here. Optimistic until native answers
 * (it answers at once), so a build that has them never shows the buttons
 * greyed. */
function useFiles(): Files {
  const [files, setFiles] = useState<Files>(isTauri() ? "yes" : "app");
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    void tauriHasSettingsFiles().then((has) => {
      if (live) setFiles(has ? "yes" : "update");
    });
    return () => {
      live = false;
    };
  }, []);
  return files;
}

/** The button where the file dialogs can't be used: grey, and the reason on
 * hover and focus. `aria-disabled` and not `disabled`, because a disabled
 * button gets no pointer and so no hint (UpdatesSection does the same). */
function Off({ files, children }: { files: Exclude<Files, "yes">; children: string }) {
  return (
    <Hint label={files === "app" ? "Only in the BlammyTV app." : "Needs the next app update."}>
      <Button
        variant="secondary"
        type="button"
        className="settings-button cursor-not-allowed opacity-50"
        aria-disabled="true"
      >
        {children}
      </Button>
    </Hint>
  );
}

/** The one line a failed save or read becomes. Fixed words: what native said
 * may have a path or the system's text in it, and none of it is shown. */
const said = (e: unknown, ...codes: Array<[string, string]>): string => {
  const text = e instanceof Error ? e.message : String(e);
  return codes.find(([code]) => text.includes(code))?.[1] ?? "";
};

export function SettingsFilesSection() {
  const files = useFiles();
  return (
    <>
      <ExportRow files={files} />
      <ImportRow files={files} />
    </>
  );
}

function ExportRow({ files }: { files: Files }) {
  // Off every time the page opens: this state is the page's, and it is new
  // each time the page mounts.
  const [logins, setLogins] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaved(null);
    setProblem(null);
    try {
      const json = JSON.stringify(buildSettingsFile({ logins }), null, 2);
      const name = await tauriSettingsExport(json, settingsFileName());
      if (live.current && name) setSaved(name);
    } catch (e) {
      if (live.current) setProblem(said(e, ["too-big", "That's too big to save as a file."]) || "Couldn't save the file. Try a different folder.");
    }
    busy.current = false;
  };

  return (
    <div className="customize-row" data-setting="export-settings">
      <div>
        <h4 className="customize-row__title">Export Settings</h4>
        <p className="settings__section-note settings__section-note--dim">
          Saves your settings, without your sign-ins, to a file for another PC
          or a backup.
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={logins}
            onChange={(e) => setLogins(e.target.checked)}
          />
          <span>Include Playlists and AIOStreams</span>
        </label>
        <p className="settings__section-note settings__section-note--dim mt-2" data-export-logins>
          The file will hold your passwords, along with the favorites, recents,
          guide fixes and multi-view grid that go with those playlists.
        </p>
        {saved && (
          <p className="settings-said" role="status">
            Saved as {saved}
          </p>
        )}
        {problem && (
          <p className="settings-said settings-said--error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {files === "yes" ? (
        <Button variant="secondary" type="button" className="settings-button" onClick={() => void run()}>
          Export…
        </Button>
      ) : (
        <Off files={files}>Export…</Off>
      )}
    </div>
  );
}

function ImportRow({ files }: { files: Files }) {
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = async () => {
    if (busy.current) return;
    setProblem(null);
    // The window reloads once the settings are in, and a reload ends a stream.
    // Install and Restart now wait the same way (UpdatesSection).
    if (isPlaying()) {
      setProblem(`${finishFirst()} Importing restarts the window.`);
      return;
    }
    busy.current = true;
    try {
      let text: string | null;
      try {
        text = await tauriSettingsImport();
      } catch (e) {
        if (live.current)
          setProblem(
            said(e, ["too-big", "That file is too big to be a settings file."], ["not-text", NOT_A_SETTINGS_FILE]) ||
              "Couldn't read that file. Choose another one.",
          );
        return;
      }
      // They closed the dialog: nothing to do and nothing to say.
      if (text === null) return;
      const got = applySettingsFile(text);
      if (!got.ok) {
        if (live.current) setProblem(got.reason);
        return;
      }
      window.location.reload();
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="customize-row" data-setting="import-settings">
      <div>
        <h4 className="customize-row__title">Import Settings</h4>
        <p className="settings__section-note settings__section-note--dim">
          Replaces your settings with the ones in an exported file, playlists
          included if it has them. Your sign-ins stay, and the window restarts.
        </p>
        {problem && (
          <p className="settings-said settings-said--error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {files === "yes" ? (
        <ConfirmButton label="Import…" confirmLabel="Click Again to Replace" onConfirm={() => void run()} />
      ) : (
        <Off files={files}>Import…</Off>
      )}
    </div>
  );
}
