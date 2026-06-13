import {
  ConfigBlobSchema,
  type ConfigBlob,
  type ShareCode,
} from "@blammytv/shared";
import { mockConfig } from "./mockConfig";

/**
 * The single seam between the app and where config comes from.
 *
 * v0.1 has no backend, so we serve a validated mock blob after a short delay
 * (so the loading skeletons — the whole pitch — actually get to show). When the
 * backend exists, this becomes a `fetch()` against the config endpoint; the
 * rest of the app is untouched because it only consumes a parsed ConfigBlob.
 */
export async function fetchConfig(shareCode: ShareCode): Promise<ConfigBlob> {
  await delay(900);
  // ConfigBlobSchema.parse is the guard that the dumb terminal only ever
  // renders well-formed config — real or mock.
  return ConfigBlobSchema.parse(mockConfig(`Living Room (${shareCode})`));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
