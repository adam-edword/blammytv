import { ChannelLogo } from "../../ui/ChannelLogo";
import { Toggle } from "../../ui/Toggle";
import { isLibraryOff, setLibraryOff, showsLibrary } from "../xtvod/store";
import { useXtRefresh } from "../xtvod/useXtRefresh";
import { xtLibraries } from "../xtvod/vod";
import { XtRowsEditor } from "../xtvod/RowsEditor";
import type { Playlist } from "./playlists";

/**
 * An Xtream playlist's movies and shows in Sources (plan 028): a panel of its
 * own in the Movies and Shows section, under the playlists and their guide's
 * refresh (Adam: the two read as one block when it hung off the playlist's
 * row). Its name, the switch that puts them in Stream and Discover (D1: on until
 * turned off), and its rows (direction C: Your Rows to drag into order, More
 * Folders to add), for a library that is on and loaded.
 *
 * Both are the library's own store (xtvod/store.ts), not the playlist: a save
 * of the playlist list reloads Live's channels, and a pick must not.
 */

export function PlaylistLibrary({ playlist: p }: { playlist: Playlist }) {
  useXtRefresh();
  if (!showsLibrary(p)) return null;
  const off = isLibraryOff(p.id);
  return (
    <div className="playlist-library" data-xtlib={p.id}>
      <div className="playlist-library__head" data-setting="playlist-library">
        <ChannelLogo name={p.name} size={34} className="playlist-row__logo" />
        <span className="playlist-library__name">{p.name}</span>
        <span className="playlist-library__label" aria-hidden="true">
          Show in Stream and Discover
        </span>
        <Toggle on={!off} onChange={(on) => setLibraryOff(p.id, !on)} label={`${p.name} movies and shows in Stream and Discover`} />
      </div>
      {!off && xtLibraries().some((l) => l.id === p.id) && (
        <div data-setting="playlist-library-folders">
          <XtRowsEditor playlistId={p.id} />
        </div>
      )}
    </div>
  );
}
