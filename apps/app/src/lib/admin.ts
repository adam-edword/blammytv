import { loadShareCode } from "./pairing";
import { isTauri } from "./tauri";
import { getAioUrl } from "./settings";
import { listCatalogs as aioListCatalogs } from "./aiostreams";
import {
  addPlaylist,
  loadPlaylists,
  removePlaylist,
  setPlaylistEnabled,
  type Playlist,
} from "./playlists";

/**
 * Client for the backend's playlists admin API (used by the in-app settings).
 * Authenticated by the device's share code, same as /config. Only available
 * when a backend is configured (VITE_API_URL); in demo mode there's nothing to
 * manage.
 */

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

export const backendConfigured = (): boolean => Boolean(API_URL);

export interface SourceSummary {
  id: string;
  type: "xtream";
  name: string;
  baseUrl: string;
  enabled: boolean;
  createdAt: string;
  channelCount?: number;
  updatedAt?: string;
}

export interface AddXtreamInput {
  name?: string;
  baseUrl: string;
  username: string;
  password: string;
}

/** A catalog the carousel can pull from (for the Customize picker). */
export interface CatalogOption {
  id: string;
  type: string;
  name: string;
}

/** Catalogs for the carousel picker — read straight from AIOStreams on the
 * desktop app, or from the dev backend in the browser. */
export const listCatalogs = async (): Promise<CatalogOption[]> => {
  if (isTauri()) {
    const url = getAioUrl();
    return url ? aioListCatalogs(url) : [];
  }
  return req<CatalogOption[]>("/admin/catalogs");
};

/** Credential-free view of a local playlist (matches the old server summary). */
function summarize(p: Playlist): SourceSummary {
  return {
    id: p.id,
    type: "xtream",
    name: p.name,
    baseUrl: p.baseUrl,
    enabled: p.enabled,
    createdAt: p.createdAt,
  };
}

export const listSources = async (): Promise<SourceSummary[]> =>
  isTauri()
    ? loadPlaylists().map(summarize)
    : req<SourceSummary[]>("/admin/sources");

export const addXtreamSource = async (
  input: AddXtreamInput,
): Promise<SourceSummary> =>
  isTauri()
    ? summarize(addPlaylist(input))
    : req<SourceSummary>("/admin/sources", {
        method: "POST",
        body: JSON.stringify(input),
      });

export const setSourceEnabled = async (
  id: string,
  enabled: boolean,
): Promise<{ ok: true }> => {
  if (isTauri()) {
    setPlaylistEnabled(id, enabled);
    return { ok: true };
  }
  return req<{ ok: true }>(`/admin/sources/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
};

export const removeSource = async (id: string): Promise<{ ok: true }> => {
  if (isTauri()) {
    removePlaylist(id);
    return { ok: true };
  }
  return req<{ ok: true }>(`/admin/sources/${id}`, { method: "DELETE" });
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error("No backend configured.");
  const code = loadShareCode();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(code ? { Authorization: `Bearer ${code}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}
