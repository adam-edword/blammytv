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

/** Build the ConfigBlob on-device from the AIOStreams URL + carousel picks.
 * VOD comes from AIOStreams; live stays on the demo seed until Xtream moves
 * on-device too. Falls back to the seed if nothing's configured yet. */
async function buildLocalConfig(): Promise<ConfigBlob> {
  const seed = mockConfig("BlammyTV");
  const aioUrl = getAioUrl();

  let vod: Pick<ConfigBlob, "movies" | "series" | "stream"> = {
    movies: seed.movies,
    series: seed.series,
    stream: seed.stream,
  };
  if (aioUrl) {
    try {
      vod = await buildVod(aioUrl, loadPreferences().carouselSources);
    } catch (err) {
      console.error("[config] VOD build failed:", err);
    }
  }

  return ConfigBlobSchema.parse({ ...seed, live: seed.live, ...vod });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
