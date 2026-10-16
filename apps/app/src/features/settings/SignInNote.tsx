import { Button } from "../../components/ui/button";

/**
 * The note a page shows in place of its Stream rows when there is no source to
 * govern: Playback and Appearance both gate theirs on an AIOStreams or a
 * Jellyfin, and both say the same thing. Sign-in is the default since plan 024,
 * so it names the sign-in, not a manifest. The button goes to Sources (on its
 * Stream pill) instead of describing the way there: SettingsModal owns the
 * page, so it hands the move down.
 */
export function SignInNote({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="settings-section">
      <p className="settings__section-note settings__section-note--dim">
        Sign in to AIOStreams or Jellyfin to see these settings.
      </p>
      <Button variant="secondary" type="button" onClick={onSignIn}>
        Go to Sources
      </Button>
    </section>
  );
}
