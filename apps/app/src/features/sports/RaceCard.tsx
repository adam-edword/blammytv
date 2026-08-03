import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { art, flagArt } from "./circuits";
import { shortPlace } from "./placeName";
import { sessionClock, sessionDay } from "./racing";
import type { Field } from "./model";


/**
 * A race session, as a card (plan 010, Adam's Figma).
 *
 * The GRID card, one per session, on the session's own day. The wide card
 * beside it in the row is the same session while it is running; this is
 * the one that stays after.
 *
 * WHY THE CARD IS DIFFERENT AT ALL. Every other card in the hub is two
 * sides and a score. A race is an ORDERED FIELD: twenty-two entrants, no
 * head-to-head, and the interesting part is the top of it. So the layout
 * is a podium down one side and the place down the other, rather than a
 * matchup with a number in the middle.
 *
 * The track outline is F1's alone. Measured over a full season of all six
 * racing leagues, only F1 says which circuit it is at; the rest carry no
 * circuit and no venue, so `art()` answers undefined and this has to read
 * without one. It does: the name and the session hold the right-hand side
 * on their own and the outline sits behind them.
 */

export function RaceCard({ race }: { race: Field }) {
  const track = art(race.circuitId);
  const flag = flagArt(race.circuitId);
  const upcoming = race.state === "pre";
  /**
   * What the top-left says.
   *
   * A live RACE counts laps, because that is the question during one and
   * the only session where it has an answer. A live practice or qualifying
   * has no lap to be on that means anything, so it just says it is live.
   * Anything not running says when it was.
   */
  const header =
    race.state === "live"
      ? race.race && race.lap != null
        ? `LAP ${race.lap}`
        : "LIVE"
      : sessionClock(race.start);
  return (
    /* A DIV with no click, like the weekend card beside it, and for now
     * for the same reason: nothing is wired up to open a session. It was a
     * <button> with a pointer cursor and no onClick, so it looked exactly
     * as clickable as every game card next to it, took keyboard focus and
     * swallowed Enter. Becomes a button again when racing reaches the
     * theater (plan 010, A7). */
    <div
      className={
        "racecard racecard--flat" +
        (race.state === "final" ? " racecard--final" : "")
      }
      title={`${race.place} ${race.session}`}
    >
      {/* The small card's lean and glare, to its own numbers. This sits in
        * the same grid as the small card and is the same size, so it leans
        * the same amount: a card that tilted differently from the one
        * beside it would read as a different kind of object rather than as
        * the same object about a different sport.
        *
        * The tilt layer is the card SURFACE, not a wrapper around it. That
        * is what gives the glare something to clip to, and it is why the
        * radius is repeated here — the library draws its own layer and
        * cannot read the CSS. Keep it in step with .racecard__tilt. */}
      <Tilt
        className="racecard__tilt"
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
        {/* The host country's colours, hugging the right edge. The card was
          * all greys and a couple of driver flags, and a race has a country
          * in a way a fixture between two clubs does not. */}
        {flag && (
          <img className="racecard__flag" src={flag} alt="" aria-hidden loading="lazy" />
        )}
        {/* Nothing has run, so there is no header: an upcoming session puts
          * its name and its time in the body, where the podium would be.
          * See the block below. */}
        {!upcoming && (
          <span className="racecard__clock">
            {race.state === "live" && <span className="gamepip" aria-hidden />}
            {header}
            {/* The distance, quieter than the lap being run. The lap is the
              * live number; the total is the thing it is measured against
              * and does not change. */}
            {header.startsWith("LAP") && race.laps != null && (
              <span className="racecard__laps"> / {race.laps}</span>
            )}
          </span>
        )}
        <span className="racecard__series">{race.league}</span>

        {upcoming ? (
          /* The session, at the weight the podium would have had. It is the
           * only thing this card knows that the weekend card did not
           * already say, so it gets the room. */
          <span className="racecard__ahead">
            <span className="racecard__ahead-name">{race.session}</span>
            <span className="racecard__ahead-when">
              {sessionDay(race.start)} {sessionClock(race.start)}
            </span>
          </span>
        ) : (
          /* The order IS the content, so it gets the reading side. */
          <ol className="racecard__podium">
            {race.entrants.slice(0, 3).map((e) => (
              <li className="racecard__slot" key={e.place}>
                <span className="racecard__place">{e.place}</span>
                {e.mark ? (
                  <img className="racecard__mark" src={e.mark} alt="" loading="lazy" />
                ) : (
                  <span className="racecard__mark" aria-hidden />
                )}
                <span className="racecard__code">{e.code}</span>
              </li>
            ))}
          </ol>
        )}

        <span className="racecard__where">
          {/* Behind the words rather than beside them: it is the one piece
            * here that is decoration, and it has to be able to be missing. */}
          {track && (
            <span
              className="racecard__track"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: track }}
            />
          )}
          {/* Coded past eight characters, same as the weekend card: this
            * is the same column at the same size, so it has the same
            * problem. See placeName. */}
          <span className="racecard__place-name">{shortPlace(race.place)}</span>
          {/* The session has moved to the body on an upcoming card, so this
            * line is free for the track. Once it is running the session is
            * the thing you need here and the track is on the art. */}
          {upcoming ? (
            race.venue && <span className="weekend__circuit">{race.venue}</span>
          ) : (
            <span className="racecard__session">{race.session}</span>
          )}
        </span>
      </Tilt>
    </div>
  );
}
