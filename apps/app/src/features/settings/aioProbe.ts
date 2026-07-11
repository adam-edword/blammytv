import {
  addonBase,
  encSegment,
  fetchCatalog,
  fetchManifest,
  fetchStreams,
} from "../../data/stremio";
import { httpProbe } from "../../lib/http";
import { scrubbedMessage } from "../../lib/errors";

/**
 * Connection test for the AIOStreams settings tab — built for the
 * Bobby-403 class of remote debugging: a tester can run it and
 * screenshot exactly WHICH endpoint their instance rejects, instead of
 * "it 403s somewhere". Uses the SAME fetch paths (Rust native-TLS +
 * webview 403 retry) as the real app, so it can't lie the way an
 * external curl test once did. All failure text is scrubbed — the
 * manifest URL is a credential and never appears in results.
 *
 * Failed steps additionally carry a FORENSIC line: one extra probe GET
 * whose answer identifies the rejector (status + server/cf-* headers +
 * how the body starts). That's the line that turned the Bobby saga's
 * "403 somewhere" into "Cloudflare challenged him" — from one
 * screenshot, no terminal needed.
 */

export interface ProbeStep {
  label: string;
  ok: boolean;
  detail: string;
  /** Second line on failures: what the rejecting response identified as. */
  forensic?: string;
}

/** Only HTTP-level failures earn a forensic probe — re-hitting a host
 * that just timed out would stall the whole test another 30s for
 * nothing new. */
function probeWorthy(detail: string): boolean {
  return /HTTP \d{3}|non-JSON/.test(detail);
}

/** One extra GET against the failed endpoint, summarized as "who
 * answered". Body text passes the URL scrubber — error pages love
 * echoing the request back. */
async function forensicFor(url: string): Promise<string | undefined> {
  const f = await httpProbe(url);
  if (!f) return undefined;
  const parts: string[] = [];
  for (const k of [
    "server",
    "via",
    "x-served-by",
    "x-powered-by",
    "cf-mitigated",
    "cf-ray",
  ]) {
    const v = f.headers[k];
    if (v) parts.push(`${k}: ${v}`);
  }
  const head = scrubbedMessage(f.bodyHead ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  if (head) parts.push(`body starts "${head}"`);
  return `answered HTTP ${f.status}${parts.length ? " — " + parts.join(" · ") : ""}`;
}

/** One plain-language conclusion under the result rows, rendered only
 * for failure patterns we've conclusively diagnosed before. The Bobby
 * saga's ending, distilled: `cf-mitigated: challenge` means the
 * instance's host demands an interactive browser check — nothing on the
 * user's machine OR in this app can pass it (it hits Stremio-style
 * clients generally), so the app should say that outright instead of
 * letting the user chase proxies and antivirus for a week. Verdicts we
 * can't stand behind render nothing — the forensic line still shows. */
export function probeVerdict(steps: ProbeStep[]): string | undefined {
  const failed = steps.filter((s) => !s.ok);
  if (failed.length === 0) return undefined;
  const forensics = failed.map((s) => s.forensic ?? "").join(" ");
  if (/cf-mitigated: challenge/i.test(forensics) || /Just a moment/i.test(forensics)) {
    return (
      "This instance sits behind Cloudflare bot protection, which is " +
      "challenging app traffic from your network. That can't be fixed " +
      "from your machine or by this app — it affects Stremio-style " +
      "clients generally. Ask whoever hosts the instance to exempt it " +
      "from bot protection, or move your config to another instance."
    );
  }
  if (failed.some((s) => /HTTP 40[13]\b/.test(s.detail))) {
    return (
      "The instance rejected the request. If this URL worked before, " +
      "your config link may have expired or been regenerated — re-copy " +
      "the manifest URL from your instance's configure page and submit " +
      "it again. If the error persists, the problem is on the server " +
      "hosting your manifest — ask its operator to check for a firewall " +
      "or bot protection blocking app traffic."
    );
  }
  return undefined;
}

export async function probeAioStreams(
  manifestUrl: string,
): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];
  const base = addonBase(manifestUrl);

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
    const detail = scrubbedMessage(e);
    steps.push({
      label: "Manifest",
      ok: false,
      detail,
      forensic: probeWorthy(detail)
        ? await forensicFor(`${base}/manifest.json`)
        : undefined,
    });
    return steps; // nothing below can run without it
  }

  if (firstCatalog) {
    const catalogUrl = `${base}/catalog/${encSegment(firstCatalog.type)}/${encSegment(firstCatalog.id)}.json`;
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
      const detail = scrubbedMessage(e);
      steps.push({
        label: `Catalog (${firstCatalog.type}/${firstCatalog.id})`,
        ok: false,
        detail,
        forensic: probeWorthy(detail) ? await forensicFor(catalogUrl) : undefined,
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
    const detail = scrubbedMessage(e);
    steps.push({
      label: "Streams (test title)",
      ok: false,
      detail,
      forensic: probeWorthy(detail)
        ? await forensicFor(`${base}/stream/movie/tt0111161.json`)
        : undefined,
    });
  }

  return steps;
}
