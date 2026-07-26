/**
 * Is something playing right now?
 *
 * Read from the DOM rather than from state, because the asker is usually
 * somewhere that has no path to the player's state: Settings is a portal
 * mounted at the body, playback lives inside StreamScreen or LiveScreen,
 * and threading a flag from there to here would mean lifting playback
 * state to App for one boolean.
 *
 * The two markers are the two stages: `.vod-stage` is VOD's, and
 * `#inv-chrome` is the live player's chrome host, which is appended to the
 * body only while a stream is mounted. App.tsx's Escape gate already reads
 * the first one the same way.
 */
export function isPlaying(): boolean {
  return (
    document.querySelector(".vod-stage") !== null ||
    document.getElementById("inv-chrome") !== null
  );
}
