import type { Game } from "./model";

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
