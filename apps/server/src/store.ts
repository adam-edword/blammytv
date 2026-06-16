import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Persisted sources (IPTV playlists, …) the device pulls config from. For now
 * it's a JSON file; swap for a real DB when there's more than one user. The
 * stored objects hold credentials — they never leave the server (the admin API
 * returns a redacted view).
 */

const DATA_DIR =
  process.env.BLAMMY_DATA_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA_DIR, "sources.json");

export interface XtreamSource {
  id: string;
  type: "xtream";
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  /** Live container extension for playback URLs (ts | m3u8). */
  liveExt: string;
  enabled: boolean;
  createdAt: string;
  /** Cached on each successful config build, for the playlists list UI. */
  channelCount?: number;
  updatedAt?: string;
}

export type Source = XtreamSource;

/** Credential-free view for the admin API / settings list. */
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

export function summarize(s: Source): SourceSummary {
  const { password: _pw, username: _u, ...rest } = s;
  return rest;
}

export function listSources(): Source[] {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Source[];
  } catch {
    return [];
  }
}

export function addXtreamSource(input: {
  name?: string;
  baseUrl: string;
  username: string;
  password: string;
  liveExt?: string;
}): Source {
  const sources = listSources();
  const source: XtreamSource = {
    id: randomUUID(),
    type: "xtream",
    name: input.name?.trim() || "IPTV",
    baseUrl: input.baseUrl.replace(/\/+$/, ""),
    username: input.username,
    password: input.password,
    liveExt: (input.liveExt || "ts").replace(/^\./, ""),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  sources.push(source);
  save(sources);
  return source;
}

export function removeSource(id: string): boolean {
  const sources = listSources();
  const next = sources.filter((s) => s.id !== id);
  if (next.length === sources.length) return false;
  save(next);
  return true;
}

export function setSourceEnabled(id: string, enabled: boolean): boolean {
  return patch(id, (s) => ({ ...s, enabled }));
}

/** Record stats from a successful build, for the list UI. */
export function recordBuildStats(id: string, channelCount: number): void {
  patch(id, (s) => ({
    ...s,
    channelCount,
    updatedAt: new Date().toISOString(),
  }));
}

function patch(id: string, fn: (s: Source) => Source): boolean {
  const sources = listSources();
  const i = sources.findIndex((s) => s.id === id);
  if (i === -1) return false;
  sources[i] = fn(sources[i]);
  save(sources);
  return true;
}

function save(sources: Source[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(sources, null, 2));
}
