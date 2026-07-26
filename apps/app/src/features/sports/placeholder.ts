import type { Competitor, Game } from "./model";

/**
 * Stand-in games so the hub can be built and looked at before the schedule
 * source is decided (plan 010's phase 0 gate).
 *
 * Every field here is one an adapter can fill from a real payload, and the
 * shapes are the ones the card already renders, so replacing this file with
 * a fetch is the whole wiring job. It is exported from ONE place for exactly
 * that reason: when the real source lands, this import is the only thing
 * that changes.
 */

/** Local logos are not in the tree yet; the card handles a missing one. */
export const PLACEHOLDER_GAMES: Game[] = [
  {
    id: "ph-1",
    sport: "soccer",
    league: "FIFA World Cup",
    state: "live",
    start: new Date(Date.now() - 41 * 60_000),
    status: "41'",
    home: { name: "Brazil", abbr: "BRA", score: 1, color: "1b7a3f" },
    away: { name: "Canada", abbr: "CAN", score: 4, color: "a8232b" },
    venue: "Monterrey",
    broadcasts: ["FX1"],
    channels: [{ id: "ph-c1", name: "FX1" }],
  },
  {
    id: "ph-2",
    sport: "soccer",
    league: "Premier League",
    state: "live",
    start: new Date(Date.now() - 67 * 60_000),
    status: "67'",
    home: { name: "Chelsea", abbr: "CHE", score: 2, color: "1e3fae" },
    away: { name: "Arsenal", abbr: "ARS", score: 2, color: "b81c22" },
    venue: "Stamford Bridge",
    broadcasts: ["USA Network"],
    channels: [
      { id: "ph-c2", name: "USA HD" },
      { id: "ph-c3", name: "USA Network 4K" },
      { id: "ph-c4", name: "US| USA East" },
    ],
  },
  {
    id: "ph-3",
    sport: "soccer",
    league: "UEFA Champions League",
    state: "live",
    start: new Date(Date.now() - 12 * 60_000),
    status: "12'",
    home: { name: "Real Madrid", abbr: "RMA", score: 0, color: "d4af37" },
    away: { name: "Bayern", abbr: "BAY", score: 0, color: "9c1a24" },
    venue: "Santiago Bernabéu",
    broadcasts: ["CBS Sports Network"],
    channels: [],
  },
];

/** A day's worth of fixtures, enough to make the row actually scroll. Built
 * from a handful of matchups rather than typed out twenty times: the point
 * of this data is the LAYOUT under pressure (long names, a full row, mixed
 * leagues), not the realism of any one game.
 *
 * The long names carry a short one the way a real payload does, so the small
 * card can show "Man City" while the wide card shows the club. The ones
 * without a short name are the pressure: they are what the fit is for. */
const MATCHUPS: Array<[Competitor, Competitor, string, Game["sport"]]> = [
  [
    { name: "Brazil", abbr: "BRA", color: "1b7a3f" },
    { name: "Canada", abbr: "CAN", color: "a8232b" },
    "FIFA World Cup",
    "soccer",
  ],
  [
    { name: "Chicago Cubs", shortName: "Cubs", abbr: "CHC", color: "0e3386" },
    {
      name: "Pittsburgh Pirates",
      shortName: "Pirates",
      abbr: "PIT",
      color: "c6a10a",
    },
    "MLB",
    "baseball",
  ],
  [
    { name: "Argentina", abbr: "ARG", color: "5fa8d3" },
    { name: "Germany", abbr: "GER", color: "3b3b3b" },
    "UEFA Euro",
    "soccer",
  ],
  [
    { name: "France", abbr: "FRA", color: "1f3a93" },
    { name: "Japan", abbr: "JPN", color: "b0303a" },
    "Copa America",
    "soccer",
  ],
  [
    { name: "Italy", abbr: "ITA", color: "1f6f4a" },
    { name: "Mexico", abbr: "MEX", color: "1a7a3e" },
    "CONCACAF Gold Cup",
    "soccer",
  ],
  [
    {
      name: "Manchester City",
      shortName: "Man City",
      abbr: "MCI",
      color: "6cabdd",
    },
    {
      name: "Wolverhampton Wanderers",
      shortName: "Wolves",
      abbr: "WOL",
      color: "fdb913",
    },
    "Premier League",
    "soccer",
  ],
];

const clock = (d: Date) =>
  d
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, "");

export const PLACEHOLDER_UPCOMING: Game[] = Array.from({ length: 20 }, (_, i) => {
  const [home, away, league, sport] = MATCHUPS[i % MATCHUPS.length];
  // Staggered through the evening so the times read like a real schedule
  // rather than twenty identical chips.
  const start = new Date(Date.now() + (45 + i * 25) * 60_000);
  return {
    id: `ph-up-${i}`,
    sport,
    league,
    state: "pre",
    start,
    status: clock(start),
    home,
    away,
    broadcasts: [],
    channels: [],
  };
});
