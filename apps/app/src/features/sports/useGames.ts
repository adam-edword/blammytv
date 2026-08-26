import { useCallback, useEffect, useRef, useState } from "react";
import { onDay } from "./day";
import { DEFAULT_LEAGUES, fetchBoard } from "./espn";
import { CARD_CONFIDENCE, matchEvent, matchGame, preferVisible } from "./matcher";
import type { Catalog } from "./matcher";
import { gameTeamKeys } from "./follows";
import { isFixture, isTournament } from "./model";
import type { Game } from "./model";
import { presumedNetworks } from "./networkMap";

/** How often a mounted hub re-reads TODAY. Later days do not move. */
const REFRESH_MS = 90_000;

/**
 * The same read, while a game is being WATCHED (plan 010 #23).
 *
 * The plan's own verification list says "nothing polls while playback is
 * running", and the poll did, because the theater does not hold a snapshot
 * of the game you opened: it looks the game back up in the live board on
 * every render (SportsScreen's `current`), so the refresh is what moves its
 * header from a kickoff time to live to final. Stopping the poll would
 * freeze that header, and a game that has finished still saying "live" is a
 * worse lie than the one being fixed.
 *
 * So it SLOWS rather than stops. The theater needs state transitions, which
 * happen a handful of times a game, not scores, which it does not show. Over
 * a two hour game that is 24 refreshes instead of 80, a ~70% cut in the work
 * done during the one activity that is already competing for the connection.
 *
 * Five minutes rather than ten because the cost of being wrong is asymmetric:
 * the saving between the two is another 12 requests, and the price is a
 * header that can say "live" about a finished game for twice as long.
 */
const WATCHING_REFRESH_MS = 5 * 60_000;

/**
 * How many days the board opens with, and how many each "Show more" adds.
 *
 * FIVE, and the number is measured rather than picked. The window asks per
 * DAY per league, so the size is a request count, not a payload: five days
 * over the six default leagues is 30 asks behind a gate of six.
 *
 * Three was too few to be the whole answer. A league can go a week between
 * fixtures, so anything past day three fell to the reach below, which
 * answers with a league's NEXT fixture rather than its slate — college
 * football on a Thursday eight days out showed two of eleven games, because
 * two were what the reach was asked for.
 *
 * Five rather than fourteen because the far end is cheap to defer and
 * expensive to guess at: most days past the first few are empty for most
 * leagues, and an empty day is a request that bought nothing. The button
 * pays for the next chunk only when somebody wants it.
 *
 * THE CALLER STILL DECIDES, and has to: with nothing followed the fetch
 * list is all 151 catalog leagues, where five days would be 755 requests.
 * SportsScreen asks for five only when the board is narrowed to a league or
 * a club, which is one or two paths. `loadMore` adds the SAME number it
 * opened with, so the depth a click buys scales the same way.
 *
 * (A RANGE request would be the other way to widen this, and it is a trap:
 * ESPN silently caps a range at 100 events. Measured 2026-08-26, MLB
 * returns exactly 100 for any range of 7 days or more and college football
 * 99 at 14, so a widened range drops the far end without saying so. Per-day
 * asks cannot hit it.)
 */
const DAYS = 5;

/**
 * How far forward to look for a followed club's next game (#40).
 *
 * Bounded because the payload tracks events-in-window and ESPN caps a
 * response at 100 events, so an open range on a daily-cadence league is
 * megabytes to find one row. Measured 2026-08-08 from that date forward:
 * the Premier League is 63 KB / 6 events at 14 days and 222 KB / 30 at 30;
 * MLB is 1.5 MB / 100 at 7, 14 AND 30, i.e. capped whatever you ask.
 *
 * MLB being expensive is the argument FOR 14 rather than against it: a club
 * that plays daily is never absent from a three-day window, so this never
 * fires for MLB. It fires for weekly-cadence leagues, where it is 63 KB.
 */
const CLUB_REACH_DAYS = 14;

/**
 * What one "Show more" is worth: games, and the asks it may spend getting
 * them. See `loadMore`, which explains why it is a game target rather than
 * a day count and why the ask cap has to sit beside it.
 *
 * The count is of RAW games, before the follow filter SportsScreen applies
 * on top. For a league follow those are the same set. For a CLUB follow the
 * fetch list is the club's whole league, so the raw count runs ahead of
 * what you see and a click lands fewer days than it would otherwise — it
 * still walks at least the board's own opening width, which is the floor
 * that keeps it from being nothing.
 */
