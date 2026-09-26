import type { Programme } from "./model";
import { parseXmltv, type XmltvStats } from "./xmltv";
import type { XmltvDone, XmltvJob } from "./xmltv.worker";

/**
 * Parse a downloaded guide on a worker, so the page never waits on it
 * (v0.10.11).
 *
 * Adam: "a weird 3ish second hang (whole app freezes) when loading
 * multiview for the first time in a session". freezeProbe on his machine
 * found it: one 3,325ms task, and the guide log beside it said "parsed EPG
 * for 1588 channels in 3323ms". Not Multi-view's own work at all. Every
 * launch paints from the disk cache and then refreshes behind it
 * (source.ts refreshInBackground), and the refresh parsed his 105.9MB
 * guide on the page's thread: whichever tab first needed the catalog
 * froze, the Guide included, and so did every later refresh.
 *
 * The bytes are handed over, not copied (the download is ours to give
 * away), and the programmes come back as a structured clone.
 *
 * Where there is no Worker (the unit tests), or one cannot be started,
 * the parse runs here, as it always did. A worker that starts and then
 * fails is an error like any other guide failure: the bytes went with it.
 */
export function parseXmltvOffThread(
  bytes: ArrayBuffer,
  byEpgId: Map<string, string[]>,
  now: Date,
  stats?: XmltvStats,
): Promise<{ programmes: Map<string, Programme[]>; chars: number }> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./xmltv.worker.ts", import.meta.url), { type: "module" });
  } catch {
    const xml = new TextDecoder().decode(bytes);
    return Promise.resolve({ programmes: parseXmltv(xml, byEpgId, now, stats), chars: xml.length });
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<XmltvDone>) => {
      worker.terminate();
      const done = e.data;
      if ("error" in done) return reject(new Error(done.error));
      if (stats && done.stats) Object.assign(stats, done.stats);
      resolve({ programmes: done.programmes, chars: done.chars });
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "the guide's worker failed to start"));
    };
    const job: XmltvJob = { bytes, ids: [...byEpgId], now: now.getTime(), stats: !!stats };
    worker.postMessage(job, [bytes]);
  });
}
