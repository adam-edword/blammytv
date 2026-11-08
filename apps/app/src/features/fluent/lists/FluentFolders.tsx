import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { RecordIcon, RecentsIcon, SearchIcon, StarIcon, TvIcon } from "../../../ui/icons";
import { splitTitleEmoji } from "../../live/emoji";
import type { useConnections } from "../../live/connections";
import type { Channel, LiveData } from "../../live/model";
import { useRecordings } from "../../recordings/store";

type Mode = "playlist" | "favorites" | "recents" | "recordings";

/** The folder menu's anchor, as LiveScreen's openFolderMenu takes it. */
export interface FolderMenuAt {
  x: number;
  y: number;
  groupId: string;
  folderId: string;
  name: string;
}

function FolderGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
      <path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.4 1.5h5c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1h-9.5c-.55 0-1-.45-1-1z" />
    </svg>
  );
}

/**
 * Fluent's Live TV folders: WinUI's list/details column (Mail's folder list).
 * A filter box, Favorites / Recents / Recordings / All Channels, then each
 * source as a caption header with its folders and their channel counts. It
 * drives LiveScreen's own mode and folder state, so nothing here owns a
 * selection.
 */
export function FluentFolders({
  groups,
  channels,
  conns,
  mode,
  folder,
  favorites,
  recents,
  onMode,
  onFolder,
  onFolderMenu,
}: {
  groups: LiveData["groups"];
  channels: readonly Channel[];
  conns: ReturnType<typeof useConnections>;
  mode: Mode;
  folder: string | null;
  favorites: number;
  recents: number;
  onMode: (m: Mode) => void;
  /** A folder, or null for All Channels. Lands on the playlist mode. */
  onFolder: (id: string | null) => void;
  onFolderMenu: (m: FolderMenuAt) => void;
}) {
  const [query, setQuery] = useState("");
  const recordings = useRecordings().length;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of channels) m.set(c.folderId, (m.get(c.folderId) ?? 0) + 1);
    return m;
  }, [channels]);
  const total = useMemo(
    () => groups.reduce((n, g) => n + g.folders.reduce((k, f) => k + (counts.get(f.id) ?? 0), 0), 0),
    [groups, counts],
  );
  const q = query.trim().toLowerCase();
  const hit = (name: string) => !q || name.toLowerCase().includes(q);

  const fixed: { key: string; label: string; icon: ReactNode; count: number; on: boolean; go: () => void }[] = [
    { key: "favorites", label: "Favorites", icon: <StarIcon size={16} />, count: favorites, on: mode === "favorites", go: () => onMode("favorites") },
    { key: "recents", label: "Recents", icon: <RecentsIcon size={16} />, count: recents, on: mode === "recents", go: () => onMode("recents") },
    { key: "recordings", label: "Recordings", icon: <RecordIcon size={16} className="fl-folders__rec" />, count: recordings, on: mode === "recordings", go: () => onMode("recordings") },
    { key: "all", label: "All Channels", icon: <TvIcon size={16} />, count: total, on: mode === "playlist" && folder === null, go: () => onFolder(null) },
  ];
  const shown = fixed.filter((f) => hit(f.label));

  const menu = (e: MouseEvent<HTMLElement>, groupId: string, folderId: string, name: string) => {
    e.preventDefault();
    // The keyboard's menu key sends 0,0: anchor on the row instead.
    const r = e.currentTarget.getBoundingClientRect();
    onFolderMenu({
      x: e.clientX || r.right - 8,
      y: e.clientY || r.top + r.height / 2,
      groupId,
      folderId,
      name,
    });
  };

  return (
    <div className="fl-folders">
      <label className="fl-filter">
        <input
          type="search"
          placeholder="Filter folders"
          aria-label="Filter folders"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SearchIcon size={14} className="fl-filter__icon" />
      </label>
      <nav className="fl-folders__list" aria-label="Folders">
        {shown.map((f) => (
          <button
            key={f.key}
            type="button"
            className="fl-nav"
            aria-current={f.on ? "true" : undefined}
            onClick={f.go}
          >
            <span className="fl-nav__glyph" aria-hidden>{f.icon}</span>
            <span className="fl-nav__name">{f.label}</span>
            <span className="fl-nav__count">{f.count}</span>
          </button>
        ))}
        {groups.map((g) => {
          const rows = g.folders
            .map((f) => ({ f, ...splitTitleEmoji(f.name) }))
            .filter((r) => hit(r.label));
          if (rows.length === 0 && !(g.error && !q)) return null;
          const c = conns.get(g.id);
          return (
            <section key={g.id} className="fl-folders__group" aria-label={g.name}>
              <h3 className="fl-caption">
                {g.name}
                {c && ` · ${c.active} of ${c.max} ${c.max === 1 ? "stream" : "streams"}`}
              </h3>
              {g.error && <p className="fl-folders__error">Couldn&rsquo;t Load This Playlist: {g.error}</p>}
              {rows.map(({ f, emoji, label }) => {
                const on = mode === "playlist" && folder === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className="fl-nav"
                    aria-label={label}
                    aria-current={on ? "true" : undefined}
                    onClick={() => onFolder(f.id)}
                    onContextMenu={(e) => menu(e, g.id, f.id, label)}
                  >
                    <span className="fl-nav__glyph" aria-hidden>{emoji || <FolderGlyph />}</span>
                    <span className="fl-nav__name">{label}</span>
                    <span className="fl-nav__count">{counts.get(f.id) ?? 0}</span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </nav>
    </div>
  );
}
