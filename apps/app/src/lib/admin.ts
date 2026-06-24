import { loadShareCode } from "./pairing";
import { isTauri } from "./tauri";
import { getAioUrl } from "./settings";
import { listCatalogs as aioListCatalogs } from "./aiostreams";

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

export const listSources = () => req<SourceSummary[]>("/admin/sources");

export const addXtreamSource = (input: AddXtreamInput) =>
  req<SourceSummary>("/admin/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const setSourceEnabled = (id: string, enabled: boolean) =>
  req<{ ok: true }>(`/admin/sources/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

export const removeSource = (id: string) =>
  req<{ ok: true }>(`/admin/sources/${id}`, { method: "DELETE" });

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
