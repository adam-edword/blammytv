import { load, save } from "../../lib/storage";

/**
 * What happened each time Sports put a game on, kept so the channel pairing
 * can be measured on the catalog it fails on.
 *
 * WHY. Adam, 2026-09-25: wrong channels, games that say none while he has
 * them, junk in the rail, a bad feed picked first, and scores that don't
 * mean what they say. This container can't see his 26,000 channels, and
 * each of those has a different fix, so the app keeps the evidence: which
 * feed was put on and why (autoplay, a click, failover after a dead one),
 * whether it played and how fast, which ones died, and which ones he marked
 * wrong from the rail. The pairing probe (`btvPairing`) hands it back.
 *
 * NAMES ONLY. A channel's name and a game's name, never a stream URL or a
 * server: those are credentials, and a name is not.
 */
export type PairingEvent =
  | {
      t: number;
      kind: "tune";
      game: string;
      channel: string;
      quality: string | null;
      confidence: number;
      /** Its place in the rail, from 0: autoplay takes 0. */
      rank: number;
      how: "auto" | "hand" | "failover";
    }
  | { t: number; kind: "played"; game: string; channel: string; ms: number }
  | { t: number; kind: "dead"; game: string; channel: string }
  | { t: number; kind: "wrong"; game: string; channel: string; confidence: number; rank: number };

const KEY = "sportsPairingLog";
const VERSION = 1;
/** A few weekends of watching, and small enough to paste back. */
const MAX = 300;

export function loadPairingLog(): PairingEvent[] {
  return load<PairingEvent[]>(KEY, VERSION, []);
}

export function logPairing(e: PairingEvent): void {
  save(KEY, VERSION, [...loadPairingLog(), e].slice(-MAX));
}