const MORE_GAMES = 50;
const MORE_ASKS = 60;

export interface Day {
  /** Local midnight of the day this covers. */
  date: Date;
  /** Its games, in kick-off order. */
  games: Game[];
}

/**
 * The next few days of games, with today kept current.
 *
 * Today refreshes on a timer because scores move; the days after it are
 * fetched once, because a fixture list does not change while you are
 * looking at it and re-reading five leagues every 90 seconds to learn that
 * would be several hundred KB an hour for nothing.
 *
 * The timer only runs while the window is being looked at, and a failed
 * refresh keeps the last good board: a network blip should leave the
 * scores on screen for another 90 seconds, not blank the page.
 *
 * WHICH leagues is the caller's business (plan 010, D1): this is handed the
 * list rather than knowing five of them, so following one more league is a
 * different argument rather than a different code path.
 */
/**
 * What still needs asking for, once the window has been drawn.
 *
 * Pure and exported because this is where #40's bug lived and the hook it
 * runs inside cannot be tested without a DOM. Two questions, and the second
 * is the one that was missing:
 *
 *   missing        followed LEAGUES with nothing on the board. Asked "what
 *                  is next", unbounded.
 *   clubsByLeague  followed CLUBS with nothing on the board, grouped by the
 *                  league that has to be asked for them. A club follow puts
 *                  its LEAGUE on the wire, so a mid-season league covers its
 *                  own path and never appears in `missing`, while the club
 *                  itself can sit idle for the whole window.
 *
 * A league already in `missing` is dropped from the club grouping: it is
 * about to be asked "what is next" anyway, and asking it again with a range
 * would be two requests for one league.
 */
/**
 * How long until the next board read, given whether a game is being watched.
 *
 * Exported and pure so the RELATIONSHIP between the two constants is pinned
 * by a test rather than by whoever edits one of them next. That is the whole
 * of #24's worry in miniature: the v0.8.1 guide-cache bug was a retention
 * window and a cache age in different places agreeing only by luck.
 */
export function pollDelay(watching: boolean): number {
  return watching ? WATCHING_REFRESH_MS : REFRESH_MS;
}

export function reachTargets(
  paths: readonly string[],
  clubKeys: readonly string[],
  onBoard: readonly Game[],
  covered: ReadonlySet<string>,
): { missing: string[]; clubsByLeague: Map<string, Set<string>> } {
  const missing = paths.filter((p) => !covered.has(p));
  const clubsOn = new Set(onBoard.flatMap(gameTeamKeys));
  const clubsByLeague = new Map<string, Set<string>>();
  for (const k of clubKeys) {
    if (clubsOn.has(k)) continue;
    const cut = k.indexOf(":");
    if (cut <= 0) continue;
    const league = k.slice(0, cut);
    // NO SKIP when the league is also being reached for, which is what this
    // did and it was wrong. The two asks answer different questions, as this
    // file says three times over: a bare call hands back the LEAGUE's next
    // fixture, which for a club follow is somebody else's game and is then
    // filtered off the board by isFollowed. Skipping the club here removed
    // the only ask that could answer for it, in exactly the case the club
    // reach exists for. One extra request beats an empty board.
    let set = clubsByLeague.get(league);
    if (!set) clubsByLeague.set(league, (set = new Set()));
    set.add(k);
  }
  return { missing, clubsByLeague };
}

