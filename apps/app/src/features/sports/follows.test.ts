import { describe, expect, it } from "vitest";
import {
  asFollows,
  fetchList,
  gameTeamKeys,
  isFollowed,
  resolvable,
  teamKey,
  toggleLeague,
  toggleTeam,
} from "./follows";
import { DEFAULT_LEAGUES, toGames } from "./espn";
import { isFixture } from "./model";
import { ALL_LEAGUES } from "./leagues";
import mlb from "./fixtures/mlb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";

const MLB = "baseball/mlb";
const NFL = "football/nfl";
const EPL = "soccer/eng.1";
const none = { leagues: [], teams: [] };

describe("teamKey", () => {
  it("is league-scoped, because source ids are numbered per league", () => {
    // Real ids from the real captures. Unprefixed, two leagues' number 1
    // would be the same follow.
    const [mlbGame] = toGames(mlb, MLB).filter(isFixture);
    const [nflGame] = toGames(nfl, NFL).filter(isFixture);
    expect(teamKey(mlbGame.leagueKey, mlbGame.home)).toMatch(
      /^baseball\/mlb:\d+$/,
    );
    expect(teamKey(nflGame.leagueKey, nflGame.home)).toMatch(
      /^football\/nfl:\d+$/,
    );
    expect(teamKey(MLB, { id: "1" })).not.toBe(teamKey(NFL, { id: "1" }));
  });

  it("declines a competitor with no id rather than inventing one", () => {
    // Happens in a pruned fixture, not a real response. Better to lose the
    // follow control on that club than to key it on something that moves.
    expect(teamKey(MLB, {})).toBeNull();
  });
});

