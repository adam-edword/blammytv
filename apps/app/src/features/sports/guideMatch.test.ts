import { describe, expect, it } from "vitest";
import type { Programme } from "../live/model";
import { airing, showsIn } from "./guideMatch";

const at = (iso: string) => new Date(iso);
const game = {
  home: { name: "USC Trojans", shortName: "USC" },
  away: { name: "Washington Huskies", shortName: "Washington" },
  start: at("2026-10-03T23:30:00Z"),
};
const prog = (title: string, start: string, end: string, synopsis?: string): Programme => ({
  title,
  synopsis,
  start: at(start),
  end: at(end),
});

describe("what the guide says a game is on", () => {
  const programmes = new Map<string, Programme[]>([
    // On at kick-off, both clubs in the title.
    ["nbc", [prog("College Football: Washington at USC", "2026-10-03T23:30:00Z", "2026-10-04T03:00:00Z")]],
    // A pre-game block first, the game twenty minutes after kick-off,
    // named by its nicknames in the description.
    ["local", [
      prog("Pregame", "2026-10-03T23:00:00Z", "2026-10-03T23:50:00Z"),
      prog("NCAA Football", "2026-10-03T23:50:00Z", "2026-10-04T03:00:00Z", "The Huskies visit the Trojans."),
    ]],
    // One club only: a magazine show, not the game.
    ["mag", [prog("Trojans Weekly", "2026-10-03T23:00:00Z", "2026-10-04T00:00:00Z")]],
    // The right teams, the wrong time: last season's replay that afternoon.
    ["replay", [prog("Washington at USC (Replay)", "2026-10-03T17:00:00Z", "2026-10-03T20:00:00Z")]],
  ]);
  const shows = showsIn(programmes, at("2026-10-03T12:00:00Z").getTime(), at("2026-10-04T12:00:00Z").getTime());

  it("finds a programme on at kick-off naming both clubs, by any of their names", () => {
    expect(airing(shows, game).map((s) => s.id).sort()).toEqual(["local", "nbc"]);
  });

  it("not one naming a single club, nor the right clubs at another time", () => {
    const ids = airing(shows, game).map((s) => s.id);
    expect(ids).not.toContain("mag");
    expect(ids).not.toContain("replay");
  });

  it("reads only the span it is given", () => {
    const later = showsIn(programmes, at("2026-10-04T04:00:00Z").getTime(), at("2026-10-04T06:00:00Z").getTime());
    expect(later).toEqual([]);
  });

  it("matches a name whole, not inside another word", () => {
    const usc = new Map<string, Programme[]>([
      ["x", [prog("Uscita: Washington Tonight", "2026-10-03T23:00:00Z", "2026-10-04T01:00:00Z")]],
    ]);
    const s = showsIn(usc, 0, Number.MAX_SAFE_INTEGER);
    expect(airing(s, game)).toEqual([]);
  });
});
