import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { art, flagArt } from "./circuits";
import { shortPlace } from "./placeName";
import { CardFoot } from "./CardFoot";
import { sessionClock } from "./racing";
import type { Field } from "./model";

/**
 * A race session on today's row, as one wide card (plan 010 #4).
 *
 * ONLY WHILE IT IS RUNNING, which is Adam's rule and the right one. The row
 * is a short list of what to watch NOW; a Friday practice session that has
 * finished is a thing that happened, and the day grids are where things
 * that happened live. On race day the Grand Prix is then the first thing
 * anyone scans, which is the whole reason to build this.
 *
 * WHAT IT SHOWS, and why it is not more. Measured against a real season:
 * ESPN gives exactly four fields per entrant, `order`, the name, a country
 * flag, and `winner`, and `statistics` is an EMPTY ARRAY on all 22
 * competitors in every session. No gaps, no lap times, no fastest lap, no
 * pit stops, and no constructor anywhere. So position and driver is not a
 * minimal choice, it is the ceiling. The card is honest about that by
 * spending its width on the field rather than on filler.
 *
 * The proportions and the type sizes are GameCard's, to the pixel. The two
 * sit in the same row at the same size and a card that set its own scale
 * would read as a different kind of object rather than as the same object
 * about a different sport. The mapping onto the fixture card:
 *
 *   two team names       ->  five drivers
 *   the abbreviation     ->  the position, --sports-meta
 *   the status line      ->  LAP 41 / 72, or LIVE where there is no lap
 *   the league line      ->  the series ABOVE it, the session below
 *   the foot             ->  the same foot, shared (CardFoot)
 *
 * NOTHING maps onto the score, because a race has no score. The card takes
 * GameCard's own no-score treatment (`--alone`), and the lap sits at that
 * status size rather than in the 52px scoreline slot: a lap count says how
 * far through you are, not who is winning, and the thing that says who is
 * winning here is the field. That took three passes to settle.
 *
 * The drivers read at the LAP's size, not the country's. Those two are
 * what this card REPORTS; the country is the label on the whole card, the
 * same job the league line does on a fixture, so it keeps --sports-name
 * and stays the only type at that size.
 */

/**
 * How much of the field the card carries.
 *
 * Five rather than the small card's three. The wide card is 1.5x the
 * height and 2.5x the width, and five is the number a race is usually
 * about: the podium plus whoever is still close enough to reach it.
 */
const FIELD = 5;

/**
 * How long a country name can be before it is coded down.
 *
 * MEASURED at 1920, like the small card's eight. The wide card gives its
 * country a 252.9px column, and every one of the twenty-one countries F1
 * visits fits inside it: the longest, UNITED ARAB EMIRATES, needs 179.4px,
 * and NETHERLANDS needs 111.8.
 *
 * So this never fires for F1, which is the point. NED is the right answer
 * in the small card's 137px column and the wrong one here, where the whole
 * word fits with 141px to spare. Twenty rather than infinity because the
 * other racing series have no country at all and put an event name in this
 * slot (plan 010 #7), and that is not bounded by anything.
 */
const WIDE_MAX = 20;

