import { Toggle } from "../../ui/Toggle";
import { isLibraryOff, loadHeld, setLibraryOff } from "../xtvod/store";
import { useXtRefresh } from "../xtvod/useXtRefresh";
import { xtLibraries } from "../xtvod/vod";
import { XtPicker } from "../xtvod/XtPicker";
import type { Playlist } from "./playlists";

/**
 * An Xtream playlist's movies and shows, under its row in Sources (plan 028):
 * the switch that puts them in Stream and Discover (D1: on until turned off),
 * and the folder picker Stream shows, for a library that is on and loaded.
 *
 * Drawn for an Xtream playlist whose last good load held a movie or a show, and
 * for one that is switched off (it has to be able to come back on). Not for a
 * playlist that was read and holds nothing (live TV only), and not for an M3U
 * or a Stalker portal.
 *
 * Both are the library's own store (xtvod/store.ts), not the playlist: a save
 * of the playlist list reloads Live's channels, and a pick must not.
 */
export function PlaylistLibrary({ playlist: p }: { playlist: Playlist }) {
  useXtRefresh();
  if (p.kind !== "xtream") return null;
  const off = isLibraryOff(p.id);
  const held = loadHeld(p.id);
  if (!off && !(held && held.movies + held.shows > 0)) return null;
  return (
    <div className="playlist-library">
      <div className="customize-row" data-setting="playlist-library">
        <h4 className="customize-row__title">Movies and Shows in Stream and Discover</h4>
        <Toggle on={!off} onChange={(on) => setLibraryOff(p.id, !on)} label={`${p.name} movies and shows in Stream and Discover`} />
      </div>
      {!off && xtLibraries().some((l) => l.id === p.id) && (
        <div data-setting="playlist-library-folders">
          {/* The picker itself, always: Stream's slot folds it into a button once
            * something is picked, and here it is the thing you came for. */}
          <XtPicker playlistId={p.id} />
        </div>
      )}
    </div>
  );
}