export function useGames(
  leagues: readonly string[] = DEFAULT_LEAGUES,
  dayCount = DAYS,
  /**
   * Followed CLUB keys (`${leagueKey}:${teamId}`), for the club half of
   * #40. Separate from `leagues` because they reach ahead differently: a
   * league asks "what is next", a club has to ask its league for a window
   * and then find itself in it.
   */
  teams: readonly string[] = [],
  /**
   * REACH PAST THE WINDOW for a followed league with nothing in it (plan
   * 010 #36). Adam's: "if there's ANYTHING on the schedule for a sport
   * you've favorited, it should show up in the grid."
   *
   * Three days is the right window for "what is on" and exactly wrong once
   * the board is narrowed: follow F1 in August and it is empty for
   * eighteen days, follow the NBA in summer and it is empty for two
   * months, while both have full published calendars. The board was
   * answering "nothing" to a question the source can answer.
   *
   * Only when narrowed, and only for the leagues that came back empty, so
   * the cost is bounded by how many things you follow rather than by the
   * catalog. An unnarrowed board reaching two months ahead would be
   * answering a question nobody asked.
   */
  reach = false,
  /**
   * A game is open in the theater, so poll at the slower cadence (#23).
   *
   * NOT a dependency of the effect below, deliberately: that effect clears
   * the board and refetches when it re-runs, so opening the theater would
   * blank the thing you are looking through. It rides a ref instead, which
   * means the cadence changes from the NEXT tick rather than immediately.
   * That is the correct trade: one more 90s tick costs one read, and
   * restarting the timer to save it would risk resetting the interval on
   * every render.
   */
  watching = false,
) {
  const [days, setDays] = useState<Day[]>([]);
  /**
   * What was reached for BEYOND the window, in date order.
   *
   * Its own list rather than more `days`, and the reason is what came back
   * once racing asked for its season: twelve Grands Prix on twelve
   * different dates, which as days would be twelve headings with one card
   * under each. That is the same "all broken out" that #36's first cut had,
   * at a different scale. One section, and the cards carry their own dates.
   */
  const [ahead, setAhead] = useState<Game[]>([]);
  /**
   * Days past the opening window, appended by `loadMore`.
   *
   * Their own list rather than more `days`, for two reasons. The 90 second
   * tick rewrites `days[0]` through a setter that rebuilds the array, and
   * the base effect clears `days` outright whenever the fetch list changes;
   * keeping these separate means neither has to know how far somebody has
   * paged. And the cache is 30 seconds by design (it is deliberately
   * shorter than the refresh), so growing the window by re-running the base
   * effect would re-ask for every day already on screen rather than just
   * the new ones.
   */
  const [extra, setExtra] = useState<Day[]>([]);
  const [moreState, setMoreState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /**
   * The reach ASKED and did not get an answer, as opposed to asking and being
   * told there is nothing.
   *
   * The empty board could not tell those apart and asserted the second: a
   * single 503 on a single followed league made `fetchBoard` throw (it throws
   * when every path rejects, and one followed league is every path), the
   * catch swallowed it, `ahead` stayed empty, and the screen said the league
   * had published nothing at all. For a calendar with twelve rounds still to
   * run, with no retry for the life of the mount.
   */
  const [reachFailed, setReachFailed] = useState(false);
  /** Read by `tick`, so the cadence can change without tearing the effect
   * down. See the `watching` parameter. */
  const watchingRef = useRef(watching);
  /** Set by the effect, so leaving the theater can force a read without
   * reaching inside it. */
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    const was = watchingRef.current;
    watchingRef.current = watching;
    // Coming OUT of playback, the board can be a whole slow interval stale
    // and is about to be looked at. Read it now rather than showing five
    // minute old scores until the next tick.
    if (was && !watching) refreshRef.current();
  }, [watching]);

  /**
   * The fetch list as one string, and the effect's real dependency.
   *
   * An array prop is a new object on every render of the caller, so keying
   * the effect on `leagues` itself would tear down the timer, abort the
   * board and refetch every league on every parent render. The contents are
   * what matters and they are strings, so compare the contents. `fetchList`
   * sorts, which is what makes this stable when a follow is added and
   * removed again.
   */
  const key = leagues.join(",");
  /**
   * Same reasoning as `key`, INCLUDING the sort.
   *
   * `fetchList` sorts, which is what makes `key` stable when a follow is
   * added and removed again. This inherited the raw order of `follows.teams`,
   * which `flip` mutates by appending, so unfollowing a club and re-following
   * it produced "359,364" then "364" then "364,359": a different string for
   * an identical follow set. The effect below clears the board and refetches
   * on every change, so the user watched it blank twice to arrive back where
   * they started.
   */
  const teamKey = [...teams].sort().join(",");

  useEffect(() => {
    const paths = key ? key.split(",") : [];
    const clubKeys = teamKey ? teamKey.split(",") : [];
    const ac = new AbortController();
    let timer: number | undefined;

    /**
     * The days this board covers, from local midnight.
     *
     * REBUILT rather than captured, because midnight happens. Computed once
     * per mount, a hub left open overnight goes on polling yesterday as
     * "today" forever, while dayLabel re-evaluates on render, so the first
     * grid quietly relabels itself to yesterday's date under a row still
     * headed "Today's Games".
     */
    const makeDates = () =>
      Array.from({ length: dayCount }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        return d;
      });
    let dates = makeDates();

    /** Has the local date moved on since the board was built? */
    const rolled = () =>
      makeDates()[0].getTime() !== dates[0].getTime();

    /**
     * Which load is the current one.
     *
     * Neither loader had a guard beyond `ac.signal`, which is mount-scoped,
     * so two overlapping refreshes were last-to-LAND-wins rather than
     * last-to-START-wins: alt-tab out and back twice, the second fetch
     * returns first with fresh scores, then the first returns with older
     * ones and the board regresses until the next tick.
     */
    let gen = 0;
    /**
     * The reach's OWN generation, separate from `gen`.
     *
     * They were shared, and `loadToday` bumps `gen` on every 90s tick, on
     * every return to the app and now on every theater close. Any of those
     * landing while the reach was awaiting made its guard drop a result that
     * had already been downloaded and parsed, and nothing re-runs the reach
     * until the fetch list changes, so `ahead` stayed empty for the life of
     * the mount. The two loaders write disjoint state (`days[0]` against
     * `ahead`); one counter conflated them.
     */
    let aheadGen = 0;

    /**
     * The paths the 90 second tick actually asks for.
     *
     * Starts as everything and NARROWS after the first full load to the
     * leagues that answered with something (or failed and deserve another
     * go). With an empty follow store the fetch list is now all 151 catalog
     * leagues, of which 20 had anything on when it was measured, so this is
     * the difference between ~100 requests a minute and ~13. See fetchBoard
     * for why a day's empty leagues cannot become non-empty later.
     *
     * Reset by `loadAll`, so a date roll re-widens to the whole list before
     * narrowing again on the new day's answers.
     */
    let polling: readonly string[] = paths;

    const loadAll = async () => {
      const mine = ++gen;
      polling = paths;
      setAhead([]);
      // A date roll comes through here, and these days are offsets from
      // today: yesterday's day six is today's day five. Drop them rather
      // than relabel them.
      setExtra([]);
      try {
        const all = await Promise.all(
          dates.map((date) => fetchBoard(paths, { date, signal: ac.signal })),
        );
        if (ac.signal.aborted || mine !== gen) return;
        // TODAY's answers only. Day two having a game does not make that
        // league worth re-asking about today, which is the only day the
        // tick refreshes.
        polling = all[0].answered;
        const window = dates.map((date, i) => ({
          date,
          games: onDay(all[i].games, date, i === 0),
        }));
        setDays(window);
        setState("ready");
        // Painted first, extended after. The window is the answer to "what
        // is on"; reaching ahead is a second, slower question, and holding
        // the board back for it would make every narrowed board wait on a
        // league that has nothing to say.
        if (reach) void loadAhead(window);
      } catch {
        if (ac.signal.aborted) return;
        // Only the first load has nothing to fall back on.
        setState((s) => (s === "ready" ? "ready" : "error"));
      }
    };

    /**
     * The followed leagues with nothing in the window, reached forward.
     *
     * The BARE scoreboard, which needs no new endpoint: asked without a
     * date, ESPN answers with a league's next fixture however far out that
     * is. Confirmed against the live endpoint on 2026-08-03 — NFL came back
     * 2026-08-07, the Premier League and F1 2026-08-21, the NHL 2026-09-19
     * and the NBA 2026-10-03, which matches the published calendar. espn.ts
     * has documented this behaviour all along as a hazard ("a league
     * between matchdays hands back its NEXT one"); here it is the feature.
     *
     * Failure is silent on purpose. The window is already on screen and
     * correct; a league we could not reach ahead for is a missing extra
     * rather than a broken board.
     */
    const loadAhead = async (window: Day[]) => {
      const mine = ++aheadGen;
      const onBoard = window.flatMap((d) => d.games);
      // Every path that put something on the board. A tournament is served
      // by two of them, so it clears both.
      const covered = new Set(
        onBoard.flatMap((g) => (isTournament(g) ? g.keys : [g.leagueKey])),
      );
      /**
       * Followed CLUBS actually present in the window, which is a different
       * question from their league being present (#40).
       *
       * A club follow puts its LEAGUE on the wire, so a mid-season league
       * covers its own path and the league half above finds nothing missing.
       * The club can still be idle all three days, and before this the board
       * then said "no fixtures published, not even further out", which was
       * false, because nothing had ever asked.
       */
      const { missing, clubsByLeague } = reachTargets(
        paths,
        clubKeys,
        onBoard,
        covered,
      );
      if (missing.length === 0 && clubsByLeague.size === 0) return;
      // The last day already drawn. Anything at or before it is either
      // already on the board or was filtered off it for a reason.
      const edge = dates[dates.length - 1];

      /** The league half: "what is next", one bare call each. */
      const reachLeagues = async (): Promise<Game[]> => {
        if (missing.length === 0) return [];
        // `ahead` changes the SHAPE a racing league comes back in: one
        // weekend rather than its five sessions. See fetchLeague.
        const { games } = await fetchBoard(missing, {
          signal: ac.signal,
          ahead: true,
        });
        return games;
      };

      /**
       * The club half: a bounded window, then find the club in it.
       *
       * Asked per LEAGUE rather than per club, so following six clubs in one
       * league is one request. A bare call cannot serve this: it answers
       * with the league's next fixture, which is somebody else's game.
       */
      const reachClubs = async (): Promise<Game[]> => {
        if (clubsByLeague.size === 0) return [];
        const per = await Promise.all(
          [...clubsByLeague].map(async ([league, wanted]) => {
            const { games } = await fetchBoard([league], {
              signal: ac.signal,
              withinDays: CLUB_REACH_DAYS,
            });
            // Only this club's games, and only its NEXT one: a fortnight of
            // Premier League is six fixtures and five of them are noise.
            const mineOnly = games
              .filter((g) => gameTeamKeys(g).some((k) => wanted.has(k)))
              .sort((a, b) => a.start.getTime() - b.start.getTime());
            const first = new Map<string, Game>();
            for (const g of mineOnly)
              for (const k of gameTeamKeys(g))
                if (wanted.has(k) && !first.has(k)) first.set(k, g);
            return [...new Set(first.values())];
          }),
        );
        return per.flat();
      };

      // allSettled, not all: the two halves answer independently and one
      // failing must not throw the other away. Follow an off-season racing
      // league and a mid-season club, have the racing request fail once, and
      // Promise.all discarded the club fixture that had already arrived.
      // The rest of this layer already works this way (espn.ts's fetchBoard).
      const settled = await Promise.allSettled([reachLeagues(), reachClubs()]);
      if (ac.signal.aborted || mine !== aheadGen) return;
      const fromLeagues =
        settled[0].status === "fulfilled" ? settled[0].value : null;
      const fromClubs =
        settled[1].status === "fulfilled" ? settled[1].value : null;
      // Whether the reach actually ANSWERED, which the empty-state copy needs
      // and could not previously tell: a silent catch left `ahead` empty and
      // the board then asserted that nothing was published anywhere.
      setReachFailed(fromLeagues === null || fromClubs === null);
      {
        const seen = new Set<string>();
        const later = [...(fromLeagues ?? []), ...(fromClubs ?? [])]
          .filter((g) => midnight(g.start) > edge.getTime())
          // A club's next game can also be its league's next game, and both
          // halves would then carry it.
          .filter((g) => !seen.has(g.id) && (seen.add(g.id), true))
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        setAhead(later);
      }
    };

    const loadToday = async () => {
      const mine = ++gen;
      // Captured BEFORE the await. `dates` is reassigned when the local
      // date rolls, and this closure reads it again afterwards, so a
      // request in flight across midnight stamped yesterday's fixtures
      // with today's date and filtered them through today.
      const d0 = dates[0];
      // Captured for the same reason d0 is: `polling` is reassigned by
      // loadAll, and a tick that started before a date roll must not be
      // scored against the new day's list.
      const asking = polling;
      try {
        const { games } = await fetchBoard(asking, {
          date: d0,
          signal: ac.signal,
        });
        if (ac.signal.aborted || mine !== gen) return;
        setDays((prev) =>
          prev.length === 0
            ? prev
            : [
                {
                  date: d0,
                  games: keepStable(prev[0].games, onDay(games, d0, true)),
                },
                ...prev.slice(1),
              ],
        );
      } catch {
        // Keep what is on screen. The next tick will try again.
      }
    };

    const refresh = () => {
      // A new day is a new board, not a new score: today's fixtures are a
      // different set, and days two and three have shifted under it.
      if (rolled()) {
        dates = makeDates();
        void loadAll();
      } else {
        void loadToday();
      }
    };

    const nextDelay = () => pollDelay(watchingRef.current);

    const tick = () => {
      if (!document.hidden) refresh();
      timer = window.setTimeout(tick, nextDelay());
    };

    /**
     * The fetch list changed, so what is on screen answers the PREVIOUS
     * question and must not be shown through the NEW filter.
     *
     * `loadAll` already cleared `ahead` and never cleared these, which is an
     * asymmetry that made the bug worse rather than smaller. Star an
     * off-season league on an unnarrowed board and the old all-leagues
     * result gets filtered to nothing while `state` is still "ready", so the
     * screen confidently says "Formula 1 has no fixtures published, not even
     * further out" — for the whole duration of a fetch that is about to
     * disprove it.
     *
     * Only here, in the effect body, and deliberately NOT inside `loadAll`:
     * a date roll calls that too, and there the right behaviour is to keep
     * yesterday's scores on screen until the new day answers.
     */
    setState("loading");
    setDays([]);
    setReachFailed(false);
    void loadAll();
    refreshRef.current = refresh;
    timer = window.setTimeout(tick, nextDelay());

    // Coming back to the app after a while: the board on screen is stale by
    // however long it was away, so read it again rather than waiting out
    // the rest of the interval.
    const onVisible = () => {
      // Also the likeliest moment to discover the date rolled: the app was
      // in the background all night.
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ac.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `reach` belongs here even though nothing can flip it alone today:
    // it changes with `narrowed`, which also changes `key` and `dayCount`,
    // so the effect already re-runs. Leaving it out would make that a
    // coincidence the next caller has to know about.
  }, [dayCount, key, teamKey, reach]);

  /**
   * The next five days, appended.
   *
   * Outside the effect on purpose: it must not tear the poll down or abort
   * the board, and the days it adds have to survive both the 90 second tick
   * and a re-render. It reads the horizon off a ref rather than off `extra`
   * so its identity stays stable for the button.
   *
   * No AbortController: the only thing this writes is an append, a second
   * click is refused by `busy` while one is in flight, and a date roll
   * clears `extra` from loadAll anyway. An abort would buy a torn-down
   * fetch whose result was already going to be dropped.
   */
  const extraRef = useRef<Day[]>(extra);
  extraRef.current = extra;
  const busy = useRef(false);
  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setMoreState("loading");
    try {
      const paths = key ? key.split(",") : [];
      const leagues = Math.max(1, paths.length);
      /**
       * How far one click may walk.
       *
       * A GAME target, not a day count, because days are wildly uneven: a
       * college football week is four empty days and a Saturday with forty
       * games on it. Fifty is Adam's number and it reads as "a big list".
       *
       * The request cap is what keeps that honest. Every day costs one ask
       * per league, so a narrowed board (one or two paths) can walk two
       * months for the same money an unnarrowed one spends on a single day
       * across all 151 catalog leagues. Bounded by asks rather than by days
       * so the two cannot diverge.
       */
      const maxDays = Math.max(dayCount, Math.floor(MORE_ASKS / leagues));
      const batch = Math.max(1, Math.min(dayCount, maxDays));
      const from = dayCount + extraRef.current.length;

      const got: Day[] = [];
      let games = 0;
      let walked = 0;
      // Sequential on purpose: each batch decides whether the next one is
      // needed, and stopping early is the point.
      while (games < MORE_GAMES && walked < maxDays) {
        const n = Math.min(batch, maxDays - walked);
        const dates = Array.from({ length: n }, (_, i) => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + from + walked + i);
          return d;
        });
        const all = await Promise.all(
          dates.map((date) => fetchBoard(paths, { date })),
        );
        for (const [i, date] of dates.entries()) {
          // `false`: onDay's third argument is "is this today", and by
          // construction none of these are.
          const day = { date, games: onDay(all[i].games, date, false) };
          got.push(day);
          games += day.games.length;
        }
        walked += n;
      }
      setExtra((prev) => [...prev, ...got]);
      setMoreState("idle");
    } catch {
      setMoreState("error");
    } finally {
      busy.current = false;
    }
  }, [key, dayCount]);

  return { days, extra, ahead, state, reachFailed, loadMore, moreState };
}

