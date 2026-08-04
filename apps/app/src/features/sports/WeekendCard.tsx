import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { art, flagArt } from "./circuits";
import { shortPlace } from "./placeName";
import type { Weekend } from "./model";

/**
 * A race weekend before it starts, as a card (plan 010, Adam's Figma).
 *
 * NOT ON THE BOARD, and that is a consequence of two decisions rather
 * than an oversight. Adam's: racing sits on its real dates and falls off
 * the home board when it is outside the three-day window. The endpoint's:
 * a date outside a race weekend answers with no events at all. Together
 * those mean the earliest racing can appear is the day of FP1, by which
 * point the weekend has already broken into sessions and this card's
 * moment has passed.
 *
 * Kept, with `toWeekend` and its tests, because it comes back with plan
 * 010 #36: narrow the board to F1 and it reaches out to the next event,
 * which is exactly the question this card answers. The race rig renders it
 * meanwhile, so the design does not rot unseen.
 */

function WeekendCardImpl({ weekend }: { weekend: Weekend }) {
  const track = art(weekend.circuitId);
  const flag = flagArt(weekend.circuitId);
  return (
    /* A DIV, not a button, and that is the point rather than a detail.
     * There is nothing to open: the weekend has not started, so there is no
     * session to watch and no source to tune. A button that does nothing
     * still takes keyboard focus and still promises something, so this is
     * not one — see the cursor in the stylesheet. It keeps the lean and the
     * glare, which are about the card being a card. */
    <div className="racecard racecard--flat" title={`${weekend.place} weekend`}>
      {/* The session card's lean and glare, to the value. Same grid, same
        * size, same object: a weekend that tilted differently from the
        * sessions it becomes would read as a different kind of thing. */}
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
        {flag && (
          <img className="racecard__flag" src={flag} alt="" aria-hidden loading="lazy" />
        )}
        {/* Where a session card puts its clock. This card's "when" is a
          * date, because the whole point of it is that the weekend has not
          * arrived yet. */}
        <span className="racecard__clock">{weekend.date}</span>
        <span className="racecard__series">{weekend.series}</span>

        {/* The schedule, in the podium's column. */}
        <ol className="weekend__list">
          {weekend.sessions.map((s, i) => (
            <li
              className={"weekend__row" + (s.major ? " weekend__row--major" : "")}
              // The label is NOT unique: ESPN files the Spanish GP as
              // FP1/FP1/FP1/Qual/Race, so three rows share one. The
              // position in the weekend is the identity here.
              key={`${s.label}-${i}`}
              // The source ships an abbreviation and no expansion at all,
              // so SS and SR would otherwise be unreadable to anyone who
              // does not already follow the sport.
              title={s.full}
            >
              <span className="weekend__label">{s.label}</span>
              <span className="weekend__when">
                {s.day} {s.time}
              </span>
            </li>
          ))}
        </ol>

        <span className="racecard__where">
          {track && (
            <span
              className="racecard__track"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: track }}
            />
          )}
          {/* Coded past eight characters, because most country names are
            * one word and a long one has nowhere to wrap; see placeName.
            * The full name stays on the card's tooltip. */}
          <span className="racecard__place-name">
            {shortPlace(weekend.place)}
          </span>
          {weekend.track && (
            <span className="weekend__circuit">{weekend.track}</span>
          )}
        </span>
      </Tilt>
    </div>
  );
}

/**
 * Memoised like every other card on the board, which it was not.
 *
 * `WideRaceCard`'s comment already claimed "memoised for the same reason
 * every other card is" — true of four of the six and not of this one, so a
 * tick re-rendered it unconditionally and `react-parallax-tilt` rewrote its
 * inline transform to the identical value.
 */
export const WeekendCard = memo(WeekendCardImpl);
