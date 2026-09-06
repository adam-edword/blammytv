import { describe, expect, it } from "vitest";
import {
  asFollows,
  conferenceKey,
  fetchList,
  gameConferenceKeys,
  gameTeamKeys,
  isFollowed,
  isRankable,
  isRanked,
  resolvable,
  teamKey,
  toggleConference,
  toggleConferences,
  toggleLeague,
  toggleTeam,
} from "./follows";
import { DEFAULT_LEAGUES, toGames } from "./espn";
import { isFixture } from "./model";
import { ALL_LEAGUES } from "./leagues";
import mlb from "./fixtures/mlb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";
import cfb from "./fixtures/cfb-scoreboard.json";

const MLB = "baseball/mlb";
const NFL = "football/nfl";
const EPL = "soccer/eng.1";
const CFB = "football/college-football";
const none = { leagues: [], teams: [], conferences: [] };

/**
 * The college fixture, by what each game IS rather than by index.
 *
 * Four real games from 2025-11-15, pruned. Between them they carry every
 * case this file cares about: a conference game, a cross-conference one,
 * ranked and unranked sides, and an FBS side against an FCS opponent whose
 * conference the shipped table does not name.
 */
const cfbGames = toGames(cfb, CFB);
const bothRanked = cfbGames[0]; // OU @ ALA, SEC v SEC, 4 and 11
const unranked = cfbGames[1]; // KSU @ OKST, Big 12 v Big 12
const crossConf = cfbGames[2]; // ND @ PITT, Independents (18) v ACC (1)
const vsFcs = cfbGames[3]; // TNTC @ UK, SEC (8) v an FCS side (179)

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
    expect(
      isFollowed(game, { leagues: [MLB], teams: [], conferences: [] }),
    ).toBe(true);
    expect(
      isFollowed(game, { leagues: ["hockey/nhl"], teams: [], conferences: [] }),
    ).toBe(false);
  });

  it("matches on either club", () => {
    const [home, away] = gameTeamKeys(game);
    expect(
      isFollowed(game, { leagues: [], teams: [home], conferences: [] }),
    ).toBe(true);
    expect(
      isFollowed(game, { leagues: [], teams: [away], conferences: [] }),
    ).toBe(true);
    expect(
      isFollowed(game, {
        leagues: [],
        teams: [`${MLB}:99999`],
        conferences: [],
      }),
    ).toBe(false);
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
    expect(
      fetchList({ leagues: ["tennis/atp"], teams: [], conferences: [] }),
    ).toEqual(["tennis/atp"]);
    expect(fetchList({ leagues: [MLB], teams: [], conferences: [] })).toEqual([
      MLB,
    ]);
  });

  it("pulls in the league behind a followed club", () => {
    // There is no per-club endpoint, so following the Cubs means fetching
    // MLB. isFollowed narrows it back to the Cubs on the board.
    expect(
      fetchList({ leagues: [], teams: [`${MLB}:16`], conferences: [] }),
    ).toEqual([MLB]);
  });

  it("asks for each league once, however many ways it was reached", () => {
    const list = fetchList({
      leagues: [MLB, NFL],
      teams: [`${MLB}:16`, `${MLB}:17`, `${NFL}:2`],
      conferences: [],
    });
    expect(list).toEqual([MLB, NFL]);
  });

  it("is order-independent, because the board keys its fetching on it", () => {
    // Two stores holding the same leagues must produce the same list, or
    // adding and removing a follow refetches the world.
    const a = fetchList({ leagues: [NFL, MLB], teams: [], conferences: [] });
    const b = fetchList({ leagues: [MLB, NFL], teams: [], conferences: [] });
    expect(a).toEqual(b);
  });
});

