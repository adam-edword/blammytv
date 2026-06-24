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
import { buildLive } from "./xtream";
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

export async function fetchConfig(shareCode: ShareCode): Promise<ConfigBlob> {
  if (isTauri()) return buildLocalConfig();

  // Browser/dev paths.
  if (!API_URL) {
    await delay(900);
    return ConfigBlobSchema.parse(mockConfig(`Living Room (${shareCode})`));
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
  return ConfigBlobSchema.parse(await res.json());
}

/** Build the ConfigBlob on-device: VOD from AIOStreams, live from the saved
 * Xtream playlists. Live is best-effort (empty when nothing's set up); VOD
 * failures are surfaced — onboarding guarantees a manifest URL, so a failed
 * build means something's actually wrong (bad URL, unreachable addon) and the
 * user needs to see that, not a demo catalog masquerading as their content. */
async function buildLocalConfig(): Promise<ConfigBlob> {
  const seed = mockConfig("BlammyTV");
  const aioUrl = getAioUrl();
  const playlists = loadPlaylists().filter((p) => p.enabled);

  const [vod, live] = await Promise.all([
    (async (): Promise<Pick<ConfigBlob, "movies" | "series" | "stream">> => {
      // Onboarding requires a URL before we get here; if somehow missing, show
      // an empty catalog rather than the demo seed.
      if (!aioUrl) {
        return { movies: [], series: [], stream: { featured: [], rows: [] } };
      }
      try {
        return await buildVod(aioUrl, loadPreferences().carouselSources);
      } catch (err) {
        // Let it reach the UI's error state. Previously this fell back to the
        // demo seed, which renders as real-looking but art-less content and
        // hid the actual failure (the "buddy has keys but no art" red herring).
        const m = err instanceof Error ? err.message : String(err);
        console.error("[config] VOD build failed:", err);
        throw new Error(
          `Couldn't load your AIOStreams catalog (${m}). ` +
            `Check the manifest URL in Settings → AIOStreams.`,
        );
      }
    })(),
    (async (): Promise<ConfigBlob["live"]> => {
      if (playlists.length === 0) {
        return { groups: [], channels: [], programs: [] };
      }
      try {
        const built = await buildLive(playlists);
        if (built.channels.length > 0) return built;
      } catch (err) {
        console.error("[config] live build failed:", err);
      }
      return { groups: [], channels: [], programs: [] };
    })(),
  ]);

  return ConfigBlobSchema.parse({ ...seed, live, ...vod });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
