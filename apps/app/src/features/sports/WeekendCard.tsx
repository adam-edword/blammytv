import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { art, flagArt } from "./circuits";

/**
 * A race weekend before it starts, as a card (plan 010, Adam's Figma).
 *
 * TEMPORARY, alongside RaceCard, and the same card as it: same surface,
 * same radius, same lean, same flag, same track. Only the left column
 * differs, and that is the whole idea — a race is a different SHAPE of
 * thing from a fixture, but a weekend and a session are the same thing at
 * two zoom levels and should not look like two components.
 *
 * WHY A WEEKEND IS ONE CARD AND A SESSION IS FIVE. Before anything runs
 * there is nothing to rank: measured against the real payload, a `pre`
 * session comes back with `competitors` of length ZERO. So the podium
 * column has nothing to hold, and the useful thing to put there is the
 * question a person actually has three days out, which is when any of it
 * is on. From FP1's day the sessions break out and each gets its own card,
 * because from then on each has its own clock, its own order and its own
 * state.
 */

/** One row of the weekend's schedule. */
export interface Session {
  /** As the source abbreviates it: "FP1", "Qual", "Race", "SS", "SR". */
  label: string;
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
  /** The circuit id, for the art and the flag. Absent outside F1. */
  circuitId?: string;
  /**
   * The weekend's first day, formatted: "SEP 4".
   *
   * The first rather than the race day, so every row below reads FORWARD
   * from it and the card needs no arithmetic to be understood. Race day
   * would put the header after three of the five rows it heads.
   */
  date: string;
  /** In order, first session to last. Always five, measured over a season. */
  sessions: Session[];
}

export function WeekendCard({ weekend }: { weekend: Weekend }) {
  const track = art(weekend.circuitId);
  const flag = flagArt(weekend.circuitId);
  return (
    <button type="button" className="racecard" title={`${weekend.place} weekend`}>
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
          {/* No session line under it, unlike the race card: there is no one
            * session this card is about. The name gets the room back. */}
          <span className="racecard__place-name">{weekend.place}</span>
        </span>
      </Tilt>
    </button>
  );
}