describe("gameTeamKeys", () => {
  it("gives both sides of a real game, distinctly", () => {
    const keys = gameTeamKeys(toGames(mlb, MLB)[0]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("isFollowed", () => {
  const game = toGames(mlb, MLB)[0];

  it("matches on the league", () => {
    expect(isFollowed(game, { leagues: [MLB], teams: [] })).toBe(true);
    expect(isFollowed(game, { leagues: ["hockey/nhl"], teams: [] })).toBe(false);
  });

  it("matches on either club", () => {
    const [home, away] = gameTeamKeys(game);
    expect(isFollowed(game, { leagues: [], teams: [home] })).toBe(true);
    expect(isFollowed(game, { leagues: [], teams: [away] })).toBe(true);
    expect(isFollowed(game, { leagues: [], teams: [`${MLB}:99999`] })).toBe(
      false,
    );
  });

  it("is false on an empty store, so nothing is followed by default", () => {
    expect(isFollowed(game, none)).toBe(false);
  });
});

describe("fetchList", () => {
  it("asks for EVERY league when nothing is followed", () => {
    // Adam's, and a reversal of the six-league floor that used to be here.
    // An empty store is the absence of a preference, not a preference for
    // six leagues, and a board that arrives pre-narrowed gives nobody a
    // reason to narrow it. Affordable because only the leagues that answer
    // with something get re-polled: see useGames.
    const all = fetchList(none);
    expect(all).toHaveLength(ALL_LEAGUES.length);
    expect(new Set(all).size).toBe(all.length);
    // The old floor is a subset of it, so nothing that used to be on the
    // first board fell off.
    for (const path of DEFAULT_LEAGUES) expect(all).toContain(path);
  });

  it("asks for exactly what is followed, defaults included or not", () => {
    // The inversion itself: a followed league is a request, and one that
    // is not followed is not fetched even though it used to be hardcoded.
    expect(fetchList({ leagues: ["tennis/atp"], teams: [] })).toEqual([
      "tennis/atp",
    ]);
    expect(fetchList({ leagues: [MLB], teams: [] })).toEqual([MLB]);
  });

  it("pulls in the league behind a followed club", () => {
    // There is no per-club endpoint, so following the Cubs means fetching
    // MLB. isFollowed narrows it back to the Cubs on the board.
    expect(fetchList({ leagues: [], teams: [`${MLB}:16`] })).toEqual([MLB]);
  });

  it("asks for each league once, however many ways it was reached", () => {
    const list = fetchList({
      leagues: [MLB, NFL],
      teams: [`${MLB}:16`, `${MLB}:17`, `${NFL}:2`],
    });
    expect(list).toEqual([MLB, NFL]);
  });

  it("is order-independent, because the board keys its fetching on it", () => {
    // Two stores holding the same leagues must produce the same list, or
    // adding and removing a follow refetches the world.
    const a = fetchList({ leagues: [NFL, MLB], teams: [] });
    const b = fetchList({ leagues: [MLB, NFL], teams: [] });
    expect(a).toEqual(b);
  });
});

describe("toggles", () => {
  it("add, then remove, on each half independently", () => {
    const one = toggleLeague(none, MLB);
    expect(one).toEqual({ leagues: [MLB], teams: [] });
    expect(toggleLeague(one, MLB).leagues).toEqual([]);

    const two = toggleTeam(one, `${MLB}:16`);
    expect(two).toEqual({ leagues: [MLB], teams: [`${MLB}:16`] });
    expect(toggleTeam(two, `${MLB}:16`).teams).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const before = { leagues: [MLB], teams: [] };
    toggleLeague(before, "hockey/nhl");
    expect(before.leagues).toEqual([MLB]);
  });
});

describe("asFollows", () => {
  it("takes the good case through", () => {
    expect(asFollows({ leagues: [MLB], teams: [`${MLB}:16`] })).toEqual({
      leagues: [MLB],
      teams: [`${MLB}:16`],
    });
  });

  it("survives anything else, because this runs on the first paint", () => {
    expect(asFollows(undefined)).toEqual(none);
    expect(asFollows(MLB)).toEqual(none);
    expect(asFollows({ leagues: MLB })).toEqual(none);
    // Partly good is kept partly: a bad half should not cost the good one.
    expect(asFollows({ leagues: [MLB, 7, null], teams: undefined })).toEqual({
      leagues: [MLB],
      teams: [],
    });
  });
});

describe("asFollows migrates the keys this feature shipped with", () => {
  it("re-keys a league follow onto its catalog path", () => {
    // Someone who followed the NHL before D1 is still following it after.
    expect(asFollows({ leagues: ["nhl", "epl"], teams: [] }).leagues).toEqual([
      "hockey/nhl",
      EPL,
    ]);
  });

  it("re-keys only the league half of a club follow", () => {
    // The club id after the colon is the SOURCE's and did not change.
    expect(asFollows({ leagues: [], teams: ["mlb:16", "nfl:2"] }).teams).toEqual(
      [`${MLB}:16`, `${NFL}:2`],
    );
  });

  it("leaves a key that is already a path alone", () => {
    expect(asFollows({ leagues: [MLB], teams: [`${EPL}:359`] })).toEqual({
      leagues: [MLB],
      teams: [`${EPL}:359`],
    });
  });

  it("does not double up when both keys are stored", () => {
    // Only reachable by hand-editing the store, but a duplicate would
    // double every count the sidebar shows.
    expect(asFollows({ leagues: ["mlb", MLB], teams: [] }).leagues).toEqual([
      MLB,
    ]);
  });

  it("leaves a key it has never heard of exactly as it found it", () => {
    // resolvable() is what makes an unknown key harmless. Inventing a path
    // for it here would make it un-droppable instead.
    expect(asFollows({ leagues: ["wat"], teams: ["wat:1"] })).toEqual({
      leagues: ["wat"],
      teams: ["wat:1"],
    });
  });
});

describe("resolvable", () => {
  const known = [MLB, NFL, EPL];

  it("keeps follows whose league still exists", () => {
    const f = { leagues: [EPL], teams: [`${EPL}:359`, `${MLB}:17`] };
    expect(resolvable(f, known)).toEqual(f);
  });

  it("drops a league key the catalog no longer carries", () => {
    const f = { leagues: ["soccer.gone/1"], teams: [] };
    expect(resolvable(f, known)).toEqual({ leagues: [], teams: [] });
  });

  it("drops a team whose league half no longer resolves", () => {
    const f = { leagues: [], teams: [`${EPL}:359`, `${MLB}:17`] };
    expect(resolvable(f, [MLB])).toEqual({ leagues: [], teams: [`${MLB}:17`] });
  });

  it("lets the board go back to unfiltered, which is the whole point", () => {
    // Without this the stale keys keep `narrowed` true while matching
    // nothing, every game is filtered out, and no control in the app can
    // clear them because the sidebar only renders leagues that exist.
    const stale = { leagues: ["epl"], teams: ["epl:359"] };
    const out = resolvable(stale, [EPL]);
    expect(out.leagues.length + out.teams.length).toBe(0);
  });
});
