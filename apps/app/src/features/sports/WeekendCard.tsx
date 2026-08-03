import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { art, flagArt } from "./circuits";
import { shortPlace } from "./placeName";

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

/** One row of the weekend's schedule. */
export interface Session {
  /** As the source abbreviates it: "FP1", "Qual", "Race", "SS", "SR". */
  label: string;
  /**
   * What that stands for, for the tooltip: "Sprint Qualifying".
   *
   * On hover rather than on the row, and that is measured. At the board's
   * narrowest track, printing "SPRINT QUAL" makes the country name overlap
   * the schedule by 10px. Absent for a label we have no expansion for.
   */
  full?: string;
  /** "FRI". */
  day: string;
  /** "1:00PM". Already formatted; this card never does its own clock. */
  time: string;
  /**
   * Qualifying and the Grand Prix, which is what the weekend is FOR.
   * Everything else sits a step back.
   *
   * Fixed by session type rather than by what has run: nothing has run
   * when this card is on screen, so there is no progress to show and the
   * ramp can only be about which sessions matter.
   */
  major: boolean;
}

export interface Weekend {
  id: string;
  /** "Formula 1". */
  series: string;
  /** Where, in one word: "Hungary". */
  place: string;
  /**
   * The circuit's own name: "Circuit Park Zandvoort".
   *
   * The weekend card's alone. A session card has its session under the
   * country and there is no room for both; a weekend has no one session,
   * so the line is free and the track is the next thing you would want to
   * know. Optional because only F1 names its circuit at all.
   */
  track?: string;
  /** The circuit id, for the art and the flag. Absent outside F1. */
  circuitId?: string;
  /**
   * RACE DAY, formatted: "AUG 23".
   *
   * Not the first day. It is what a person means by the date of a Grand
   * Prix, and the rows below carry their own days anyway.
   */
  date: string;
  /** In order, first session to last. Always five, measured over a season. */
  sessions: Session[];
}

export function WeekendCard({ weekend }: { weekend: Weekend }) {
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
