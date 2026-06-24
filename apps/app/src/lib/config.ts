import {
  ConfigBlobSchema,
  mockConfig,
  type ConfigBlob,
  type ShareCode,
} from "@blammytv/shared";
import { loadPreferences } from "../state/preferences";

/**
 * The single seam between the app and where config comes from.
 *
 * If a backend is configured (VITE_API_URL), the device pulls its config from
 * the `/config` endpoint, authenticated by the share code. Otherwise we're in
 * demo mode (e.g. the GitHub Pages showcase) and serve a validated mock blob
 * after a short delay (so the loading skeletons get to show).
 *
 * Either way the app only ever sees a parsed ConfigBlob, so nothing downstream
 * cares which path produced it. ConfigBlobSchema.parse is the guard that the
 * dumb terminal only renders well-formed config — real or mock.
 */
const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

export async function fetchConfig(shareCode: ShareCode): Promise<ConfigBlob> {
  if (!API_URL) {
    await delay(900);
    return ConfigBlobSchema.parse(mockConfig(`Living Room (${shareCode})`));
  }

  // The carousel-source picker (a device pref) rides along as a query param so
  // the server builds the hero carousel from the chosen catalogs.
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
