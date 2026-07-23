import { useEffect, useId, useRef, useState } from "react";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import { ChevronIcon, CloseIcon } from "../../ui/icons";
import { fetchLiveCategories, type XtreamCategory } from "../../data/xtream";
import {
  EMPTY_PLAYLIST_FORM as EMPTY_FORM,
  KIND_LABELS,
  KIND_TABS,
  addPlaylist,
  draftFrom,
  isFormComplete as isComplete,
  loadPlaylists,
  playlistSource,
  removePlaylist,
  savePlaylists,
  setHiddenCategories,
  togglePlaylist,
  type Playlist,
  type PlaylistFormState,
  type PlaylistKind,
} from "./playlists";
import { loadShowAdult, saveShowAdult } from "./adultFilter";
import { isAdultCategory } from "../live/adult";
import { onLiveRefreshed, peekLive } from "../live/source";

type Categories =
  | { status: "loading" }
  | { status: "ready"; items: XtreamCategory[] }
  | { status: "error" };

// KIND_TABS + the form model live in playlists.ts — shared with onboarding.

const DESCRIPTIONS: Record<PlaylistKind, string> = {
  xtream:
    "Connect an Xtream Codes account — the server URL, username, and password from your provider.",
  m3u: "Point at an M3U playlist URL from your provider. EPG data comes along when the playlist links it.",
  stalker:
    "Connect a Stalker/MAG portal — the portal URL and the MAC address your provider registered.",
};

