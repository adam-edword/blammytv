import { useState } from "react";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import { CloseIcon } from "../../ui/icons";
import {
  KIND_LABELS,
  addPlaylist,
  isHttpUrl,
  loadPlaylists,
  playlistSource,
  removePlaylist,
  savePlaylists,
  togglePlaylist,
  type Playlist,
  type PlaylistDraft,
  type PlaylistKind,
} from "./playlists";

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

  const update = (list: Playlist[]) => {
    setPlaylists(list);
    savePlaylists(list);
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
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Name (optional)"
                />
                <Field
                  value={form.server}
                  onChange={set("server")}
                  placeholder="Server URL"
                />
              </div>
              <div className="settings-form__row">
                <Field
                  value={form.username}
                  onChange={set("username")}
                  placeholder="Username"
                />
                <Field
                  value={form.password}
                  onChange={set("password")}
                  placeholder="Password"
                  type="password"
                />
              </div>
            </>
          )}
          {kind === "m3u" && (
            <div className="settings-form__row">
              <Field
                value={form.name}
                onChange={set("name")}
                placeholder="Name (optional)"
              />
              <Field
                value={form.url}
                onChange={set("url")}
                placeholder="Playlist URL (.m3u / .m3u8)"
              />
            </div>
          )}
          {kind === "stalker" && (
            <>
              <div className="settings-form__row">
                <Field
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Name (optional)"
                />
                <Field
                  value={form.portal}
                  onChange={set("portal")}
                  placeholder="Portal URL"
                />
              </div>
              <div className="settings-form__row">
                <Field
                  value={form.mac}
                  onChange={set("mac")}
                  placeholder="MAC address (00:1A:79:…)"
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
            <div key={p.id} className="playlist-row">
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
                  className="playlist-row__delete"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => update(removePlaylist(playlists, p.id))}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <input
      className="settings-input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
    />
  );
}
