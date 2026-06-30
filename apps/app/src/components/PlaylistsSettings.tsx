import { useEffect, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { CloseIcon } from "./icons";
import {
  addM3uSource,
  addXtreamSource,
  backendConfigured,
  listSources,
  removeSource,
  setSourceEnabled,
  type SourceSummary,
} from "../lib/admin";
import { isTauri } from "../lib/tauri";
import { FocusButton } from "./FocusButton";
import { FocusField } from "./FocusField";
import { FocusToggle } from "./FocusToggle";

type PlaylistKind = "xtream" | "m3u";

/**
 * Playlists tab: add / list / toggle / remove live-TV playlists (Xtream or
 * M3U), stored on-device. `onDirty` lets the panel know the device config
 * changed so it can re-pull. `onReRunSetup` opens the phone handoff so sources
 * can be added without typing on the remote.
 */
export function PlaylistsSettings({
  onDirty,
  onReRunSetup,
}: {
  onDirty: () => void;
  onReRunSetup?: () => void;
}) {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<PlaylistKind>("xtream");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [epgUrl, setEpgUrl] = useState("");
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

  const canAdd =
    !busy &&
    (kind === "xtream"
      ? Boolean(baseUrl.trim() && username.trim() && password.trim())
      : Boolean(m3uUrl.trim()));

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    void add();
  }

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "xtream") {
        await addXtreamSource({
          name: name.trim() || undefined,
          baseUrl: baseUrl.trim(),
          username: username.trim(),
          password,
        });
      } else {
        await addM3uSource({
          name: name.trim() || undefined,
          url: m3uUrl.trim(),
          epgUrl: epgUrl.trim() || undefined,
        });
      }
      setName("");
      setBaseUrl("");
      setUsername("");
      setPassword("");
      setM3uUrl("");
      setEpgUrl("");
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
    // The remove button unmounts with its row — move focus to the stable "Add"
    // button first so the cursor isn't stranded on the deleted node.
    setFocus("set-pl-add");
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
      <form className="playlist-form" onSubmit={onFormSubmit}>
        <h4 className="playlist-form__title">Add Playlist</h4>

        {onReRunSetup && (
          <FocusButton
            className="btn settings__handoff-btn"
            focusKey="set-pl-handoff"
            onPress={onReRunSetup}
          >
            Set up from your phone
          </FocusButton>
        )}

        <div className="seg" role="tablist" aria-label="Playlist type">
          {(["xtream", "m3u"] as const).map((k) => (
            <FocusButton
              key={k}
              focusKey={`set-pl-kind-${k}`}
              className={"seg__btn" + (kind === k ? " seg__btn--active" : "")}
              onPress={() => setKind(k)}
            >
              {k === "xtream" ? "Xtream" : "M3U"}
            </FocusButton>
          ))}
        </div>

        <FocusField
          label="Name (optional)"
          focusKey="set-pl-name"
          value={name}
          onChange={setName}
          placeholder={kind === "xtream" ? "My IPTV" : "My M3U"}
        />

        {kind === "xtream" ? (
          <>
            <FocusField
              label="Server URL *"
              focusKey="set-pl-baseurl"
              value={baseUrl}
              onChange={setBaseUrl}
              type="url"
              inputMode="url"
              placeholder="http://example.com:8080"
            />
            <div className="field-row">
              <FocusField
                label="Username *"
                focusKey="set-pl-user"
                value={username}
                onChange={setUsername}
                placeholder="username"
              />
              <FocusField
                label="Password *"
                focusKey="set-pl-pass"
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="password"
              />
            </div>
          </>
        ) : (
          <>
            <FocusField
              label="M3U URL *"
              focusKey="set-pl-m3uurl"
              value={m3uUrl}
              onChange={setM3uUrl}
              type="url"
              inputMode="url"
              placeholder="http://example.com/playlist.m3u"
            />
            <FocusField
              label="EPG / XMLTV URL (optional)"
              focusKey="set-pl-epg"
              value={epgUrl}
              onChange={setEpgUrl}
              type="url"
              inputMode="url"
              placeholder="http://example.com/epg.xml"
            />
          </>
        )}

        {error && <p className="playlist-form__error">{error}</p>}

        <FocusButton
          className="btn btn--primary"
          focusKey="set-pl-add"
          disabled={!canAdd}
          onPress={() => void add()}
        >
          {busy ? "Adding…" : "Add Playlist"}
        </FocusButton>
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
                  <span className="playlist-item__badge">
                    {s.type.toUpperCase()}
                  </span>
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
                <FocusToggle
                  focusKey={`set-pl-toggle-${s.id}`}
                  checked={s.enabled}
                  onChange={() => toggle(s)}
                  ariaLabel={`Enable ${s.name}`}
                />
                <FocusButton
                  className="icon-btn"
                  focusKey={`set-pl-remove-${s.id}`}
                  ariaLabel={`Remove ${s.name}`}
                  onPress={() => remove(s)}
                >
                  <CloseIcon size={20} />
                </FocusButton>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
