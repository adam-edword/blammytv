import { runningNow } from "../features/recordings/store";
import { isLivePopout } from "./tauri";

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
 *
 * And multi-view's grid, whose tiles play in video elements of their own:
 * a restart from Settings over it tore every tile down (the app shell
 * audit). A grid with a tile in it counts; an empty one doesn't.
 *
 * And a LIVE pop-out, the one case with nothing in the DOM: popping a
 * channel out unmounts the in-app player and its chrome host, so Restart
 * now and Install passed this guard and ended the PiP. It is the one
 * thing here read from state, `livePopout` in lib/tauri.ts. A VOD pop-out
 * needs no flag: StreamScreen keeps `.vod-stage--popped` mounted for it.
 *
 * And a recording (plan 029), the other thing a restart ends: one that runs
 * in Rust with no player open is held too. It is also read from state, the
 * recordings store's. A caller that draws it re-renders on a recording
 * starting or ending with `useRecordingRunning`.
 */
function watching(): boolean {
  return (
    document.querySelector(".vod-stage") !== null ||
    document.getElementById("inv-chrome") !== null ||
    document.querySelector(".mvtab .mvtile:not(.mvtile--empty)") !== null ||
    isLivePopout()
  );
}

export function isPlaying(): boolean {
  return watching() || runningNow();
}

/**
 * What to finish before an install or a restart, as the first sentence of
 * its hint ("Finish watching first."), or null when nothing is in the way.
 * Says what is actually holding it: a recording is stopped, not watched.
 */
export function finishFirst(): string | null {
  const w = watching();
  const r = runningNow();
  if (w && r) return "Finish watching and stop recording first.";
  if (r) return "Stop recording first.";
  return w ? "Finish watching first." : null;
}
