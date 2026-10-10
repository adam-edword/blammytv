/**
 * The note a page shows in place of its Stream rows when there is no
 * AIOStreams to govern: Playback and Appearance both gate theirs on one, and
 * both say the same thing. Sign-in is the default since plan 024, so it
 * names the sign-in, as Stream's own empty state does ("Sign in to your
 * AIOStreams in Settings → Sources → Stream"), not a manifest.
 */
export function SignInNote() {
  return (
    <section className="settings-section">
      <p className="settings__section-note settings__section-note--dim">
        Sign in to your AIOStreams in Settings &rarr; Sources &rarr; Stream and
        these appear.
      </p>
    </section>
  );
}
