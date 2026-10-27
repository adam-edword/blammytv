import { load, save } from "../../lib/storage";

/**
 * Whether the reminder shows before a recording of the player's own buffer
 * (plan 029, D3), which is what Record does on a line that allows one stream.
 * On until the dialog's "Don't Show Again" is ticked. The way back is Settings
 * → Playback → Recordings Folder's "Show Recording Warning Again", drawn only
 * while it is off.
 */
const KEY = "recordingWarning";

export function loadRecordingWarning(): boolean {
  return load<unknown>(KEY, 1, true) !== false;
}

export function saveRecordingWarning(on: boolean): void {
  save(KEY, 1, on);
}
