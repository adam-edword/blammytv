import { tauriMpvPrefs } from "../../lib/tauri";
import {
  loadAudioChannels,
  loadSubtitleSize,
  mpvAudioChannels,
  onAudioChannelsChange,
  onSubtitleSizeChange,
  subScale,
} from "./playerPrefs";

/**
 * Audio Channels and Subtitle Size, to native (plan 025, P3b). mpv is the one
 * that applies them, and native holds them for the players it makes later, so
 * the frontend's part is to say what they are: once at launch, and again on
 * every change. Both values go every time, as one call.
 *
 * The same payload twice is one call. StrictMode runs the launch effect twice
 * in dev, and saving the choice already chosen changes nothing for mpv.
 *
 * A native build from before v0.11.29 has no such command, and the call
 * rejects. That is caught here and not shown to anyone: the settings still
 * save and the player runs as it did. The first time is logged for whoever
 * is looking, and a failed push is forgotten, so the next change tries again.
 */

let last = "";
let noted = false;

export function pushPlayerPrefs(): void {
  const audio = mpvAudioChannels(loadAudioChannels());
  const scale = subScale(loadSubtitleSize());
  const key = `${audio}|${scale}`;
  if (key === last) return;
  last = key;
  tauriMpvPrefs(audio, scale).catch((err) => {
    last = "";
    if (noted) return;
    noted = true;
    console.info("[prefs] native did not take the player settings:", String(err));
  });
}

/** Push now and on every change to either. Returns the way to stop. */
export function watchPlayerPrefs(): () => void {
  pushPlayerPrefs();
  const offs = [onAudioChannelsChange(pushPlayerPrefs), onSubtitleSizeChange(pushPlayerPrefs)];
  return () => offs.forEach((off) => off());
}

/** For tests: forget what was pushed and what was logged. */
export function resetPlayerPrefsSync(): void {
  last = "";
  noted = false;
}
