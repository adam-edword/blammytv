import { load, save } from "../../lib/storage";

/**
 * The two reminders before a recording (plan 029). Each is on until its
 * dialog's "Don't Show Again" is ticked, and each has a flag of its own:
 *
 * - the buffer reminder (D3), before Record reads the player's own buffer,
 *   which is what it does on a line that allows one stream;
 * - the connection reminder (D5), before Record opens a stream of its own,
 *   on any other line.
 *
 * The way back for both is Settings → Playback → Recordings Folder's "Show
 * Recording Warnings Again", drawn while either is off.
 */
const KEY = "recordingWarning";
const NOTICE_KEY = "recordingNotice";

export function loadRecordingWarning(): boolean {
  return load<unknown>(KEY, 1, true) !== false;
}

export function saveRecordingWarning(on: boolean): void {
  save(KEY, 1, on);
}

export function loadRecordingNotice(): boolean {
  return load<unknown>(NOTICE_KEY, 1, true) !== false;
}

export function saveRecordingNotice(on: boolean): void {
  save(NOTICE_KEY, 1, on);
}

/** Both reminders are on. */
export function recordingWarningsOn(): boolean {
  return loadRecordingWarning() && loadRecordingNotice();
}

/** Settings' "Show Recording Warnings Again": both back on. */
export function showRecordingWarningsAgain(): void {
  saveRecordingWarning(true);
  saveRecordingNotice(true);
}
