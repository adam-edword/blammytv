/**
 * Jellyfin 12.2.0's real answers, for this folder's tests: the library Adam's
 * server held on 2026-10-14 (`scripts/fixtures/jellyfin-12.2.json`, taken by
 * `scripts/jf-probe.mjs`). Test-only.
 */
import { readFileSync } from "node:fs";
import type { JfItem } from "./items";
import type { JfSource } from "./sources";

interface Fixture {
  views: JfItem[];
  junk: JfItem[];
  items: Record<string, JfItem>;
  playbackInfo: Record<string, { MediaSources: JfSource[] }>;
  movieId: string;
  seriesIds: string[];
  episodeIds: string[];
}

export const FIX = JSON.parse(
  readFileSync(new URL("../../../../../scripts/fixtures/jellyfin-12.2.json", import.meta.url), "utf8"),
) as Fixture;

export const item = (id: string): JfItem => FIX.items[id];
export const SEVERANCE = FIX.seriesIds[0];
export const ZZZ = FIX.seriesIds[1];
/** Severance's three episodes in order, then Zzz's one. */
export const [EP1, EP2, EP3, ZZZ_EP] = FIX.episodeIds;
export const BASE = "http://192.168.1.50:8096";
