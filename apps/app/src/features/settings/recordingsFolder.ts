import { load, save } from "../../lib/storage";

/**
 * Settings → Playback → Recordings Folder (plan 029): where new recordings
 * go. Empty is the default, which native owns (`Videos\BlammyTV`, asked of
 * it as `rec_default_folder`), so a later build can move the default for
 * everyone who never picked. Every `rec_start` carries the folder; a
 * recording already made stays where it was made.
 *
 * Not in the settings file: it is a path on this PC, and on another a folder
 * that is not there fails the first recording.
 */
const KEY = "recordingsFolder";

export function loadRecordingsFolder(): string {
  const v = load<unknown>(KEY, 1, "");
  return typeof v === "string" ? v : "";
}

export function saveRecordingsFolder(path: string): void {
  save(KEY, 1, path);
}