function WideRaceCardImpl({ race }: { race: Field }) {
  const track = art(race.circuitId);
  const flag = flagArt(race.circuitId);
  /**
   * Does this session count laps?
   *
   * A race does. Practice and qualifying carry a lap number too, and it is
   * meaningless: measured over a finished weekend, `status.period` was 19,
   * 26, 20 and 16 for the four non-race sessions, which is just how far
   * somebody got. Only the race's 70 was the distance.
   */
  const counting = race.race && race.lap != null;
  return (
    <div
      className="wracecard"
      /* A DIV rather than a button, like the two smaller race cards, and
       * for the same reason: nothing is wired up to open a session yet.
       * Becomes a button when racing reaches the theater (plan 010 #5). */
      data-game={race.id}
      title={`${race.place} ${race.session}`}
    >
      {/* GameCard's lean and glare exactly. Degrees are not the unit that
        * matters: a 780px card sweeps far more pixels at its corners than
        * a 315px one does at the same angle. The radius is repeated from
        * the stylesheet because the glare is its own layer with its own
        * clip, and a mismatch shows as a square sheen poking out of a
        * round corner. Keep it in step with .wracecard__tilt. */}
      <Tilt
        className="wracecard__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={1.5}
        tiltMaxAngleY={1.5}
        scale={REDUCED_MOTION ? 1 : 1.01}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.07}
        glarePosition="all"
        glareBorderRadius="63.9px"
      >
        {/* The host country's colours down the right edge, as on the small
          * card. A race has a country in a way a fixture between two clubs
          * does not. */}
        {flag && (
          <img
            className="wracecard__flag"
            src={flag}
            alt=""
            aria-hidden
            loading="lazy"
          />
        )}

        <span className="wracecard__body">
          {/* THE ORDER IS THE CONTENT, so it gets the reading side. */}
          <ol className="wracecard__field">
            {race.entrants.slice(0, FIELD).map((e) => (
              <li className="wracecard__slot" key={e.place}>
                <span className="wracecard__place">{e.place}</span>
                {e.mark ? (
                  <img
                    className="wracecard__mark"
                    src={e.mark}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="wracecard__mark" aria-hidden />
                )}
                <span className="wracecard__code">{e.code}</span>
              </li>
            ))}
          </ol>

          <span className="wracecard__center">
            {/* THE SERIES ON TOP, the session underneath, and the lap
              * between them. Adam's order, and it reads better than
              * GameCard's: a fixture's league line is a footnote to the
              * score, where a race's series is the thing that tells you
              * what you are even looking at before the number means
              * anything. */}
            <span className="gamecard__league">{race.league}</span>
            {/* ONE SIZE for the whole line, label and numbers alike.
              * This went around three times: 52px for the string read as
              * "mega huge", then the number alone at score size read as
              * top-heavy once it was on screen, and Adam called it back
              * himself. It is not a scoreline. A lap count is a reading
              * off a clock, and it belongs at the size of a status. */}
            <span className="gamecard__status gamecard__status--alone">
              {race.state === "live" && <span className="gamepip" aria-hidden />}
              {/* ONE TEXT RUN, wrapper and all.
                *
                * The status line is an inline-flex with `gap: 8px`, which
                * exists to hold the pip off the words. Left as siblings,
                * the total collected that gap AND a margin of its own and
                * sat 16.8px off the lap, which Adam boxed. Inside this
                * wrapper it is what it always was: a word space in a
                * sentence, the same one that separates LAP from 41. */}
              <span className="wracecard__count">
                {counting
                  ? `LAP ${race.lap}`
                  : race.state === "live"
                    ? "LIVE"
                    : sessionClock(race.start)}
                {/* The distance, same size, quieter. They are the same
                  * kind of number and one is not a footnote to the
                  * other. */}
                {counting && race.laps != null && (
                  <span className="wracecard__laps">{` / ${race.laps}`}</span>
                )}
              </span>
            </span>
            <span className="wracecard__session">{race.session}</span>
          </span>

          <span className="wracecard__where">
            {/* Behind the words rather than beside them: it is the one
              * piece here that is decoration, and it has to be able to be
              * missing. Five of the six racing leagues carry no circuit. */}
            {track && (
              <span
                className="wracecard__track"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: track }}
              />
            )}
            {/* NOT coded at eight the way the small cards are: this
              * column is two and a half times wider and every country F1
              * visits fits it whole. See WIDE_MAX. */}
            <span className="wracecard__place-name">
              {shortPlace(race.place, WIDE_MAX)}
            </span>
          </span>
        </span>

        <CardFoot
          item={race}
          // The circuit's own name, where the fixture card puts the
          // stadium. The country is already up in the body.
          place={race.venue}
          start={race.start}
        />
      </Tilt>
    </div>
  );
}

/** Memoised for the same reason every other card is: the board rebuilds
 * its objects from fresh JSON every 90 seconds and almost none of them
 * have changed. */
export const WideRaceCard = memo(WideRaceCardImpl);