describe("toggles", () => {
  it("add, then remove, on each half independently", () => {
    const one = toggleLeague(none, MLB);
    expect(one).toEqual({ leagues: [MLB], teams: [], conferences: [] });
    expect(toggleLeague(one, MLB).leagues).toEqual([]);

    const two = toggleTeam(one, `${MLB}:16`);
    expect(two).toEqual({
      leagues: [MLB],
      teams: [`${MLB}:16`],
      conferences: [],
    });
    expect(toggleTeam(two, `${MLB}:16`).teams).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const before = { leagues: [MLB], teams: [], conferences: [] };
    toggleLeague(before, "hockey/nhl");
    expect(before.leagues).toEqual([MLB]);
  });
});

describe("asFollows", () => {
  it("takes the good case through", () => {
    expect(
      asFollows({ leagues: [MLB], teams: [`${MLB}:16`], conferences: [] }),
    ).toEqual({ leagues: [MLB], teams: [`${MLB}:16`], conferences: [] });
  });

  it("survives anything else, because this runs on the first paint", () => {
    expect(asFollows(undefined)).toEqual(none);
    expect(asFollows(MLB)).toEqual(none);
    expect(asFollows({ leagues: MLB })).toEqual(none);
    // Partly good is kept partly: a bad half should not cost the good one.
    expect(asFollows({ leagues: [MLB, 7, null], teams: undefined })).toEqual({
      leagues: [MLB],
      teams: [],
      conferences: [],
    });
  });
});

describe("asFollows migrates the keys this feature shipped with", () => {
  it("re-keys a league follow onto its catalog path", () => {
    // Someone who followed the NHL before D1 is still following it after.
    expect(
      asFollows({ leagues: ["nhl", "epl"], teams: [], conferences: [] })
        .leagues,
    ).toEqual(["hockey/nhl", EPL]);
  });

  it("re-keys only the league half of a club follow", () => {
    // The club id after the colon is the SOURCE's and did not change.
    expect(
      asFollows({ leagues: [], teams: ["mlb:16", "nfl:2"], conferences: [] })
        .teams,
    ).toEqual([`${MLB}:16`, `${NFL}:2`]);
  });

  it("leaves a key that is already a path alone", () => {
    expect(
      asFollows({ leagues: [MLB], teams: [`${EPL}:359`], conferences: [] }),
    ).toEqual({ leagues: [MLB], teams: [`${EPL}:359`], conferences: [] });
  });

  it("does not double up when both keys are stored", () => {
    // Only reachable by hand-editing the store, but a duplicate would
    // double every count the sidebar shows.
    expect(
      asFollows({ leagues: ["mlb", MLB], teams: [], conferences: [] }).leagues,
    ).toEqual([MLB]);
  });

  it("leaves a key it has never heard of exactly as it found it", () => {
    // resolvable() is what makes an unknown key harmless. Inventing a path
    // for it here would make it un-droppable instead.
    expect(
      asFollows({ leagues: ["wat"], teams: ["wat:1"], conferences: [] }),
    ).toEqual({ leagues: ["wat"], teams: ["wat:1"], conferences: [] });
  });
});

describe("resolvable", () => {
  const known = [MLB, NFL, EPL];

  it("keeps follows whose league still exists", () => {
    const f = {
      leagues: [EPL],
      teams: [`${EPL}:359`, `${MLB}:17`],
      conferences: [],
    };
    expect(resolvable(f, known)).toEqual(f);
  });

  it("drops a league key the catalog no longer carries", () => {
    const f = { leagues: ["soccer.gone/1"], teams: [], conferences: [] };
    expect(resolvable(f, known)).toEqual({
      leagues: [],
      teams: [],
      conferences: [],
    });
  });

  it("drops a team whose league half no longer resolves", () => {
    const f = {
      leagues: [],
      teams: [`${EPL}:359`, `${MLB}:17`],
      conferences: [],
    };
    expect(resolvable(f, [MLB])).toEqual({
      leagues: [],
      teams: [`${MLB}:17`],
      conferences: [],
    });
  });

  it("lets the board go back to unfiltered, which is the whole point", () => {
    // Without this the stale keys keep `narrowed` true while matching
    // nothing, every game is filtered out, and no control in the app can
    // clear them because the sidebar only renders leagues that exist.
    const stale = { leagues: ["epl"], teams: ["epl:359"], conferences: [] };
    const out = resolvable(stale, [EPL]);
    expect(out.leagues.length + out.teams.length).toBe(0);
  });
});

