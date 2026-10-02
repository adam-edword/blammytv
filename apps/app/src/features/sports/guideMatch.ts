import type { Programme } from "../live/model";
import { nicknameOf, normalize } from "./matcher";

/**
 * What the GUIDE says a game is on (Adam, 2026-10-02: "does the pairer try
 * to match with current channel description? that would probably help a
 * LOT").
 *
 * The matcher reads channel names only, so it cannot tell which game an
 * "Event Only" channel is showing, or which local station has a regional
 * NFL game. The guide can: a programme on at kick-off naming both clubs is
 * the channel saying so itself. MEASURED FIRST, through btvPairing, before
 * anything is paired on it: how much of a catalog has a guide decides
 * whether this is worth a place in the matcher.
 */

/** A programme in the span being asked about, its words worked out once. */
export interface Show {
  id: string;
  title: string;
  start: number;
  end: number;
  /** Title and description, normalized, padded so a name matches whole. */
  text: string;
}

/** Every programme overlapping [from, to), from the guide's map. */
export function showsIn(programmes: Map<string, Programme[]>, from: number, to: number): Show[] {
  const out: Show[] = [];
  for (const [id, list] of programmes)
    for (const p of list) {
      const start = p.start.getTime();
      const end = p.end.getTime();
      if (end <= from || start >= to) continue;
      out.push({ id, title: p.title, start, end, text: ` ${normalize(`${p.title} ${p.synopsis ?? ""}`)} ` });
    }
  return out;
}

/** The ways a programme might name a club, each matched as whole words:
 * "Washington Huskies", "Washington", "Huskies". */
function namesOf(t: { name: string; shortName?: string }): string[] {
  return [t.name, t.shortName ?? "", nicknameOf(t.name, t.shortName).join(" ")]
    .map((n) => normalize(n))
    .filter((n) => n.length > 2)
    .map((n) => ` ${n} `);
}

/** How long after kick-off a programme may start and still be the game: a
 * listing that opens with a pre-game segment. */
const LATE_MS = 30 * 60_000;

/**
 * The programmes that are this game: on at kick-off, or starting within
 * half an hour of it, naming BOTH clubs. One club alone is that club's
 * every game and every magazine show about it.
 */
export function airing(
  shows: Show[],
  game: {
    home: { name: string; shortName?: string };
    away: { name: string; shortName?: string };
    start: Date;
  },
): Show[] {
  const kick = game.start.getTime();
  const home = namesOf(game.home);
  const away = namesOf(game.away);
  return shows.filter(
    (s) =>
      s.start <= kick + LATE_MS &&
      s.end > kick &&
      home.some((n) => s.text.includes(n)) &&
      away.some((n) => s.text.includes(n)),
  );
}
