import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { useMouseNav } from "../../lib/mouseNav";
import { Matchup } from "./Matchup";
import { CompactCard } from "./CompactCard";
import { matchEvent, matchGame } from "./matcher";
import type { Catalog, Match } from "./matcher";
import type { Game } from "./model";

/**
 * Theater: one game, the player, and the ways into it (plan 010).
 *
 * The hub has two modes and this is the second. The board answers "what is
 * on"; this answers "I am watching this one". There is deliberately no
 * middle mode with a small player on the board: a mini player either
 * competes with the thing it sits beside or is too small to be worth the
 * room, and the board is already the place you go to stop watching.
 *
 * The video is a NATIVE window showing through a hole cut in the page, so
 * the layout is built around one rule: nothing may overlap the slot. The
 * sidebar sits beside it, never over it, and the matchup header carries no
 * chrome that could stray across the boundary.
 */
export function SportsTheater({
  game,
  others,
  catalog,
  onOpen,
  onClose,
}: {
  game: Game;
  /** The other games on now, to switch to. Not this one. */
  others: Game[];
  /** The user's channels. The rail resolves its own, rather than taking the
   * card's list: the card counts only what it is sure of, and the rail is
   * the one place a doubtful match can be shown honestly, with its score. */
  catalog: Catalog | null;
  /** Switch the theater to another game, from the live scores below. The
   * same handler the board opens a card with, so switching in here and
   * arriving from out there land in exactly the same place. */
  onOpen: (game: Game) => void;
  onClose: () => void;
}) {
  const matches = useMemo(() => {
    if (!catalog) return [];
    // Channels naming this exact fixture first, then whatever carries the
    // networks the schedule listed. Same order the card counts them in.
    const named = matchEvent(
      [game.home.name, game.away.name],
      game.start,
      catalog,
    );
    const seen = new Set(named.map((c) => c.id));
    return [
      ...named,
      ...matchGame(game.broadcasts, catalog).filter((c) => !seen.has(c.id)),
    ];
  }, [game, catalog]);

  /**
   * The other live games, by league, in the order their first one started.
   *
   * A Map keyed on the league name, because it keeps insertion order: the
   * board hands `others` over sorted by kick-off, so the league whose games
   * began earliest heads the list and every group keeps that order inside
   * itself. Nothing here re-sorts, which is the point.
   */
  const groups = useMemo(() => {
    const by = new Map<string, Game[]>();
    for (const g of others) {
      const seen = by.get(g.league);
      if (seen) seen.push(g);
      else by.set(g.league, [g]);
    }
    return [...by];
  }, [others]);

  useMouseNav(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sportstheater">
      <aside className="sportstheater__side">
        <Matchup game={game} />

        {/* Every channel of yours carrying this game. Empty until the
         * matcher exists (plan 010 phase 2): the schedule names networks
         * ("NBC", "MASN") and only a matcher can turn those into your own
         * channels. The card's "Live on 3 channels" is a promise that
         * lands here. */}
        <nav className="sportstheater__rail">
          {matches.length > 0 ? (
            matches.map((c) => <Rail key={c.id} channel={c} />)
          ) : (
            <p className="sportstheater__empty">
              {game.broadcasts.length > 0
                ? `On ${game.broadcasts.join(", ")}. None of your channels carry it.`
                : "No broadcast listed for this game."}
            </p>
          )}
        </nav>

        {groups.length > 0 && (
          <section className="sportstheater__scores">
            <h3 className="sportstheater__heading">
              <span className="gamepip" aria-hidden />
              Live Scores
            </h3>
            {/* The league, said once over its games instead of on every
              * line. The rows lost their own tag because it was the one
              * thing on them whose width the sport did not bound; as a
              * heading it has the whole width and can say "Premier League"
              * in full. */}
            {groups.map(([league, games]) => (
              <div className="sportstheater__group" key={league}>
                <h4 className="sportstheater__league">{league}</h4>
                {/* Leaning, and live. On the board a compact line is a
                  * finished game and answers the pointer with nothing,
                  * because there is nothing to choose. Here every one of
                  * them is a game running right now that you can switch
                  * to, so it gets the rail's lean and the rail's glare and
                  * opens on click.
                  *
                  * The lean is a wrapper rather than something inside the
                  * card: the card is shared with the board, and the board's
                  * copies should stay flat and cheap. */}
                {games.map((g) => (
                  <Lean className="scorelean" key={g.id}>
                    <CompactCard game={g} onOpen={onOpen} />
                  </Lean>
                ))}
              </div>
            ))}
          </section>
        )}
      </aside>

      {/* The hole. InvertedPlayer glues mpv to whatever box carries this id
       * and follows it every frame, so this needs no wiring beyond
       * existing: it stays an empty slate until a channel is chosen. */}
      <div className="sportstheater__stage">
        <div id="player-slot" className="sportstheater__slot" />
      </div>
    </div>
  );
}

/**
 * One channel, with how sure we are that it is the right one.
 *
 * The score is the point. Everything here would once have been dropped or
 * shown without qualification; a number lets a doubtful match be offered
 * honestly instead of either hidden or dressed up as certain.
 */
function Rail({ channel }: { channel: Match }) {
  const band =
    channel.confidence >= 85
      ? "sure"
      : channel.confidence >= 60
        ? "likely"
        : "doubt";
  return (
    <button type="button" className="sportsrail" title={channel.name}>
      <Lean className="sportsrail__tilt">
        {channel.logo && (
          <img
            className="sportsrail__logo"
            src={channel.logo}
            alt=""
            loading="lazy"
          />
        )}
        <span className="sportsrail__name">{channel.name}</span>
        {channel.quality && (
          <span className="sportsrail__badge">{channel.quality}</span>
        )}
        {/* The score stays put now. It used to stand aside for the play
         * mark; with the lean carrying the affordance there is nothing to
         * stand aside for, so the number stays readable throughout. */}
        <span className={`sportsrail__score is-${band}`}>
          <span className="sportsrail__bar" aria-hidden>
            <i style={{ height: `${channel.confidence}%` }} />
          </span>
          <span className="sportsrail__pct">{channel.confidence}%</span>
        </span>
      </Lean>
    </button>
  );
}

/**
 * The panel's lean and glare, over anything row-shaped in it.
 *
 * One component rather than the props twice, because both users are the
 * same shape to within a few pixels: the channel row is 344x62 and the
 * score line 344x65. Tilt reads its angles as degrees and the eye reads
 * them as pixels swept at the corner, so two rows this alike must not be
 * given different numbers.
 *
 * The angles are deliberately NOT the cards' numbers. Half-width times
 * sin(3deg) is 8.9px and half-height times sin(6deg) is 3.2px, which lands
 * on the wide card's own 10.3 and 3.6. Copying its 1.5deg would have been
 * almost no movement at this size.
 *
 * The glare's radius is the pill's, and both rows are pills. It is its own
 * layer with its own clip, so a mismatch shows as a square sheen poking out
 * of a round corner.
 */
function Lean({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <Tilt
      className={className}
      tiltEnable={!REDUCED_MOTION}
      tiltMaxAngleX={6}
      tiltMaxAngleY={3}
      scale={REDUCED_MOTION ? 1 : 1.015}
      transitionSpeed={650}
      glareEnable={!REDUCED_MOTION}
      glareMaxOpacity={0.1}
      glarePosition="all"
      glareBorderRadius="100px"
    >
      {children}
    </Tilt>
  );
}
