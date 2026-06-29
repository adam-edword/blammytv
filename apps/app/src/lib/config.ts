import {
  ConfigBlobSchema,
  mockConfig,
  type ConfigBlob,
  type ShareCode,
} from "@blammytv/shared";
import { loadPreferences } from "../state/preferences";
import { isTauri } from "./tauri";
import { getAioUrl } from "./settings";
import { buildVod } from "./aiostreams";
import { buildLive } from "./live";
import { loadPlaylists } from "./playlists";

/**
 * The single seam between the app and where its config comes from.
 *
 * The desktop app is **self-contained**: it assembles the ConfigBlob locally
 * from on-device settings (the AIOStreams manifest URL + carousel picks),
 * fetching AIOStreams directly via Rust. No backend required.
 *
 * In the browser it falls back to a configured dev backend (VITE_API_URL) or
 * the bundled demo seed — both validated through ConfigBlobSchema like the app.
 */
const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

/** Per-source load errors. VOD (AIOStreams) and live (IPTV) are independent —
 * one failing never blocks the other; each error surfaces on its own tab. */
export interface ConfigErrors {
  vod?: string;
  live?: string;
}

export interface LoadedConfig {
  config: ConfigBlob;
  errors: ConfigErrors;
}

export async function fetchConfig(shareCode: ShareCode): Promise<LoadedConfig> {
  if (isTauri()) return buildLocalConfig();

  // Browser/dev paths.
  if (!API_URL) {
    await delay(900);
    return {
      config: ConfigBlobSchema.parse(mockConfig(`Living Room (${shareCode})`)),
      errors: {},
    };
  }
  const sources = loadPreferences().carouselSources;
  const qs = sources.length
    ? `?carousel=${encodeURIComponent(sources.join(","))}`
    : "";
  const res = await fetch(`${API_URL}/config${qs}`, {
    headers: { Authorization: `Bearer ${shareCode}` },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "That code didn't work. Check it and try again."
        : `Couldn't load config (${res.status}).`,
    );
  }
  return { config: ConfigBlobSchema.parse(await res.json()), errors: {} };
}

const EMPTY_VOD: Pick<ConfigBlob, "movies" | "series" | "stream"> = {
  movies: [],
  series: [],
  stream: { featured: [], rows: [] },
};
const EMPTY_LIVE: ConfigBlob["live"] = { groups: [], channels: [], programs: [] };

/** Build the ConfigBlob on-device: VOD from AIOStreams, live from the saved
 * Xtream playlists. The two are fully independent and best-effort — neither
 * throws; a failure yields an empty section plus an error message for that
 * source's tab, so a broken AIOStreams URL never takes down Live TV (and vice
 * versa). Onboarding guarantees a manifest URL, so a VOD error is a real
 * problem worth showing — not the demo catalog masquerading as content. */
async function buildLocalConfig(): Promise<LoadedConfig> {
  // Self-contained: only the blob's scalar fields are seeded locally; live and
  // movies/series/stream below are real data. (No demo catalog is built here —
  // favorites live in their own localStorage store, not the blob.)
  const seed: Pick<
    ConfigBlob,
    "version" | "deviceName" | "updatedAt" | "favorites"
  > = {
    version: 1,
    deviceName: "BlammyTV",
    updatedAt: new Date().toISOString(),
    favorites: [],
  };
  const aioUrl = getAioUrl();
  const playlists = loadPlaylists().filter((p) => p.enabled);
  const errors: ConfigErrors = {};

  // Temporary load profiling — tells us whether the wait is network (VOD/live
  // fetches) or synchronous work (parsing + zod validation, which blocks the
  // splash animation). Read from the WebView console (logcat: CONSOLE lines).
  const t0 = performance.now();
  const since = (start: number) => Math.round(performance.now() - start);

  const [vod, live] = await Promise.all([
    (async (): Promise<Pick<ConfigBlob, "movies" | "series" | "stream">> => {
      if (!aioUrl) return EMPTY_VOD;
      try {
        const s = performance.now();
        const r = await buildVod(aioUrl, loadPreferences().carouselSources);
        console.log(`[load] VOD (AIOStreams) ${since(s)}ms`);
        return r;
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[config] VOD build failed:", err);
        errors.vod =
          `Couldn't load your AIOStreams catalog (${m}). ` +
          `Check the manifest URL in Settings → AIOStreams.`;
        return EMPTY_VOD;
      }
    })(),
    (async (): Promise<ConfigBlob["live"]> => {
      if (playlists.length === 0) return EMPTY_LIVE;
      try {
        const s = performance.now();
        const built = await buildLive(playlists);
        console.log(
          `[load] live (Xtream/M3U) ${since(s)}ms — ${built.channels.length} ch, ${built.programs.length} programs`,
        );
        if (built.channels.length > 0) return built;
        return EMPTY_LIVE;
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[config] live build failed:", err);
        errors.live =
          `Couldn't load your IPTV playlists (${m}). ` +
          `Check them in Settings → Playlists.`;
        return EMPTY_LIVE;
      }
    })(),
  ]);

  const zs = performance.now();
  const config = ConfigBlobSchema.parse({ ...seed, live, ...vod });
  console.log(
    `[load] zod validate ${since(zs)}ms · total ${since(t0)}ms (network runs in parallel; zod is synchronous = the freeze)`,
  );
  return { config, errors };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
