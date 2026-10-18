import { useEffect, useReducer } from "react";
import { onPlaylistsChange } from "../settings/playlists";
import { XT_CHANGED } from "./store";
import { XT_LOADED } from "./vod";

/** Draw again when anything a library's screens show may have moved: a pick or
 * the switch, the lists being read, a playlist or the adult filter changing.
 * The three views that pick folders (Collections.tsx, RowsDrawer.tsx,
 * RowsEditor.tsx) and the playlist's library in Settings
 * (settings/PlaylistLibrary.tsx) read it. */
export function useXtRefresh(): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(XT_CHANGED, bump);
    window.addEventListener(XT_LOADED, bump);
    const off = onPlaylistsChange(bump);
    return () => {
      window.removeEventListener(XT_CHANGED, bump);
      window.removeEventListener(XT_LOADED, bump);
      off();
    };
  }, []);
}