/**
 * Two network lists, treated as equal when they say the same thing.
 *
 * Absent and empty are the same claim here, and they both arise: a game the
 * map has never been asked about carries no field at all, and one whose
 * league has no row carries an empty list. Telling them apart would hand a
 * new object to every unmapped card on the board on the first resolve, which
 * is exactly the memo-breaking churn keepStable exists to prevent.
 */
function sameNames(next: string[], prev: string[] | undefined): boolean {
  const before = prev ?? [];
  return (
    next.length === before.length && next.every((n, i) => n === before[i])
  );
}

/** Local midnight of whatever day this instant falls on, as a number. */
function midnight(when: Date): number {
  const d = new Date(when);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Carry the PREVIOUS object forward for every game that has not changed.
 *
 * A refresh builds all-new Game objects out of all-new JSON, so every card
 * gets a new prop and re-renders even on the overwhelmingly common tick
 * where nothing moved. Measured on the layout rig, one tick over a 168-card
 * board: 584 DOM mutations and an 86ms long task, and every single one of
 * those mutations was react-parallax-tilt rewriting its own inline
 * transform. No text, no score, nothing a viewer could see.
 *
 * Reference equality is what React.memo on the cards reads, so preserving
 * identity here is what makes that memo work. Deliberately exact: any
 * difference at all, down to a venue string, hands back the new object and
 * the card re-renders. This can only ever skip work that would have
 * produced an identical card.
 */
export function keepStable(prev: Game[], next: Game[]): Game[] {
  if (prev.length === 0) return next;
  const before = new Map(prev.map((g) => [g.id, g]));
  return next.map((game) => {
    const old = before.get(game.id);
    // Cheap and total: Date serialises to its instant, and every field the
    // cards read is JSON. An unstable key order cannot arise because both
    // objects are built by the same mapper.
    return old && JSON.stringify(old) === JSON.stringify(game) ? old : game;
  });
}

/**
 * Fill in each game's channels from the user's catalog.
 *
 * Kept OUT of the fetching hook on purpose: the schedule and the channel
 * list arrive on their own schedules, and folding them together would mean
 * re-reading ESPN every time the guide refreshed.
 *
 * Identity is preserved where the answer has not changed, for the same
 * reason keepStable exists: the cards are memoised on it, and a board whose
 * channels resolved identically must not re-render.
 */
/**
 * What each raw game resolved to, per catalog.
 *
 * The identity fix, and it is here because of WHERE this function is
 * called. `SportsScreen` re-runs it over `raw` — the hook's own list —
 * every time that array changes identity, which is every 90 second tick.
 * Raw games always carry `channels: []`, so the `unchanged` check below can
 * never match for a game that FOUND a channel: it minted a new object every
 * tick, for exactly the cards worth memoising, and undid the work
 * `keepStable` had just done to preserve them.
 *
 * A cache keyed on the raw object closes it: `keepStable` hands the same
 * object back when nothing moved, so the same object resolves to the same
 * answer. WeakMaps both ways, so a game that falls off the board and a
 * catalog that gets rebuilt are both collectable.
 *
 * The `unchanged` check stays, because it is still the right answer when
 * this IS fed its own output — which the tests do and the app does not.
 */
const RESOLVED = new WeakMap<Catalog, WeakMap<Game, Game>>();

export function withChannels(games: Game[], catalog: Catalog | null): Game[] {
  // Not "no channels": not KNOWN yet. The cards say so rather than
  // guessing.
  //
  // Identity is preserved as carefully here as on the resolved path below,
  // and for the same reason: the cards are memoised on it. Marking is a
  // one-time transition, so once every game carries the flag this returns
  // the array it was given and a refresh mid-load re-renders nothing.
  if (!catalog) {
    if (games.every((g) => g.channelsPending)) return games;
    return games.map((g) =>
      g.channelsPending ? g : { ...g, channelsPending: true },
    );
  }
  let cache = RESOLVED.get(catalog);
  if (!cache) {
    cache = new WeakMap();
    RESOLVED.set(catalog, cache);
  }
  const memo = cache;
  return games.map((game) => {
    const already = memo.get(game);
    if (already) return already;
    // The CARD only counts what we are sure of. A 40% match is a candidate
    // for the rail, where its score is visible; putting it behind "Live on
    // 3 channels" would be the silent wrongness plan 010 warns about.
    // A channel that names THIS fixture beats any channel that merely
    // carries the network showing it, so it goes first and is never
    // displaced by a national feed's ordering.
    // Naming the FIXTURE only works where there is one. A race listing
    // says "Formula 1 Dutch Grand Prix", not two team names, and a
    // tournament listing says "National Bank Open", so both resolve off
    // their broadcasts alone until racing gets its own matcher path (plan
    // 010 #5) and a tournament gets one with it.
    const named = isFixture(game)
      ? matchEvent([game.home.name, game.away.name], game.start, catalog)
      : [];
    const seen = new Set(named.map((c) => c.id));
    // preferVisible over the COMBINED list, because the hidden-folder rule
    // is decided per GAME and not per source. `matchGame` applies it to the
    // networks it was given, but `matchEvent` never reads `hidden` at all,
    // so a fixture-named channel from a folder the viewer muted used to walk
    // straight past the rule and LEAD the card — "Live on 2 channels", no
    // mention of the hidden folder, tuning the hidden one first.
    let found = preferVisible([
      ...named,
      ...matchGame(game.broadcasts, catalog).filter((c) => !seen.has(c.id)),
    ]).filter((c) => c.confidence >= CARD_CONFIDENCE);
    /**
     * THE CURATED MAP, and only where the source said NOTHING AT ALL.
     *
     * A fallback rather than another input, which is the whole shape of the
     * decision. Feeding the map's names in alongside the real broadcasts
     * would let a league-wide guess sit next to, and sometimes above, a
     * stated fact about this fixture — and the schedule's own ordering
     * (national feed before regional) is information the map does not have
     * and would dilute. Consulted last, it can only ever fill a gap.
     *
     * THE GATE IS AN EMPTY RESULT, not an empty `broadcasts`, and that is a
     * reversal worth explaining because the first version was argued for at
     * length.
     *
     * It used to require that the schedule had named nobody at all. The
     * reasoning was matcher.ts's MLB.TV rule: a schedule naming a
     * particular feed is telling you the game is NOT on the ordinary one,
     * so talking over "On Peacock" with a league-wide guess is how a
     * confident wrong answer gets made. That rule is still true. It was
     * answering a different question, though — it assumed the guess would
     * REPLACE what the source said, and it does not have to. The card now
     * carries both, "On Paramount+ · Usually found on US: CBS Sports
     * Network", so nothing the schedule told us is discarded and the word
     * "usually" does the hedging.
     *
     * Adam settled it on the ground that matters: "people don't care that
     * ESPN didn't have a channel listed, just if it links to their EPG or
     * not." A stated network nobody carries is a fact you cannot act on,
     * and it was costing a pressable channel we already knew about. It is
     * also the call he made for the theater rail — "more to choose from is
     * always preferred when sources go awry" — one level up.
     *
     * One join and one confidence model all the same: these go through
     * matchGame exactly as the source's names do, clear the same bar, and
     * arrive as the same Match objects. What differs is the CLAIM, and that
     * rides on `presumedOnly` rather than on a fudged score. A score cannot
     * carry it: deduct enough to mean "this is a guess" and every presumed
     * match falls under CARD_CONFIDENCE and the card goes silent, which is
     * where we started. The doubt here is about carriage, not about which
     * channel we named, so it belongs in the words. See carriageText.
     */
    let presumedOnly = false;
    let presumed: string[] = [];
    if (found.length === 0) {
      presumed = [
        ...presumedNetworks(
          game.leagueKey,
          isTournament(game) ? game.title : undefined,
        ),
      ];
      if (presumed.length > 0) {
        found = matchGame(presumed, catalog).filter(
          (c) => c.confidence >= CARD_CONFIDENCE,
        );
        presumedOnly = found.length > 0;
      }
    }
    const channels = found.map((c) => ({ id: c.id, name: c.name }));
    const hiddenOnly = found.length > 0 && found.every((c) => c.hidden);
    const unchanged =
      channels.length === game.channels.length &&
      channels.every((c, i) => c.id === game.channels[i].id) &&
      hiddenOnly === (game.hiddenOnly ?? false) &&
      presumedOnly === (game.presumedOnly ?? false) &&
      sameNames(presumed, game.presumed) &&
      !game.channelsPending;
    const out: Game = unchanged
      ? game
      : {
          ...game,
          channels,
          hiddenOnly,
          presumedOnly,
          presumed,
          channelsPending: false,
        };
    memo.set(game, out);
    return out;
  });
}
