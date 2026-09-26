/// <reference lib="webworker" />
import { parseXmltv, type XmltvStats } from "./xmltv";

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
  | { programmes: ReturnType<typeof parseXmltv>; stats?: XmltvStats; chars: number }
  | { error: string };

self.onmessage = (e: MessageEvent<XmltvJob>) => {
  const { bytes, ids, now, stats: want } = e.data;
  let reply: XmltvDone;
  try {
    const xml = new TextDecoder().decode(bytes);
    const stats: XmltvStats | undefined = want
      ? { guideChannels: 0, unmatchedOurs: [], unmatchedTheirs: [], recovered: 0 }
      : undefined;
    reply = { programmes: parseXmltv(xml, new Map(ids), new Date(now), stats), stats, chars: xml.length };
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};
