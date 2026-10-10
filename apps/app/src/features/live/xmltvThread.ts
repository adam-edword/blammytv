import type { GuideChannel, Programme } from "./model";
import { parseGuide, type XmltvStats } from "./xmltv";
import type { XmltvDone, XmltvJob, XmltvReady } from "./xmltv.worker";

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
 * away), and the programmes come back as a structured clone, with the
 * guide's own channel list (id and name) beside them: the names a channel
 * the guide didn't match is matched by hand against.
 *
 * Where there is no Worker (the unit tests), or one does not start, the
 * parse runs here, as it always did: slower, and the guide still arrives.
 * A hot release is the first place this runs as a packaged build, served
 * through the app's own protocol rather than a dev server; a worker that
 * would not load there must not cost anyone their guide. So the bytes are
 * handed over only once the worker says it has loaded, and until then the
 * page still has them to fall back on. After that, a failure is an error
 * like any other guide failure.
 */
export async function parseXmltvOffThread(
  bytes: ArrayBuffer,
  byEpgId: Map<string, string[]>,
  now: Date,
  stats?: XmltvStats,
): Promise<ParsedGuide> {
  return parseInflated(await inflateGuide(bytes), byEpgId, now, stats);
}

export interface ParsedGuide {
  programmes: Map<string, Programme[]>;
  /** Every channel the guide declares (xmltv.ts#parseGuide). */
  channels: GuideChannel[];
  chars: number;
  onWorker: boolean;
}

/**
 * A guide served as a gzip FILE (an M3U's `url-tvg` pointing at .xml.gz,
 * which is common) arrives as gzip bytes: the HTTP layer only undoes a
 * Content-Encoding, and here the gzip is the body itself. Decoded as text
 * it was binary, matched nothing, and the guide stayed empty with "matched
 * none of the channels". Anything that doesn't start with gzip's magic
 * bytes is handed back as it came.
 */
export async function inflateGuide(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function parseInflated(
  bytes: ArrayBuffer,
  byEpgId: Map<string, string[]>,
  now: Date,
  stats?: XmltvStats,
): Promise<ParsedGuide> {
  const here = () => {
    const xml = new TextDecoder().decode(bytes);
    const { programmes, channels } = parseGuide(xml, byEpgId, now, stats);
    return { programmes, channels, chars: xml.length, onWorker: false };
  };
  let worker: Worker;
  try {
    worker = new Worker(new URL("./xmltv.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.resolve(here());
  }
  return new Promise((resolve, reject) => {
    let started = false;
    let gaveUp = false;
    const giveUp = (why: string) => {
      // The timer and a late load error can both land: read it once.
      if (gaveUp) return;
      gaveUp = true;
      worker.terminate();
      console.warn(`[live] the guide's worker did not start (${why}); reading it on the page`);
      resolve(here());
    };
    const slow = window.setTimeout(() => giveUp("no word in 5s"), START_MS);
    worker.onmessage = (e: MessageEvent<XmltvReady | XmltvDone>) => {
      const msg = e.data;
      if ("ready" in msg) {
        window.clearTimeout(slow);
        started = true;
        const job: XmltvJob = { bytes, ids: [...byEpgId], now: now.getTime(), stats: !!stats };
        worker.postMessage(job, [bytes]);
        return;
      }
      worker.terminate();
      if ("error" in msg) return reject(new Error(msg.error));
      if (stats && msg.stats) Object.assign(stats, msg.stats);
      resolve({ programmes: msg.programmes, channels: msg.channels, chars: msg.chars, onWorker: true });
    };
    worker.onerror = (e) => {
      if (!started) {
        window.clearTimeout(slow);
        return giveUp(e.message || "it failed to load");
      }
      worker.terminate();
      reject(new Error(e.message || "the guide's worker failed"));
    };
  });
}

/** How long a worker may take to load before the page reads the guide
 * itself. It loads in milliseconds; this is for one that never will. */
const START_MS = 5_000;
