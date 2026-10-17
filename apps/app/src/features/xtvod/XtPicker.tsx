import { useEffect, useReducer, useState } from "react";
import { Button } from "../../components/ui/button";
import { onPlaylistsChange } from "../settings/playlists";
import type { XtKind } from "./keys";
import { loadPicks, togglePick, XT_CHANGED } from "./store";
import { XT_LOADED, xtLibraries, type XtLibraryView } from "./vod";

/**
 * Which of a provider's folders are rows in Stream (plan 028, D2). Every folder
 * is off to start, so on an Xtream-only Stream page this IS the page: the
 * folders right there, and a click adds the row on the spot. Settings draws the
 * same component beside the playlist (a library's switch is there).
 *
 * The folders are chips that pick and unpick, the way Card Details' are
 * (Settings → Appearance): quiet when off, a filled surface when on. Movies and
 * shows are two groups because they are two lists of folders: both can have an
 * "Action", and the ids can even be the same.
 */

/** Draw again when anything the picker shows may have moved: a pick or the
 * switch, the lists being read, a playlist or the adult filter changing. */
function useXtRefresh(): void {
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

/** What to call the heading and the button that opens it: with more than one
 * library it has to say which. */
const choose = (lib: XtLibraryView, several: boolean) => (several ? `Choose Folders from ${lib.name}` : "Choose Folders");

const GROUPS: { kind: XtKind; label: string; of: (lib: XtLibraryView) => XtLibraryView["movieFolders"] }[] = [
  { kind: "movie", label: "Movies", of: (lib) => lib.movieFolders },
  { kind: "series", label: "Shows", of: (lib) => lib.showFolders },
];

export function XtPicker({
  playlistId,
  onPicked,
  onDone,
}: {
  playlistId: string;
  /** Called as a folder is picked or unpicked, before the pick is written. */
  onPicked?: () => void;
  /** Gives the picker a button that closes it. */
  onDone?: () => void;
}) {
  useXtRefresh();
  const all = xtLibraries();
  const lib = all.find((l) => l.id === playlistId);
  if (!lib) return null;
  const groups = GROUPS.map((g) => ({ ...g, folders: g.of(lib) })).filter((g) => g.folders.length > 0);
  return (
    <section className="xtpick" data-xtpick={lib.id}>
      <h3 className="media-row__title">{choose(lib, all.length > 1)}</h3>
      <p className="xtpick__note">
        {groups.length > 0 ? "Each folder you pick becomes a row on Stream." : "This playlist has no folders to choose from."}
      </p>
      {groups.map((g) => {
        const on = new Set(loadPicks(lib.id, g.kind));
        return (
          <div key={g.kind} className="xtpick__group" role="group" aria-label={g.label}>
            <h4 className="xtpick__label">{g.label}</h4>
            <div className="meta-pick">
              {g.folders.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  // The chip's look is its variant, chosen from the boolean that
                  // sets aria-pressed (Settings → Appearance does the same).
                  variant={on.has(f.id) ? "secondary" : "ghost"}
                  className={on.has(f.id) ? "" : "hover:bg-muted"}
                  aria-pressed={on.has(f.id)}
                  onClick={() => {
                    onPicked?.();
                    togglePick(lib.id, g.kind, f.id);
                  }}
                >
                  {f.name}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
      {onDone && (
        <div className="xtpick__acts">
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>
            Done
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * A library's end of the Stream page. The picker itself while nothing is picked,
 * and it stays once the person starts (picking the first folder must not take
 * the picker away from under the pointer) until Done. After that, and for a
 * library that already has picks, a quiet button opens it again.
 */
export function XtPickerSlot({ playlistId }: { playlistId: string }) {
  useXtRefresh();
  const [mode, setMode] = useState<"auto" | "open" | "closed">("auto");
  const all = xtLibraries();
  const lib = all.find((l) => l.id === playlistId);
  if (!lib) return null;
  const none = loadPicks(lib.id, "movie").length + loadPicks(lib.id, "series").length === 0;
  if (mode === "open" || (mode === "auto" && none))
    return <XtPicker playlistId={lib.id} onPicked={() => setMode("open")} onDone={() => setMode("closed")} />;
  return (
    <div className="xtpick__reopen">
      <Button type="button" size="sm" variant="ghost" onClick={() => setMode("open")}>
        {choose(lib, all.length > 1)}
      </Button>
    </div>
  );
}
