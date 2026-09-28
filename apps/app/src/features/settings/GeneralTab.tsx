import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { remove as removeStored } from "../../lib/storage";
import { Segmented } from "../../ui/Segmented";
import { UpdatesSection } from "./UpdatesSection";
import { MalSection } from "./MalSection";
import { TraktSection } from "./TraktSection";
import { signOutOfMal } from "../mal/account";
import { signOutOfTrakt } from "../trakt/account";
import { PlaylistsTab } from "./PlaylistsTab";
import { AioStreamsTab } from "./AioStreamsTab";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";
import { diskClear } from "../live/diskCache";
import { requestOnboardingReplay } from "../../app/onboardingGate";
import { EYEBROW } from "../../ui/eyebrow";

/**
 * General: where content comes from, and how the app is managed. Anything
 * that belongs to ONE side of the app (how Stream looks, how it plays)
 * lives under Customize with the rest of that world; what is left here is
 * the connection itself and app-level management, Danger Zone last as in
 * every tab.
 *
 * Sources absorbed what used to be its own Media tab. Connecting a playlist
 * or a manifest is a one-time setup, so it earns a section rather than a
 * third of the rail, and the Live TV / Stream split it needs is the same
 * split Customize uses one tab over: one mental model, two places.
 */
const SOURCE_TABS = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
] as const;

export function GeneralTab() {
  // Ephemeral: Sources always opens on Live TV rather than remembering
  // where you were, the same rule the old Media rail followed.
  const [source, setSource] = useState<"live" | "stream">("live");
  // Bumped by a clear: the source panes read their lists once, at mount,
  // and one left holding the old list wrote it all back at its next save.
  const [clears, setClears] = useState(0);

  // Clearing credentials is destructive, so it takes two clicks: arm, then
  // confirm within a few seconds.
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimer = useRef(0);
  // Closing Settings while armed would otherwise fire setState on an
  // unmounted component when the 4s timer elapses.
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  const clearLogins = () => {
    if (!clearArmed) {
      setClearArmed(true);
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    window.clearTimeout(clearTimer.current);
    setClearArmed(false);
    savePlaylists([]);
    saveAioUrl("");
    saveHeroSources([]);
    // The catalog mirror embeds the manifest URL (a credential) in its
    // key — an explicit credential clear must take it too.
    removeStored("vodCache");
    // The guide's copy on disk, the same way (Xtream credentials in its key
    // and in every stream URL).
    void diskClear();
    // And the Trakt and MyAnimeList sign-ins (plans 015, 021), which are
    // logins like the others.
    void signOutOfTrakt();
    void signOutOfMal();
    setClears((n) => n + 1);
  };

  return (
    <>
      {/* Where content comes from. The two source screens are unchanged;
        * they just sit behind a pill here instead of behind a tab. */}
      <h3 className={`settings__group ${EYEBROW}`}>Sources</h3>
      <div className="customize-rail">
        <Segmented role="tabs" label="Sources" options={SOURCE_TABS} value={source} onChange={setSource} />
      </div>
      {source === "live" ? <PlaylistsTab key={clears} /> : <AioStreamsTab key={clears} />}

      {/* Accounts elsewhere that follow what you watch (plans 015, 021). */}
      <h3 className={`settings__group ${EYEBROW}`}>Accounts</h3>
      <section className="settings-section">
        <TraktSection />
        <MalSection />
      </section>

      {/* Same shape as Customize: a group heading, then ONE section holding
        * every setting in it as a row. */}
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
        <div className="danger-zone">
          <h3 className="danger-zone__title">Danger Zone</h3>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Clear All Login Info</h4>
              <p className="settings__section-note settings__section-note--dim">
                Removes every playlist, your AIOStreams manifest and your Trakt
                and MyAnimeList sign-ins from this device.
              </p>
            </div>
            <Button
              variant="destructive"
              type="button"
              // Armed is a RING now, not a deeper fill. The old
              // `.btn-danger--armed` mixed 45% danger into the face, which
              // only read as a state because the unarmed face was a 16%
              // tint; `destructive` is a solid red, so there is no "more
              // red" left to go to. A ring is shadcn's own emphasis
              // primitive and it is the same halo the focus treatment uses.
              // (It also could not have stayed in CSS: the variant paints
              // the fill with a utility, and utilities outrank the app
              // layer.) The label still carries the state in words.
              className={clearArmed ? "ring-[3px] ring-destructive/50" : undefined}
              onClick={clearLogins}
            >
              {clearArmed ? "Click again to confirm" : "Clear…"}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
