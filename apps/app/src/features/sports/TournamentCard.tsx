import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import type { Tournament } from "./model";

/**
 * A day of a tournament, as one card (plan 010 #37).
 *
 * WHY THIS EXISTS is a measurement, not a taste. A tennis event carries its
 * entire draw — one WTA tournament held 447 matches across a fortnight, 89
 * of them on a single day — and across the whole 151-league catalog for two
 * days, tennis was 256 of 304 cards. A board meant to show someone the
 * breadth of what is on was 84% one sport's first round.
 *
 * The fix is altitude rather than filtering. A tournament IS one thing on a
 * schedule: nobody scanning tonight wants 89 separate answers from Toronto,
 * they want to know Toronto is on, what round it is at, and whether anything
 * is on court right now. So the day's matches are counted, not drawn.
 *
 * NOT CLICKABLE, like the race cards and for the same reason: there is
 * nowhere to send it yet. Opening one should show that day's draw, which is
 * its own screen and its own plan item (#38). A <button> that looked exactly
 * as clickable as every fixture beside it and did nothing would be worse
 * than a card that does not offer.
 *
 * The frame is the small card's, on purpose — same tilt, same radius, same
 * header. It sits in the same grid answering the same question, so it should
 * read as the same kind of object about a different shape of sport.
 */
function TournamentCardImpl({ event }: { event: Tournament }) {
  const count = event.matches.length;
  return (
    <div
      className={
        "upcard tourncard" +
        (event.state === "final" ? " upcard--final" : "")
      }
      title={`${event.title}${event.venue ? ` · ${event.venue}` : ""}\n${count} ${
        count === 1 ? "match" : "matches"
      }`}
      data-game={event.id}
    >
      <Tilt
        className="upcard__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={7}
        tiltMaxAngleY={7}
        scale={REDUCED_MOTION ? 1 : 1.03}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.09}
        glarePosition="all"
        glareBorderRadius="42.6px"
      >
        <span className="upcard__body">
          <span className="upcard__head">
            <span className="upcard__time">
              {event.state === "live" && <span className="gamepip" aria-hidden />}
              {event.status}
            </span>
            <span className="upcard__league">{event.league}</span>
          </span>

          <span className="tourncard__main">
            {/* The tournament's name is this card's whole subject, so it
              * takes the room the matchup would have. Clamped at two lines
              * rather than fitted: "National Bank Open presented by Rogers"
              * shrunk to fit on one line would be smaller than the venue
              * under it. */}
            <span className="tourncard__title">{event.title}</span>
            {event.venue && (
              <span className="tourncard__where">{event.venue}</span>
            )}
          </span>

          {/* What the day actually is: how far into the draw, and how much
            * of it. A day can straddle two rounds — 2026-08-04 ran Round 1
            * and Round 2 together — so this is a list, not a string. */}
          <span className="tourncard__foot">
            <span className="tourncard__rounds">{event.rounds.join(" · ")}</span>
            <span className="tourncard__count">
              {count} {count === 1 ? "match" : "matches"}
            </span>
          </span>
        </span>
      </Tilt>
    </div>
  );
}

/** Memoised on identity, same as the other cards: useGames carries an
 * unchanged game forward as the same object across a 90 second tick. */
export const TournamentCard = memo(TournamentCardImpl);
