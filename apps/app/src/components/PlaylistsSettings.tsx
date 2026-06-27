import { useEffect, useState } from "react";
import { CloseIcon } from "./icons";
import {
  addXtreamSource,
  backendConfigured,
  listSources,
  removeSource,
  setSourceEnabled,
  type SourceSummary,
} from "../lib/admin";
import { isTauri } from "../lib/tauri";

/**
 * Playlists tab: add / list / toggle / remove Xtream playlists. These live on
 * the backend (credentials never persist on-device); the form just posts them.
 * `onDirty` lets the panel know the device config changed so it can re-pull.
 */
export function PlaylistsSettings({ onDirty }: { onDirty: () => void }) {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const configured = isTauri() || backendConfigured();

  async function refresh() {
    setLoading(true);
    try {
      setSources(await listSources());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load playlists.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (configured) refresh();
    else setLoading(false);
  }, [configured]);

  if (!configured) {
    return (
      <p className="settings__note">
        Connect a backend (set <code>VITE_API_URL</code>) to manage playlists.
        You're currently in demo mode.
      </p>
    );
  }

  const canAdd = baseUrl.trim() && username.trim() && password.trim() && !busy;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      await addXtreamSource({
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        username: username.trim(),
        password,
      });
      setName("");
      setBaseUrl("");
      setUsername("");
      setPassword("");
      await refresh();
      onDirty();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the playlist.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: SourceSummary) {
    setSources((list) =>
      list.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
    );
    try {
      await setSourceEnabled(s.id, !s.enabled);
      onDirty();
    } catch {
      refresh(); // revert optimistic update on failure
    }
  }

  async function remove(s: SourceSummary) {
    setSources((list) => list.filter((x) => x.id !== s.id));
    try {
      await removeSource(s.id);
      onDirty();
    } catch {
      refresh();
    }
  }

  return (
    <div className="playlists">
      <form className="playlist-form" onSubmit={add}>
        <h4 className="playlist-form__title">Add Xtream Playlist</h4>

        <label className="field">
          <span className="field__label">Name (optional)</span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My IPTV"
          />
        </label>

        <label className="field">
          <span className="field__label">Server URL *</span>
          <input
            className="field__input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://example.com:8080"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Username *</span>
            <input
              className="field__input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field__label">Password *</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
            />
          </label>
        </div>

        {error && <p className="playlist-form__error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={!canAdd}>
          {busy ? "Adding…" : "Add Playlist"}
        </button>
      </form>

      <div className="playlists__list">
        <h4 className="playlists__list-title">
          Your Playlists {sources.length > 0 && `(${sources.length})`}
        </h4>

        {loading ? (
          <p className="settings__note">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="settings__note">No playlists yet. Add one above.</p>
        ) : (
          sources.map((s) => (
            <div className="playlist-item" key={s.id}>
              <div className="playlist-item__main">
                <div className="playlist-item__head">
                  <span className="playlist-item__name">{s.name}</span>
                  <span className="playlist-item__badge">XTREAM</span>
                </div>
                <span className="playlist-item__sub">
                  {s.channelCount != null
                    ? `${s.channelCount.toLocaleString()} channels`
                    : s.baseUrl}
                  {s.updatedAt &&
                    ` · Updated ${new Date(s.updatedAt).toLocaleDateString()}`}
                </span>
              </div>
              <div className="playlist-item__actions">
                <label className="toggle" title={s.enabled ? "Enabled" : "Disabled"}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={() => toggle(s)}
                    aria-label={`Enable ${s.name}`}
                  />
                  <span className="toggle__track">
                    <span className="toggle__thumb" />
                  </span>
                </label>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Remove ${s.name}`}
                  title="Remove"
                  onClick={() => remove(s)}
                >
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
