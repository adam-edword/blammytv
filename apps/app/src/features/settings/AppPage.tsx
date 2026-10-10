import { Button } from "../../components/ui/button";
import { remove as removeStored } from "../../lib/storage";
import { EYEBROW } from "../../ui/eyebrow";
import { UpdatesSection } from "./UpdatesSection";
import { signOutOfAio } from "../aiojf/account";
import { signOutOfMal } from "../mal/account";
import { signOutOfTrakt } from "../trakt/account";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";
import { diskClear } from "../live/diskCache";
import { requestOnboardingReplay } from "../../app/onboardingGate";
import { ConfirmButton } from "./ConfirmButton";

/**
 * App: the app itself. Updates, Replay Onboarding, and the one destructive
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
    // And the Trakt, MyAnimeList and AIOStreams sign-ins (plans 015, 021,
    // 024), which are logins like the others. Clearing the manifest URL above
    // signs out of nothing, so the AIOStreams one goes here.
    void signOutOfTrakt();
    void signOutOfMal();
    void signOutOfAio();
    // Nothing to tell the Sources and Accounts pages: they are not mounted
    // while this one is, and read their lists afresh when you go back.
  };

  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>App</h3>
      <section className="settings-section">
        <UpdatesSection />

        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Replay Onboarding</h4>
            <p className="settings__section-note settings__section-note--dim">
              Walk through the welcome setup again. Nothing gets reset.
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

      <section className="settings-section">
        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Clear All Login Info</h4>
            <p className="settings__section-note settings__section-note--dim">
              Removes every playlist, your AIOStreams manifest and your Trakt,
              MyAnimeList and AIOStreams sign-ins from this device.
            </p>
          </div>
          <ConfirmButton label="Clear…" onConfirm={clearLogins} />
        </div>
      </section>
    </>
  );
}
