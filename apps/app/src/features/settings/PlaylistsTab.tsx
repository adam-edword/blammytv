import { useId, useState } from "react";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import { ChevronIcon, CloseIcon } from "../../ui/icons";
import { fetchLiveCategories, type XtreamCategory } from "../../data/xtream";
import {
  KIND_LABELS,
  addPlaylist,
  isCategoryHidden,
  isHttpUrl,
  loadPlaylists,
  playlistSource,
  removePlaylist,
  savePlaylists,
  toggleHiddenCategory,
  togglePlaylist,
  type Playlist,
  type PlaylistDraft,
  type PlaylistKind,
} from "./playlists";

type Categories =
  | { status: "loading" }
  | { status: "ready"; items: XtreamCategory[] }
  | { status: "error" };

const KIND_TABS: Array<{ key: PlaylistKind; label: string }> = [
  { key: "xtream", label: KIND_LABELS.xtream },
  { key: "m3u", label: KIND_LABELS.m3u },
  { key: "stalker", label: KIND_LABELS.stalker },
];

const DESCRIPTIONS: Record<PlaylistKind, string> = {
  xtream:
    "Connect an Xtream Codes account — the server URL, username, and password from your provider.",
  m3u: "Point at an M3U playlist URL from your provider. EPG data comes along when the playlist links it.",
  stalker:
    "Connect a Stalker/MAG portal — the portal URL and the MAC address your provider registered.",
};

interface FormState {
  name: string;
  server: string;
  username: string;
  password: string;
  url: string;
  portal: string;
  mac: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  server: "",
  username: "",
  password: "",
  url: "",
  portal: "",
  mac: "",
};

function draftFrom(kind: PlaylistKind, f: FormState): PlaylistDraft {
  switch (kind) {
    case "xtream":
      return {
        kind,
        name: f.name,
        server: f.server.trim(),
        username: f.username.trim(),
        password: f.password,
      };
    case "m3u":
      return { kind, name: f.name, url: f.url.trim() };
    case "stalker":
      return { kind, name: f.name, portal: f.portal.trim(), mac: f.mac.trim() };
  }
}

function isComplete(kind: PlaylistKind, f: FormState): boolean {
  switch (kind) {
    case "xtream":
      return isHttpUrl(f.server) && f.username.trim() !== "" && f.password !== "";
    case "m3u":
      return isHttpUrl(f.url);
    case "stalker":
      return isHttpUrl(f.portal) && f.mac.trim() !== "";
  }
}

export function PlaylistsTab() {
  const [kind, setKind] = useState<PlaylistKind>("xtream");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists);

  // Per-playlist folder editor: which row is expanded, and each row's
  // fetched category list (kept per id so re-expanding is instant).
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const set = (field: keyof FormState) => (value: string) =>
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
                    className="playlist-row__delete"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => update(removePlaylist(playlists, p.id))}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>
              {expandedId === p.id && (
                <FolderEditor
                  playlist={p}
                  categories={categories[p.id]}
                  onToggle={(categoryId) =>
                    update(toggleHiddenCategory(playlists, p.id, categoryId))
                  }
                />
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}

/** The expanded folder list under a playlist row: every category from the
 * provider with a visibility toggle — off keeps it out of the Live sidebar. */
function FolderEditor({
  playlist,
  categories,
  onToggle,
}: {
  playlist: Playlist;
  categories: Categories | undefined;
  onToggle: (categoryId: string) => void;
}) {
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
          Couldn't reach the server. Check the playlist's credentials — and
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
  return (
    <div className="source-list">
      {categories.items.map((c) => (
        <div key={c.id} className="source-row">
          <span className="source-row__name">{c.name}</span>
          <Toggle
            small
            on={!isCategoryHidden(playlist, c.id)}
            onChange={() => onToggle(c.id)}
            label={`Show ${c.name} in Live TV`}
          />
        </div>
      ))}
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
