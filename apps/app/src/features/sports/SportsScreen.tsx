import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RowScroller } from "../stream/StreamScreen";
import {
  loadCompactResults,
  saveCompactResults,
} from "../settings/compactResults";
import { CompactCard } from "./CompactCard";
import { RaceCard } from "./RaceCard";
import { GolfCard } from "./GolfCard";
import { TournamentCard } from "./TournamentCard";
import { TournamentDraw } from "./TournamentDraw";
import { WeekendCard } from "./WeekendCard";
import { WideRaceCard } from "./WideRaceCard";
import { SportsSidebar } from "./SportsSidebar";
import { fetchList, isFollowed, loadFollows, resolvable } from "./follows";
import { GameCard } from "./GameCard";
import { dayLabel, nowish } from "./day";
import { SportsTheater } from "./SportsTheater";
import { UpcomingCard } from "./UpcomingCard";
import { useCatalog } from "./catalog";
import { ALL_LEAGUES, league as byPath } from "./leagues";
import type { CatalogLeague } from "./leagues";
import { SportsEmpty, BoardSkeleton } from "./SportsEmpty";
import { nameList } from "./nameList";
import { useGames, withChannels } from "./useGames";
import type { Day } from "./useGames";
import { isField, isFixture, isTournament, isWeekend } from "./model";
import { unlinkedReason } from "./unlinked";
import type { Field, Fixture, Game, Tournament } from "./model";

/**
 * The Sports hub (plan 010): games as the objects, your channels hanging
 * off them.
 *
 * Two ways of looking at the same day, on purpose:
 *
 *   the ROW    today as a timeline, in kick-off order, the way a guide
 *              reads. Wide cards, opened on whatever is on now. This is
 *              for "what should I watch".
 *   the GRIDS  a day at a time, all of it visible at once, small cards.
 *              This is for "what is on", and it is the only shape that
 *              works for days that have not happened yet.
 *
 * Today appears in both. That is not duplication: the row answers a
 * question about now and the grid answers one about the day.
 *
 * Opening a game replaces the board with the theater. Two modes and no
 * third: a small player on the board would either compete with the board
 * or be too small to be worth the room, and the board is already where you
 * go to stop watching.
 */

/**
 * How far in from the row's left edge the anchor game sits, when the
 * stylesheet has not been read yet. The real value is --sports-lead, which
 * also sizes the scroller's trailing padding; taking it from there is what
 * keeps the two ends of that arrangement agreeing.
 *
 * Not zero: the previous game peeks past it, which is what says the day
 * carries on behind you rather than starting here.
 */
const LEAD_FALLBACK = 96;