describe("conferenceKey", () => {
  it("is league-scoped, because ESPN numbers conferences per league", () => {
    // The collision is real, not hypothetical: in the shipped table college
    // football's ACC is 1 and college basketball's is 2, and the Summit is
    // 49 for the men and 47 for the women. A bare id would follow both.
    expect(conferenceKey(CFB, { conferenceId: "8" })).toBe(`${CFB}:8`);
    expect(conferenceKey("basketball/mens-college-basketball", {
      conferenceId: "8",
    })).toBe("basketball/mens-college-basketball:8");
  });

  it("is null for a competitor with no conference, which is every pro one", () => {
    // ESPN carries conferenceId on college teams only. Measured 2026-09-06:
    // no NFL, NBA, MLB or NHL competitor has one.
    const game = toGames(nfl, NFL)[0];
    expect(isFixture(game) && conferenceKey(NFL, game.home)).toBe(null);
  });
});

describe("gameConferenceKeys", () => {
  it("gives TWO on a cross-conference game", () => {
    // Notre Dame is an independent (18) and Pitt is ACC (1). Both, so the
    // game reaches everyone following either.
    expect(gameConferenceKeys(crossConf).sort()).toEqual([
      `${CFB}:1`,
      `${CFB}:18`,
    ]);
  });

  it("dedupes to ONE on a conference game", () => {
    expect(gameConferenceKeys(bothRanked)).toEqual([`${CFB}:8`]);
  });

  it("is empty for a professional game", () => {
    expect(gameConferenceKeys(toGames(nfl, NFL)[0])).toEqual([]);
  });
});

describe("isFollowed, by conference", () => {
  it("matches on EITHER side, not both", () => {
    // The whole reason cross-conference games are the interesting case: an
    // SEC v ACC fixture belongs to both people watching.
    expect(isFollowed(crossConf, { ...none, conferences: [`${CFB}:1`] })).toBe(
      true,
    );
    expect(isFollowed(crossConf, { ...none, conferences: [`${CFB}:18`] })).toBe(
      true,
    );
    expect(isFollowed(crossConf, { ...none, conferences: [`${CFB}:8`] })).toBe(
      false,
    );
  });

  it("still matches an FCS opponent's own conference", () => {
    // The board cannot NAME 179, so the picker never offers it. Following
    // it by hand still works, which is the honest behaviour: the store is
    // keys, and naming is a display problem.
    expect(isFollowed(vsFcs, { ...none, conferences: [`${CFB}:179`] })).toBe(
      true,
    );
  });

  it("does not leak across leagues on a shared id", () => {
    // Big 12 is 4 in football and 8 in basketball. A basketball follow on 4
    // must not pull in a football game.
    expect(
      isFollowed(unranked, {
        ...none,
        conferences: ["basketball/mens-college-basketball:4"],
      }),
    ).toBe(false);
  });
});

describe("the ranked filter is scoped, or it empties the board", () => {
  it("calls a college game rankable and a pro one not", () => {
    // By whether a conference is present, which is ESPN's own way of saying
    // college. Unscoped, "ranked only" would hide every NFL game forever.
    expect(isRankable(unranked)).toBe(true);
    expect(isRankable(toGames(nfl, NFL)[0])).toBe(false);
    expect(isRankable(toGames(mlb, MLB)[0])).toBe(false);
  });

  it("reads the poll off either side", () => {
    expect(isRanked(bothRanked)).toBe(true);
    expect(isRanked(crossConf)).toBe(true);
    expect(isRanked(unranked)).toBe(false);
  });

  it("treats ESPN's 99 as unranked rather than as 99th", () => {
    // The adapter normalises it away; this is the assertion that keeps it
    // normalised. Every side of the unranked game came back curatedRank 99.
    expect(isFixture(unranked) && unranked.home.rank).toBe(undefined);
    expect(isFixture(unranked) && unranked.away.rank).toBe(undefined);
    // And a real position still comes through as itself. Both sides of this
    // one were in the top 25 (4 and 11), so the pair is the assertion: one
    // number surviving could be either team's.
    expect(
      isFixture(bothRanked) && [bothRanked.home.rank, bothRanked.away.rank],
    ).toEqual([4, 11]);
  });
});

