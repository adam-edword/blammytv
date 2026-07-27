import { useEffect, useMemo } from "react";
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
  onClose,
}: {
  game: Game;
  /** The other games on now, to switch to. Not this one. */
  others: Game[];
  /** The user's channels. The rail resolves its own, rather than taking the
   * card's list: the card counts only what it is sure of, and the rail is
   * the one place a doubtful match can be shown honestly, with its score. */
  catalog: Catalog | null;
  onClose: () => void;
}) {
  const matches = useMemo(() => {
    if (!catalog) return [];
    // Channels naming this exact fixture first, then whatever carries the
    // networks the schedule listed. Same order the card counts them in.
    const named = matchEvent([game.home.name, game.away.name], game.start, catalog);
    const seen = new Set(named.map((c) => c.id));
    return [
      ...named,
      ...matchGame(game.broadcasts, catalog).filter((c) => !seen.has(c.id)),
    ];
  }, [game, catalog]);

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

        {/* The scroller is INSIDE the panel rather than being it, so the
          * matchup above can spill its crests past every edge. A scroll
          * container clips on both axes, so anything that must overflow
          * cannot live in one. */}
        <div className="sportstheater__list">
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

        {others.length > 0 && (
          <section className="sportstheater__scores">
            <h3 className="sportstheater__heading">
              <span className="gamepip" aria-hidden />
              Live Scores
            </h3>
            {others.map((g) => (
              <CompactCard key={g.id} game={g} />
            ))}
          </section>
        )}
        </div>
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
    channel.confidence >= 85 ? "sure" : channel.confidence >= 60 ? "likely" : "doubt";
  return (
    <button type="button" className="sportsrail" title={channel.name}>
      {/* The same lean and glare the cards use, rather than a play glyph.
        * The row IS a card, so it should answer the pointer the way the
        * other cards do; a third affordance invented only for this list was
        * one too many.
        *
        * The angles are deliberately NOT the cards' numbers. Degrees are
        * not the unit that matters, pixels swept at the corner are, and
        * this row is a very different shape: 340px wide against 62px tall.
        * Half-width times sin(3deg) is 8.9px and half-height times sin(6deg)
        * is 3.2px, which lands on the wide card's own 10.3 and 3.6. Copying
        * its 1.5deg would have been almost no movement at this size. */}
      <Tilt
        className="sportsrail__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={6}
        tiltMaxAngleY={3}
        scale={REDUCED_MOTION ? 1 : 1.015}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.1}
        glarePosition="all"
        glareBorderRadius="16px"
      >
        {channel.logo && (
          <img className="sportsrail__logo" src={channel.logo} alt="" loading="lazy" />
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
      </Tilt>
    </button>
  );
}
