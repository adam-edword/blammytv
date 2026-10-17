import { Button } from "../../components/ui/button";
import { remove as removeStored } from "../../lib/storage";
import { EYEBROW } from "../../ui/eyebrow";
import { UpdatesSection } from "./UpdatesSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { AboutSection } from "./AboutSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { SettingsFilesSection } from "./SettingsFilesSection";
import { signOutOfAio } from "../aiojf/account";
import { signOutOfJf } from "../jellyfin/account";
import { signOutOfMal } from "../mal/account";
import { signOutOfTrakt } from "../trakt/account";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";
import { diskClear } from "../live/diskCache";
import { forgetXtLists } from "../xtvod/vod";
import { requestOnboardingReplay } from "../../app/onboardingGate";
import { ConfirmButton } from "./ConfirmButton";

/**
 * App: the app itself. Updates (with What's new), Keyboard Shortcuts, About and
 * Replay Onboarding; then Privacy and data, which is Copy Diagnostics (plan
 * 025, P4b) and Export and Import Settings (P4c), and the one destructive
 * action left in Settings, last on the page.
 *
 * Clear All Login Info was in a red "Danger Zone" box at the foot of General,
 * and Reset Appearance in another at the foot of Customize. The pages took
 * the boxes down: each is a row at the bottom of the page whose things it
 * clears, behind the same two-press button (ConfirmButton).
 */
export function AppPage() {
  const clearLogins = () => {
    savePlaylists([]);
    saveAioUrl("");
    saveHeroSources([]);
    // The catalog mirror embeds the manifest URL (a credential) in its
    // key, so an explicit credential clear must take it too.
    removeStored("vodCache");
    // The guide's copy on disk, the same way (Xtream credentials in its key
    // and in every stream URL).
    void diskClear();
    // And each playlist's movie and show lists (plan 028), kept under their
    // account's server, user name and password.
    void forgetXtLists();
    // And the Trakt, MyAnimeList and AIOStreams sign-ins (plans 015, 021,
    // 024), which are logins like the others. Clearing the manifest URL above
    // signs out of nothing, so the AIOStreams one goes here.
    void signOutOfTrakt();
    void signOutOfMal();
    void signOutOfAio();
    // And the Jellyfin server's (plan 027): the app's own session there, also a
    // login, ended on the server too.
    void signOutOfJf();
    // Nothing to tell the Sources and Accounts pages: they are not mounted
    // while this one is, and read their lists afresh when you go back.
  };

  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>App</h3>
      <section className="settings-section">
        <UpdatesSection />
        <ShortcutsSection />
        <AboutSection />

        <div className="customize-row" data-setting="replay-onboarding">
          <div>
            <h4 className="customize-row__title">Replay Setup</h4>
            <p className="settings__section-note settings__section-note--dim">
              Your settings stay as they are.
            </p>
          </div>
          <Button
            variant="secondary"
            type="button"
            onClick={requestOnboardingReplay}
          >
            Replay
          </Button>
        </div>
      </section>

      <h3 className={`settings__group ${EYEBROW}`}>Privacy and Data</h3>
      <section className="settings-section">
        <DiagnosticsSection />
        <SettingsFilesSection />
      </section>

      <section className="settings-section">
        <div className="customize-row" data-setting="clear-logins">
          <div>
            <h4 className="customize-row__title">Clear All Login Info</h4>
            <p className="settings__section-note settings__section-note--dim">
              Removes every playlist, your AIOStreams manifest and your Trakt,
              MyAnimeList, AIOStreams and Jellyfin sign-ins from this device.
            </p>
          </div>
          <ConfirmButton label="Clear…" onConfirm={clearLogins} />
        </div>
      </section>
    </>
  );
}
