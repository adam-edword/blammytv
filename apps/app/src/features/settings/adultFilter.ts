import { load, save } from "../../lib/storage";
import { emitPlaylistsChange } from "./playlists";

/** Adult-content visibility. Hidden by default: adult categories (panel
 * `is_adult` flag or the conservative name pattern in live/adult.ts) and
 * adult-flagged streams stay out of the Live tab entirely — folders,
 * channels, and EPG — riding the same drop path as hiddenCategories. */

const KEY = "showAdult";
const VERSION = 1;

export function loadShowAdult(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveShowAdult(show: boolean): void {
  save(KEY, VERSION, show);
  // The Live tab refreshes on the playlists-change signal; flipping this
  // filter changes the catalog the same way a playlist edit does.
  emitPlaylistsChange();
}
