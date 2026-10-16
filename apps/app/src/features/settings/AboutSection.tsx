import { useEffect, useState } from "react";
import { APP_VERSION } from "../../lib/version";
import { isTauri, openExternal, tauriAboutVersions } from "../../lib/tauri";
import { Button } from "../../components/ui/button";
import { aboutRows, type AboutRow } from "./aboutRows";

/**
 * Settings → App → About (plan 025, P4a): what this install is made of, for
 * when you ask for help. The app's own version is always here, because the page
 * knows it. The rest is native's, asked as the page opens and drawn as the
 * answer lands (`about_versions`: the native build, mpv, the FFmpeg inside it,
 * the ffmpeg multi-view converts with, and which Vulkan loader the player
 * uses).
 *
 * A row native could not fill is not drawn, and an older native with no such
 * command draws none of them: no error text either way. Version strings only;
 * native sends no path, URL or name.
 *
 * Under the rows, where the GPL's notice goes: mpv and FFmpeg ship in the
 * installer, so the app says what they are and where their source is. The
 * same notice and the license text are installed beside them (licenses/).
 */
const LICENSES_URL =
  "https://github.com/adam-edword/blammytv/blob/main/apps/app/src-tauri/licenses/THIRD-PARTY-NOTICES.txt";

export function AboutSection() {
  const [rows, setRows] = useState<AboutRow[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    tauriAboutVersions().then(
      (answer) => {
        if (live) setRows(aboutRows(answer));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="customize-stack" data-setting="about">
      <div>
        <h4 className="customize-row__title">About</h4>
        <p className="settings__section-note settings__section-note--dim">
          Send these when you ask for help.
        </p>
      </div>
      <dl className="about">
        <div className="about__row">
          <dt>App</dt>
          <dd>{APP_VERSION}</dd>
        </div>
        {rows.map((r) => (
          <div className="about__row" key={r.key} data-about={r.key}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="settings__section-note settings__section-note--dim" data-about-licenses>
        mpv and FFmpeg are free software under the GNU GPL.{" "}
        <Button
          variant="link"
          size="sm"
          type="button"
          className="h-auto p-0 text-muted-foreground"
          onClick={() => openExternal(LICENSES_URL)}
        >
          Their licenses and source
        </Button>
      </p>
    </div>
  );
}