describe("conference follows and the fetch list", () => {
  it("pull their league onto the wire, like a club follow does", () => {
    // There is no way to ask ESPN for one conference without asking for the
    // league; isFollowed narrows the answer back down.
    expect(fetchList({ ...none, conferences: [`${CFB}:8`] })).toEqual([CFB]);
  });

  it("do not double up when the league is already followed", () => {
    expect(
      fetchList({ ...none, leagues: [CFB], conferences: [`${CFB}:8`] }),
    ).toEqual([CFB]);
  });

  it("are dropped by resolvable when their league half goes", () => {
    expect(
      resolvable({ ...none, conferences: [`${CFB}:8`, `${MLB}:1`] }, [MLB]),
    ).toEqual({ leagues: [], teams: [], conferences: [`${MLB}:1`] });
  });
});

describe("toggling conferences", () => {
  it("flips one", () => {
    const on = toggleConference(none, `${CFB}:8`);
    expect(on.conferences).toEqual([`${CFB}:8`]);
    expect(toggleConference(on, `${CFB}:8`).conferences).toEqual([]);
  });

  it("leaves the other two arrays alone", () => {
    const start = { leagues: [MLB], teams: [`${MLB}:17`], conferences: [] };
    const out = toggleConference(start, `${CFB}:8`);
    expect(out.leagues).toEqual([MLB]);
    expect(out.teams).toEqual([`${MLB}:17`]);
  });

  it("adds the missing one rather than clearing, when a preset is partly on", () => {
    // What the Power 4 chip does with three of its four already followed.
    // Clearing there would send you away from where the click said to go.
    const partial = { ...none, conferences: [`${CFB}:1`, `${CFB}:4`] };
    const out = toggleConferences(partial, [`${CFB}:1`, `${CFB}:4`, `${CFB}:5`]);
    expect(out.conferences.sort()).toEqual([
      `${CFB}:1`,
      `${CFB}:4`,
      `${CFB}:5`,
    ]);
  });

  it("and clears them once every one is on, so a second click undoes it", () => {
    const all = { ...none, conferences: [`${CFB}:1`, `${CFB}:4`] };
    expect(
      toggleConferences(all, [`${CFB}:1`, `${CFB}:4`]).conferences,
    ).toEqual([]);
  });

  it("keeps a conference the preset does not name", () => {
    const mixed = { ...none, conferences: [`${CFB}:1`, `${CFB}:15`] };
    const out = toggleConferences(mixed, [`${CFB}:1`]);
    expect(out.conferences).toEqual([`${CFB}:15`]);
  });
});

describe("a store written before conferences existed", () => {
  it("reads as none followed, and keeps everything else", () => {
    // NO VERSION BUMP, deliberately: `load` discards a value whose version
    // does not match, so bumping to add a field would throw away every
    // league and club anyone follows to gain an empty one.
    expect(asFollows({ leagues: [MLB], teams: [`${MLB}:17`] })).toEqual({
      leagues: [MLB],
      teams: [`${MLB}:17`],
      conferences: [],
    });
  });

  it("survives a hand-edited store with the wrong type in it", () => {
    expect(asFollows({ conferences: "nope" }).conferences).toEqual([]);
    expect(asFollows({ conferences: [1, `${CFB}:8`] }).conferences).toEqual([
      `${CFB}:8`,
    ]);
  });
});
