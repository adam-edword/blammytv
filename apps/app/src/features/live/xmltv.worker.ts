/// <reference lib="webworker" />
import type { GuideChannel } from "./model";
import { parseGuide, type XmltvStats } from "./xmltv";

/**
 * The guide's parse, off the page's thread (v0.10.11). See xmltvThread.ts
 * for why, and for the side that sends the work.
 *
 * Takes the download's bytes as they came (transferred, not copied) and
 * decodes them here too: a 106MB decode is its own ~100ms on whichever
 * thread does it.
 */
export interface XmltvJob {
  bytes: ArrayBuffer;
  ids: [string, string[]][];
  now: number;
  stats: boolean;
}

export type XmltvDone =
  | {
      programmes: ReturnType<typeof parseGuide>["programmes"];
      /** The guide's own channels, beside its programmes (xmltv.ts#parseGuide). */
      channels: GuideChannel[];
      stats?: XmltvStats;
      chars: number;
    }
  | { error: string };

/** Said once this file has loaded: the page hands the bytes over only
 * then, so a worker that never starts leaves them with the page. */
export interface XmltvReady {
  ready: true;
}

self.onmessage = (e: MessageEvent<XmltvJob>) => {
  const { bytes, ids, now, stats: want } = e.data;
  let reply: XmltvDone;
  try {
    const xml = new TextDecoder().decode(bytes);
    const stats: XmltvStats | undefined = want
      ? { guideChannels: 0, unmatchedOurs: [], unmatchedTheirs: [], recovered: 0 }
      : undefined;
    const { programmes, channels } = parseGuide(xml, new Map(ids), new Date(now), stats);
    reply = { programmes, channels, stats, chars: xml.length };
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};

(self as unknown as DedicatedWorkerGlobalScope).postMessage({ ready: true } satisfies XmltvReady);