export function PlaylistsTab() {
  const [kind, setKind] = useState<PlaylistKind>("xtream");
  const [form, setForm] = useState<PlaylistFormState>(EMPTY_FORM);
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists);
  const [showAdult, setShowAdult] = useState<boolean>(loadShowAdult);
  // Per-playlist load/guide status off the last catalog load — this is how
  // an installed user (no console) reads WHY the guide is empty. Re-read
  // when a background refresh lands.
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => onLiveRefreshed(() => setLiveTick((t) => t + 1)), []);
  void liveTick;
  const liveGroups = peekLive()?.groups ?? [];

  // Per-playlist folder editor: which row is expanded, and each row's
  // fetched category list (kept per id so re-expanding is instant).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Deleting a playlist takes stored credentials + folder curation with it —
  // same destructive class as Customize's "Clear All Login Info", so it
  // speaks the same two-click arm/confirm language (4s to change your mind).
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const armTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  const [categories, setCategories] = useState<Record<string, Categories>>({});

  const update = (list: Playlist[]) => {
    setPlaylists(list);
    savePlaylists(list);
  };

  const expand = (p: Playlist) => {
    if (expandedId === p.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.id);
    // Only Xtream has a category API wired today.
    if (p.kind !== "xtream" || categories[p.id]?.status === "ready") return;
    setCategories((c) => ({ ...c, [p.id]: { status: "loading" } }));
    fetchLiveCategories(p)
      .then((items) =>
        setCategories((c) => ({ ...c, [p.id]: { status: "ready", items } })),
      )
      .catch(() =>
        setCategories((c) => ({ ...c, [p.id]: { status: "error" } })),
      );
  };

  const set = (field: keyof PlaylistFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const add = () => {
    if (!isComplete(kind, form)) return;
    update(addPlaylist(playlists, draftFrom(kind, form)));
    setForm(EMPTY_FORM);
  };

  return (
    <>
      <section className="settings-section">
        <ChipTabs tabs={KIND_TABS} active={kind} onChange={setKind} />
        <h3 className="settings__section-title">
          Add {KIND_LABELS[kind]} Playlist
        </h3>
        <p className="settings__section-note">{DESCRIPTIONS[kind]}</p>

        <div className="settings-form">
          {kind === "xtream" && (
            <>
              <div className="settings-form__row">
                <Field
                  label="Name (optional)"
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Living Room IPTV"
                />
                <Field
                  label="Server URL"
                  value={form.server}
                  onChange={set("server")}
                  placeholder="http://tv.example.com:8080"
                />
              </div>
              <div className="settings-form__row">
                <Field
                  label="Username"
                  value={form.username}
                  onChange={set("username")}
                  placeholder="user123"
                />
                <Field
                  label="Password"
                  value={form.password}
                  onChange={set("password")}
                  placeholder="••••••••"
                  type="password"
                />
              </div>
            </>
          )}
          {kind === "m3u" && (
            <div className="settings-form__row">
              <Field
                label="Name (optional)"
                value={form.name}
                onChange={set("name")}
                placeholder="Living Room IPTV"
              />
              <Field
                label="Playlist URL"
                value={form.url}
                onChange={set("url")}
                placeholder="https://example.com/playlist.m3u8"
              />
            </div>
          )}
          {kind === "stalker" && (
            <>
              <div className="settings-form__row">
                <Field
                  label="Name (optional)"
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Living Room IPTV"
                />
                <Field
                  label="Portal URL"
                  value={form.portal}
                  onChange={set("portal")}
                  placeholder="http://portal.example.com/c/"
                />
              </div>
              <div className="settings-form__row">
                <Field
                  label="MAC address"
                  value={form.mac}
                  onChange={set("mac")}
                  placeholder="00:1A:79:12:34:56"
                />
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={!isComplete(kind, form)}
          onClick={add}
        >
          Add Playlist
        </button>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__list-title">Your Playlists</h3>
        {playlists.length === 0 ? (
          <p className="settings__section-note settings__section-note--dim">
            Nothing here yet — add your first playlist above.
          </p>
        ) : (
          playlists.map((p) => (
            <div key={p.id} className="playlist-item">
              <div className="playlist-row">
                <div className="playlist-row__text">
                  <span className="playlist-row__name">{p.name}</span>
                  <span className="playlist-row__source">
                    {playlistSource(p)}
                  </span>
                  {(() => {
                    const g = liveGroups.find((x) => x.id === p.id);
                    if (g?.error)
                      return (
                        <span className="playlist-row__status playlist-row__status--error">
                          Couldn&rsquo;t load — {g.error}
                        </span>
                      );
                    if (g?.epgError)
                      return (
                        <span className="playlist-row__status">
                          Channels OK · guide: {g.epgError}
                        </span>
                      );
                    return null;
                  })()}
                </div>
                <div className="playlist-row__actions">
                  <Toggle
                    on={p.enabled}
                    onChange={() => update(togglePlaylist(playlists, p.id))}
                    label={`${p.name} enabled`}
                  />
                  <button
                    type="button"
                    className={
                      "playlist-row__expand" +
                      (expandedId === p.id ? " playlist-row__expand--open" : "")
                    }
                    aria-label={`Edit ${p.name} folders`}
                    aria-expanded={expandedId === p.id}
                    onClick={() => expand(p)}
                  >
                    <ChevronIcon />
                  </button>
                  <button
                    type="button"
                    className={
                      "playlist-row__delete" +
                      (armedDeleteId === p.id
                        ? " playlist-row__delete--armed"
                        : "")
                    }
                    aria-label={
                      armedDeleteId === p.id
                        ? `Click again to remove ${p.name}`
                        : `Delete ${p.name}`
                    }
                    title={
                      armedDeleteId === p.id
                        ? "Click again to remove"
                        : undefined
                    }
                    onClick={() => {
                      if (armedDeleteId !== p.id) {
                        setArmedDeleteId(p.id);
                        window.clearTimeout(armTimer.current);
                        armTimer.current = window.setTimeout(
                          () => setArmedDeleteId(null),
                          4000,
                        );
                        return;
                      }
                      window.clearTimeout(armTimer.current);
                      setArmedDeleteId(null);
                      update(removePlaylist(playlists, p.id));
                    }}
                  >
                    {armedDeleteId === p.id ? "Sure?" : <CloseIcon />}
                  </button>
                </div>
              </div>
              {expandedId === p.id && (
                <FolderEditor
                  playlist={p}
                  categories={categories[p.id]}
                  showAdult={showAdult}
                  onSave={(hiddenIds) =>
                    update(setHiddenCategories(playlists, p.id, hiddenIds))
                  }
                />
              )}
            </div>
          ))
        )}
      </section>

      <section className="settings-section">
        <h3 className="settings-section__list-title">Content</h3>
        <div className="playlist-item">
          <div className="playlist-row">
            <div className="playlist-row__text">
              <span className="playlist-row__name">Show adult content</span>
              <span className="playlist-row__source">
                Off keeps adult folders and channels out of Live TV — flagged
                by your provider, or caught by name.
              </span>
            </div>
            <div className="playlist-row__actions">
              <Toggle
                on={showAdult}
                onChange={() => {
                  const next = !showAdult;
                  setShowAdult(next);
                  saveShowAdult(next);
                }}
                label="Show adult content"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** The expanded folder list under a playlist row: every category from the
 * provider with a visibility toggle — off keeps it out of the Live sidebar.
 * Edits are STAGED: toggles (and toggle-all) mutate a local draft, and the
 * Save/Discard bar appears once it diverges from what's persisted. Nothing
 * touches storage (or the Live sidebar) until Save. Collapsing the editor
 * or closing Settings discards an unsaved draft. */
function FolderEditor({
  playlist,
  categories,
  showAdult,
  onSave,
}: {
  playlist: Playlist;
  categories: Categories | undefined;
  showAdult: boolean;
  onSave: (hiddenIds: string[]) => void;
}) {
  // Before the early returns — hooks must run on every render. The draft
  // seeds from the FULL persisted hidden set, so ids the adult filter keeps
  // out of view survive a save untouched.
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<ReadonlySet<string>>(
    () => new Set(playlist.hiddenCategories ?? []),
  );
  if (playlist.kind !== "xtream") {
    return (
      <div className="source-list source-list--note">
        <p className="settings__section-note settings__section-note--dim">
          Folder editing for {KIND_LABELS[playlist.kind]} playlists arrives
          with its live-TV client.
        </p>
      </div>
    );
  }
  if (!categories || categories.status === "loading") {
    return (
      <div className="source-list source-list--note">
        <p className="settings__section-note settings__section-note--dim">
          Loading folders…
        </p>
      </div>
    );
  }
  if (categories.status === "error") {
    return (
      <div className="source-list source-list--note">
        <p className="settings__section-note settings__section-note--dim">
          Couldn&rsquo;t reach the server. Check the playlist&rsquo;s credentials — and
          note the browser dev build can be blocked by CORS where the desktop
          app isn't.
        </p>
      </div>
    );
  }
  if (categories.items.length === 0) {
    return (
      <div className="source-list source-list--note">
        <p className="settings__section-note settings__section-note--dim">
          The server reports no live categories.
        </p>
      </div>
    );
  }
  // With the adult filter on, adult folders leave the editor too — a
  // visibility toggle on a globally-filtered folder would lie in both
  // positions. The count keeps it honest.
  const items = showAdult
    ? categories.items
    : categories.items.filter((c) => !isAdultCategory(c));
  const adultHidden = categories.items.length - items.length;
  // "Visible" = what the search currently leaves in the list — the whole
  // list with an empty query. Toggle-all acts on exactly these rows.
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((c) => c.name.toLowerCase().includes(needle))
    : items;
  const allShown = visible.every((c) => !draft.has(c.id));

  const persisted = new Set(playlist.hiddenCategories ?? []);
  const dirty =
    draft.size !== persisted.size || [...draft].some((id) => !persisted.has(id));

  const toggleOne = (id: string) => {
    const next = new Set(draft);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraft(next);
  };
  const setMany = (ids: string[], hide: boolean) => {
    const next = new Set(draft);
    for (const id of ids) {
      if (hide) next.add(id);
      else next.delete(id);
    }
    setDraft(next);
  };

  return (
    <div className="source-editor">
      <div className="source-tools">
        <input
          className="settings-input source-tools__search"
          type="search"
          value={query}
          placeholder="Search folders…"
          aria-label={`Search ${playlist.name} folders`}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="source-tools__all"
          disabled={visible.length === 0}
          onClick={() => setMany(visible.map((c) => c.id), allShown)}
        >
          {allShown ? "Hide all" : "Show all"}
        </button>
        {dirty && (
          <>
            <button
              type="button"
              className="source-tools__discard"
              onClick={() =>
                setDraft(new Set(playlist.hiddenCategories ?? []))
              }
            >
              Discard
            </button>
            <button
              type="button"
              className="btn-primary source-tools__save"
              onClick={() => onSave([...draft])}
            >
              Save
            </button>
          </>
        )}
      </div>
      <div className="source-list">
        {visible.length === 0 && (
          <p className="settings__section-note settings__section-note--dim">
            No folders match “{query.trim()}”.
          </p>
        )}
        {visible.map((c) => (
          <div key={c.id} className="source-row">
            <span className="source-row__name">{c.name}</span>
            <Toggle
              small
              on={!draft.has(c.id)}
              onChange={() => toggleOne(c.id)}
              label={`Show ${c.name} in Live TV`}
            />
          </div>
        ))}
        {adultHidden > 0 && (
          <p className="settings__section-note settings__section-note--dim">
            {adultHidden} adult {adultHidden === 1 ? "folder" : "folders"} hidden
            — turn on “Show adult content” below to manage{" "}
            {adultHidden === 1 ? "it" : "them"}.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  const id = useId();
  return (
    <div className="settings-field">
      <label className="settings-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="settings-input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}
