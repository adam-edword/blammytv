import {
  fetchCatalog,
  fetchManifest,
  fetchStreams,
} from "../../data/stremio";
import { scrubbedMessage } from "../../lib/errors";

/**
 * Connection test for the AIOStreams settings tab — built for the
 * Bobby-403 class of remote debugging: a tester can run it and
 * screenshot exactly WHICH endpoint their instance rejects, instead of
 * "it 403s somewhere". Uses the SAME fetch paths (Rust native-TLS +
 * webview 403 retry) as the real app, so it can't lie the way an
 * external curl test once did. All failure text is scrubbed — the
 * manifest URL is a credential and never appears in results.
 */

export interface ProbeStep {
  label: string;
  ok: boolean;
  detail: string;
}

export async function probeAioStreams(
  manifestUrl: string,
): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];

  let firstCatalog: { type: string; id: string } | undefined;
  try {
    const manifest = await fetchManifest(manifestUrl);
    const catalogs = manifest.catalogs ?? [];
    firstCatalog = catalogs[0];
    steps.push({
      label: "Manifest",
      ok: true,
      detail: `OK — ${catalogs.length} catalog${catalogs.length === 1 ? "" : "s"}`,
    });
  } catch (e) {
    steps.push({ label: "Manifest", ok: false, detail: scrubbedMessage(e) });
    return steps; // nothing below can run without it
  }

  if (firstCatalog) {
    try {
      const res = await fetchCatalog(
        manifestUrl,
        firstCatalog.type,
        firstCatalog.id,
        "",
      );
      const n = (res.metas ?? []).length;
      steps.push({
        label: `Catalog (${firstCatalog.type}/${firstCatalog.id})`,
        ok: true,
        detail: `OK — ${n} title${n === 1 ? "" : "s"}`,
      });
    } catch (e) {
      steps.push({
        label: `Catalog (${firstCatalog.type}/${firstCatalog.id})`,
        ok: false,
        detail: scrubbedMessage(e),
      });
    }
  } else {
    steps.push({
      label: "Catalog",
      ok: false,
      detail: "Manifest lists no catalogs",
    });
  }

  try {
    // A well-known public id — every debrid-backed instance can answer it.
    const res = await fetchStreams(manifestUrl, "movie", "tt0111161");
    const n = (res.streams ?? []).length;
    steps.push({
      label: "Streams (test title)",
      ok: true,
      detail: `OK — ${n} source${n === 1 ? "" : "s"}`,
    });
  } catch (e) {
    steps.push({
      label: "Streams (test title)",
      ok: false,
      detail: scrubbedMessage(e),
    });
  }

  return steps;
}