export function SportsScreen({ home }: { home?: number } = {}) {
  /**
   * What you follow, and therefore what the board FETCHES and then shows.
   *
   * FOLLOWING IS FILTERING was only half of it, and D1 supplied the other
   * half: what you follow is also the fetch list, over the 151-league
   * catalog rather than five hardcoded leagues. Nothing followed asks for
   * the default five and narrows nothing, so first run is still a full
   * screen rather than an empty one asking to be configured.
   *
   * The filter is applied AFTER withChannels rather than before, which
   * costs a little matcher work on games that are about to be dropped and
   * buys the club list its full set — the sidebar offers every club the
   * board loaded, not only the ones already surviving the filter it is
   * trying to change.
   */
  const [follows, setFollows] = useState(loadFollows);
  /**
   * Only the follows that still name a league the catalog carries.
   *
   * Stored follows are foreign keys into it, and a key that no longer
   * resolves must not be able to filter the board: see resolvable(). The
   * sidebar keeps the RAW store, so toggling still writes what the user
   * has, and a key that starts resolving again (a regenerated catalog
   * bringing a league back) simply starts counting again.
   */
  const active = useMemo(
    () => resolvable(follows, ALL_LEAGUES.map((l) => l.path)),
    [follows],
  );
  /**
   * The leagues the board is NARROWED to, which is a different question
   * from which ones you follow.
   *
   * Adam's, fixing a collision: a row and its star both favourited, so the
   * picker could not say "just show me this". Following is what you keep;
   * picking is what you are looking at, and it is multi-select.
   *
   * Deliberately NOT persisted. A narrowing set on Tuesday should not still
   * be hiding half the board on Friday, where a favourite should.
   */
  const [picked, setPicked] = useState<string[]>([]);
  /**
   * What actually narrows the board: an explicit pick if there is one,
   * otherwise what you follow.
   *
   * A pick OVERRIDES follows rather than intersecting them, which is what
   * makes it useful — clicking a league you do not follow has to be able to
   * show it, or the control does nothing on the 146 leagues that are not
   * favourites. Nothing picked and nothing followed still means everything.
   */
  const shown = useMemo(
    () => (picked.length > 0 ? { leagues: picked, teams: [] } : active),
    [picked, active],
  );
  const narrowed = shown.leagues.length > 0 || shown.teams.length > 0;
  /**
   * What the empty state names when the filter is hiding everything.
   *
   * The LEAGUES by their short labels, plus the clubs as a count. A club
   * follow pulls its whole league onto the wire, so naming eleven clubs
   * here would be listing the filter rather than the thing that came back
   * empty, and "3 clubs" is the honest summary of that half.
   */
  const [followedNames, followedCount] = useMemo(() => {
    const labels = active.leagues
      .map(byPath)
      .filter((l): l is CatalogLeague => l !== undefined)
      .map((l) => l.label);
    const clubs = active.teams.length;
    if (clubs > 0) labels.push(`${clubs} ${clubs === 1 ? "club" : "clubs"}`);
    return [nameList(labels), labels.length] as const;
  }, [active]);
  /** Bumped by the empty state's way out. See SportsSidebar's `reveal`. */
  const [reveal, setReveal] = useState(0);
  // Off the RESOLVABLE follows, not the raw store: a path the catalog no
  // longer carries is not a URL worth asking ESPN for.
  const leagues = useMemo(() => fetchList(shown), [shown]);
  /**
   * TODAY AND TOMORROW on the wide board, three days once it is narrowed.
   *
   * Adam's, and the arithmetic backs it: with nothing followed the fetch
   * list is all 151 catalog leagues, so each extra day is another 151
   * requests for a day almost nobody scrolls to before they have said what
   * they like. Two days is 302 and it measured at 5.5 MB and eight to
   * thirty-eight seconds depending on how warm the connection was.
   *
   * A narrowed board is a handful of leagues, so the third day is nearly
   * free there and it is the one people actually plan against.
   */
  // The game being watched, or nothing. Deliberately NOT in the view stack:
  // this is a mode of one screen, and its own Escape and mouse-back close
  // it without touching where you came from to get here.
  //
  // Declared ABOVE useGames because the poll cadence reads it (#23), which
  // is the only reason it is not down with the other view state.
  const [open, setOpen] = useState<Fixture | null>(null);
  const {
    days: raw,
    extra: rawExtra,
    ahead: rawAhead,
    state,
    reachFailed,
    loadMore,
    moreState,
  } = useGames(
    leagues,
    // FIVE when the board is narrowed, two when it is not, and the gap is
    // the fetch list rather than a preference: a narrowed board asks one or
    // two league paths, an unnarrowed one asks all 151 in the catalog. Five
    // days of that is 755 requests. Three was too few even narrowed — a
    // college football Thursday eight days out showed two of eleven games,
    // because everything past day three fell to the reach, which answers
    // with a league's NEXT fixture rather than its slate.
    narrowed ? 5 : 2,
    // The CLUBS being shown, so an idle one can reach ahead for itself (#40).
    // Empty when an explicit league pick is overriding follows, which is
    // right: that pick is about leagues and says nothing about clubs.
    shown.teams,
    narrowed,
    // A game in the theater slows the poll rather than stopping it (#23).
    // The DRAW is not here: a tournament bracket is not playback and is not
    // competing with a stream for the connection.
    Boolean(open),
  );
  // The schedule and the channel list arrive independently, so they are
  // joined here rather than inside either one. Memoised on both: resolving
  // a 42-game board costs 4.7ms against a 20k-channel index and 3.7 SECONDS
  // without one, so it must not happen per render.
  const catalog = useCatalog();
  const days = useMemo(() => {
    const withChans = raw.map((d) => ({
      ...d,
      games: withChannels(d.games, catalog),
    }));
    if (!narrowed) return withChans;
    return withChans.map((d) => ({
      ...d,
      games: d.games.filter((g) => isFollowed(g, shown)),
    }));
  }, [raw, catalog, shown, narrowed]);
  /**
   * The paged-in days, through the same two steps the window gets: channels
   * resolved against the guide, then the follow filter. Kept as its own
   * memo rather than concatenated before `days` so a "Show more" does not
   * re-run the window's join, which is the expensive one.
   */
  const extra = useMemo(() => {
    const withChans = rawExtra.map((d) => ({
      ...d,
      games: withChannels(d.games, catalog),
    }));
    if (!narrowed) return withChans;
    return withChans.map((d) => ({
      ...d,
      games: d.games.filter((g) => isFollowed(g, shown)),
    }));
  }, [rawExtra, catalog, shown, narrowed]);
  /**
   * The reached-ahead games, through the same two steps the window gets.
   *
   * A Grand Prix in November has channels resolved against the guide like
   * anything else, and it has to survive the follow filter for the same
   * reason: a team follow pulls its whole league onto the wire, so the
   * reach can bring back a club nobody asked about.
   */
  const ahead = useMemo(() => {
    const withChans = withChannels(rawAhead, catalog);
    return narrowed
      ? withChans.filter((g) => isFollowed(g, shown))
      : withChans;
  }, [rawAhead, catalog, shown, narrowed]);
  /** Every club the board LOADED, ahead of the filter. */
  const clubPool = useMemo(() => raw.flatMap((d) => d.games), [raw]);
  // Memoised, not because building it is expensive but because `?? []`
  // mints a new array on every render and rowItems is derived from it.
  const today = useMemo(() => days[0]?.games ?? [], [days]);

  const live = today.some((g) => g.state === "live");
  /**
   * What the ROW carries, which is not everything today has.
   *
   * Fixtures always. Anything that is not one only while it is RUNNING,
   * which is Adam's rule for a race weekend (plan 010 #4): the row is a
   * short list of what to watch now, a Friday practice that has finished is
   * a thing that happened, and the grids below are where things that
   * happened live. On race day the Grand Prix is then the first thing
   * anyone scans.
   *
   * A TOURNAMENT IS NOT ON THE ROW AT ALL, which is a shape problem rather
   * than a rule. Everything here is a wide card at 783.84px and the
   * tournament card is the grid's 315px, so letting a live one through put
   * a narrow card between two wide ones and stretched it to the row's
   * height: measured at 315x276.9 against its neighbours' 783.84x276.9.
   * A wide tournament card is a real design question (plan 010 #39) and
   * not one to answer by accident. The grid below carries them meanwhile,
   * which is where a thing made of 39 matches belongs anyway.
   */
  const rowItems = useMemo(
    () =>
      today.filter(
        // Positive on both arms. Written as "not a tournament and live" it
        // also happened to exclude a reached-ahead weekend, but only
        // because those are always `pre` — a runtime coincidence standing
        // in for a rule, which is the exact shape of the bug the union's
        // narrowing discipline exists to prevent.
        (g): g is Fixture | Field =>
          isFixture(g) ||
          // Golf has no WIDE card yet, and WideRaceCard would draw it as a
          // race: a lap slot with nothing in it and three entrants where
          // the leaderboard needs five. The grid carries it meanwhile, the
          // same holding position tournaments are in (#39).
          (isField(g) && g.state === "live" && g.sport !== "golf"),
      ),
    [today],
  );

  /**
   * What the row opens on — picked from `rowItems`, NOT from the whole day.
   *
   * `nowish` does not narrow by kind, so on a tennis day it happily returned
   * the live Tournament, which the row deliberately excludes. The querySelector
   * then found nothing, the effect bailed before recording anything, and the
   * row sat at scrollLeft 0 for the rest of the day. Tennis was 84% of the
   * board when that was last measured, so "the rest of the day" was most days.
   */
  const anchor = nowish(rowItems);

  const row = useRef<HTMLDivElement>(null);
  // The id we last scrolled to, NOT a "did it once" flag: the board
  // refreshes every 90 seconds, and re-centring on each of those would
  // shove the row out from under anyone reading it. It moves when the
  // anchor genuinely changes, which is when a game starts or ends.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || centred.current === anchor.id) return;
    const card = row.current?.querySelector<HTMLElement>(
      `[data-game="${anchor.id}"]`,
    );
    const box = card?.closest<HTMLElement>(".media-row__scroller");
    if (!card || !box) return;
    centred.current = anchor.id;
    // Measured off rectangles rather than offsetLeft, which is relative to
    // whichever ancestor happens to be positioned. Instantly, not
    // smoothly: this is where the row starts, not somewhere it travels to.
    const lead =
      Number.parseFloat(
        getComputedStyle(box).getPropertyValue("--sports-lead"),
      ) || LEAD_FALLBACK;
    const c = card.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollLeft += c.left - b.left - lead;
  }, [anchor]);

  // One question again. It used to be two, because racing arrived through
  // a side door and a board carrying only race cards was not empty but
  // looked it. Racing is in `days` now, so a day with anything on it has
  // games in it and this reads straight.
  const anything =
    days.some((d) => d.games.length > 0) || ahead.length > 0;
  /**
   * A board full of games and not one of them on a channel you have (#21).
   *
   * The cards already say "Couldn't link" one at a time, which is the right
   * answer per game and the wrong one when it is true of every game on the
   * screen: at that point the cause is the setup rather than this fixture,
   * and repeating it twenty times says so twenty times without ever saying
   * it once.
   *
   * Scoped to games you could actually WATCH. A finished game's carriage
   * line is its start time, not a channel, so counting finals would fire
   * this on any evening whose board had already played out.
   *
   * Held back until the catalog has loaded. `channelsPending` is the
   * difference between "not on your channels" and "not known yet", and
   * announcing the first while the second is true is the exact flash
   * useCatalog's warm start exists to avoid.
   */
  const unlinked = useMemo(
    () =>
      unlinkedReason(
        [...days.flatMap((d) => d.games), ...ahead],
        catalog?.size ?? 0,
      ),
    [days, ahead, catalog],
  );
  // Read once and kept here: it is a display choice about this screen, so
  // it belongs to the screen rather than to every card in it.
  const [compact, setCompact] = useState(loadCompactResults);
  /**
   * The tournament whose draw is open, which is a different mode from the
   * theater and deliberately not the same state.
   *
   * The theater is for WATCHING one fixture; this is for READING 39
   * matches, and nothing in it plays. Sharing `open` would have meant every
   * consumer of it asking which kind it was holding.
   */
  const [openDraw, setOpenDraw] = useState<Tournament | null>(null);
  /**
   * The card that opened the theater, so focus can come back to it.
   *
   * Measured: opening dropped focus to BODY, and closing dropped it to BODY
   * again, so a keyboard user re-entered the board at tab stop one and had
   * to walk the whole row back to where they were. LiveScreen already
   * solves this the same way with its menu invoker.
   */
  const invoker = useRef<string | null>(null);
  useEffect(() => {
    if (open || openDraw) return;
    const id = invoker.current;
    if (!id) return;
    invoker.current = null;
    const el = document.querySelector<HTMLElement>(`[data-game="${id}"]`);
    // The first match, which for a game that is on both the row and
    // today's grid is the row's copy. Same game, in view, at the top of the
    // board: a reasonable landing even when the grid card was the invoker.
    // Guarded: the board refreshes, and the card may not have come back.
    if (el?.isConnected) el.focus();
  }, [open, openDraw]);
  /**
   * Opening a card puts it in the theater.
   *
   * `useCallback` with no deps, and it is load-bearing rather than tidy.
   * Every card on the board is `memo()`d and takes this as `onOpen`, so a
   * fresh arrow here fails React's shallow compare before it ever looks at
   * `game` — which threw away the identity `keepStable` and `withChannels`
   * both exist to preserve, and re-rendered the whole board on every 90
   * second tick. Empty deps are correct: both only touch a ref and a
   * setState, and neither closes over anything that moves.
   *
   * FIXTURES ONLY, and the guard is real rather than defensive: no race
   * card is clickable yet, so nothing can call this with a field, but the
   * theater's whole header is two badges and two names and it would have
   * nothing to draw. Racing reaches the theater in #5, which is where the
   * rail learns to match on a series instead of on team names.
   */
  const openGame = useCallback((g: Game) => {
    if (!isFixture(g)) return;
    invoker.current = g.id;
    setOpen(g);
  }, []);
  /** The same, for a day of a tournament. Focus comes back to the card. */
  const openTournament = useCallback((t: Tournament) => {
    invoker.current = t.id;
    setOpenDraw(t);
  }, []);
  /**
   * Pressing the Sports chip returns to the board.
   *
   * It is the only thing on screen that looks like a way out of the
   * theater, and while the theater was open it did nothing at all: the tab
   * was already "sports", so setting it again changed no state. The header
   * counts the press instead, and this closes on the count changing. Skips
   * the first run, which is the mount.
   */
  const pressed = useRef(home);
  useEffect(() => {
    if (pressed.current === home) return;
    pressed.current = home;
    setOpen(null);
    setOpenDraw(null);
  }, [home]);
  const toggleCompact = () => {
    setCompact((on) => {
      saveCompactResults(!on);
      return !on;
    });
  };

  if (openDraw) {
    // Re-read from the refreshed board, same as the theater does, so a
    // match going live while the draw is open moves section rather than
    // freezing at whatever it was when it was opened.
    const current =
      days
        .flatMap((d) => d.games)
        .find((g): g is Tournament => isTournament(g) && g.id === openDraw.id) ??
      openDraw;
    return <TournamentDraw event={current} onClose={() => setOpenDraw(null)} />;
  }

  if (open) {
    // Re-read from the refreshed board so the theater follows the game's
    // STATE, not its score: the header carries two badges and two names and
    // no numbers at all. Fall back to the game as opened if it drops off
    // the day (it will not, but the board is a network read).
    const current =
      today.find((g): g is Fixture => isFixture(g) && g.id === open.id) ?? open;
    return (
      <SportsTheater
        game={current}
        others={today.filter(
          (g): g is Fixture =>
            isFixture(g) && g.state === "live" && g.id !== current.id,
        )}
        catalog={catalog}
        onOpen={openGame}
        onClose={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="sportsboard">
      <SportsSidebar
        games={clubPool}
        follows={follows}
        onFollows={setFollows}
        picked={picked}
        onPick={(path) =>
          setPicked((was) =>
            was.includes(path)
              ? was.filter((p) => p !== path)
              : [...was, path],
          )
        }
        onClearPicks={() => setPicked([])}
        reveal={reveal}
      />
      <div className="discover sports sportsboard__main">
      {/* Said ONCE, above the board, rather than on every card (#21). The
        * board stays: knowing a game exists is useful even when you cannot
        * watch it here, and hiding it would answer a question nobody
        * asked. */}
      {unlinked && (
        <p className="sports__unlinked" role="status">
          {unlinked === "no-playlist"
            ? "None of these are matched to channels yet. Add a playlist in Settings and BlammyTV will line these games up against it."
            : "None of these are on a channel in your playlist. The game is still on; your provider just doesn't carry the networks showing it."}
        </p>
      )}
      {rowItems.length > 0 && (
        <section className="media-row" ref={row}>
          <h3 className="media-row__title sports__title">
            {/* The pip is a claim about the world, so it only appears when
              * something is actually on. */}
            {live && <span className="gamepip" aria-hidden />}
            Today&rsquo;s Games
          </h3>
          <RowScroller>
            {rowItems.map((g) =>
              isField(g) ? (
                <WideRaceCard key={g.id} race={g} />
              ) : (
                <GameCard key={g.id} game={g} onOpen={openGame} />
              ),
            )}
          </RowScroller>
        </section>
      )}

      {[...days, ...extra].map(
        (day) =>
          day.games.length > 0 && (
            <section className="media-row" key={day.date.toDateString()}>
              <div className="sports__head">
                <h3 className="media-row__title sports__title">
                  {dayLabel(day.date)}
                </h3>
                {/* Only where it would do something. A day with nothing
                  * finished on it has no results to compact. */}
                {day.games.some((g) => g.state === "final") && (
                  <button
                    type="button"
                    className={
                      "sports__toggle" + (compact ? " is-on" : "")
                    }
                    onClick={toggleCompact}
                    aria-pressed={compact}
                  >
                    Compact results
                  </button>
                )}
              </div>
              <div className="sports__grid">
                {day.games.map((g) =>
                  isField(g) ? (
                    /* Both are Fields — an ordered list of people — and the
                     * card is the only thing that differs. Keyed on the
                     * SPORT rather than on a new union kind, because the
                     * board, the day bucketing, the follow filter and the
                     * matcher all treat them identically and a fifth kind
                     * would have forked every one of those for a render
                     * branch. */
                    g.sport === "golf" ? (
                      <GolfCard key={g.id} round={g} />
                    ) : (
                      <RaceCard key={g.id} race={g} />
                    )
                  ) : isWeekend(g) ? (
                    /* A whole weekend, reached ahead of the board's window
                     * (#36). One card with its schedule in it, not five
                     * session cards under three dated headings. */
                    <WeekendCard key={g.id} weekend={g} />
                  ) : isTournament(g) ? (
                    <TournamentCard key={g.id} event={g} onOpen={openTournament} />
                  ) : compact && g.state === "final" ? (
                    <CompactCard key={g.id} game={g} onOpen={openGame} />
                  ) : (
                    <UpcomingCard key={g.id} game={g} onOpen={openGame} />
                  ),
                )}
              </div>
            </section>
          ),
      )}

      {/* MORE DAYS, on request.
        *
        * The board opens on a few days rather than a fortnight because the
        * window asks per day per league, so its depth is a request count.
        * This buys the next chunk, the same size the board opened with.
        *
        * Under the day grids and above "Coming up", which is where it
        * belongs in the reading order: it extends the thing above it. It
        * stays put once clicked rather than disappearing, so a second click
        * goes further out — there is no end date to run out of, only days
        * with nothing on them, and those render as nothing at all. */}
      {state === "ready" && (
        <div className="sports__more">
          <button
            type="button"
            className="sports__morebtn"
            onClick={() => void loadMore()}
            disabled={moreState === "loading"}
          >
            {moreState === "loading"
              ? "Loading…"
              : moreState === "error"
                ? "Couldn't load those. Try again"
                : "Show more days"}
          </button>
        </div>
      )}

      {/* WHAT IS COMING, past the board's own window (#36).
        *
        * One section rather than a heading per date, which is what the
        * data forced: a followed racing league answers with its whole
        * remaining season, and 12 Grands Prix on 12 dates would be 12
        * headings with a single card under each. Every card in here
        * carries its own date, so the heading does not have to.
        *
        * After the day grids, always, because it is the answer to a
        * different question: those say what is on, this says what is
        * next. */}
      {ahead.length > 0 && (
        <section className="media-row">
          <h3 className="media-row__title sports__title">Coming up</h3>
          <div className="sports__grid">
            {ahead.map((g) =>
              isWeekend(g) ? (
                <WeekendCard key={g.id} weekend={g} />
              ) : isField(g) ? (
                g.sport === "golf" ? (
                  <GolfCard key={g.id} round={g} />
                ) : (
                  <RaceCard key={g.id} race={g} />
                )
              ) : isTournament(g) ? (
                <TournamentCard key={g.id} event={g} onOpen={openTournament} />
              ) : (
                <UpcomingCard
                  key={g.id}
                  game={g}
                  onOpen={openGame}
                  // "OCT 3": short, because it sits beside a kick-off time.
                  when={g.start.toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                  })}
                />
              ),
            )}
          </div>
        </section>
      )}

      {!anything &&
        (state === "loading" ? (
          <BoardSkeleton />
        ) : state === "error" ? (
          <SportsEmpty
            alert
            title="Couldn't reach the schedule."
            note="The board keeps trying on its own, so this usually clears itself. Nothing is lost while it does."
          />
        ) : narrowed ? (
          /* MUCH RARER THAN IT WAS. The board reaches past its own window
           * now (#36), so a followed league with any published fixture at
           * all puts it on the grid, however far out. Landing here means
           * every followed league answered with nothing even when asked
           * "what is next" — an off-season with no calendar yet.
           *
           * So the ask is Adam's: send them to the picker. There is no
           * clever recovery from "your leagues have published nothing", and
           * the honest move is to say so and open the door.
           *
           * THE COPY BRANCHES because the two halves reach differently
           * (#40). A league is asked "what is next" with no bound, so an
           * empty one really has published nothing at all. A club is asked
           * for a bounded fortnight, because the unbounded question cannot
           * be asked of a club, so an empty one may simply be idle for
           * longer than that. Saying "not even further out" about a club
           * was the false claim this branch exists to stop telling. */
          <SportsEmpty
            title="Nothing scheduled yet."
            note={`${followedNames} ${
              followedCount === 1 ? "has" : "have"
            } ${
              // ASKED AND NOT ANSWERED is a third case, and asserting the
              // second while it is true is how the board came to tell people
              // their league had published nothing when a request had simply
              // failed. It says so and stops claiming anything.
              reachFailed
                ? "nothing on the board, and the schedule source did not answer when asked what is next. This usually clears itself"
                : shown.teams.length > 0
                  ? "nothing on the schedule we can reach"
                  : "no fixtures published, not even further out"
            }. Favourite a few more sports and the board fills itself.`}
            action={{
              label: "Pick more sports",
              onClick: () => setReveal((n) => n + 1),
            }}
          />
        ) : (
          /* Very nearly unreachable, and kept honest rather than dropped.
           * The board asks for all 151 leagues when nothing is followed,
           * and on the day this was measured 20 of them had something on.
           * It would take a genuinely dead day everywhere to land here. */
          <SportsEmpty
            title="Nothing on today."
            note={`None of the ${ALL_LEAGUES.length} leagues has a game scheduled today or tomorrow. That is rare, so it is worth looking again shortly.`}
          />
        ))}
      </div>
    </div>
  );
}

export type { Day };
