import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { art, flagArt } from "./circuits";
import { shortPlace } from "./placeName";

/**
 * A race session, as a card (plan 010, Adam's Figma).
 *
 * TEMPORARY, and honest about it: this is here so the shape can be looked
 * at while the racing adapter is still to be written. Nothing fetches a
 * Race yet, so nothing but the rig renders one.
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

/** One entrant, in finishing order. */
export interface Entrant {
  /** 1, 2, 3. */
  place: number;
  /** As the source names them: "Lando Norris". */
  name: string;
  /** The three letters a broadcast would caption them with. */
  code: string;
  /** Their country's flag. The source carries no constructor. */
  mark?: string;
}

export interface Race {
  id: string;
  /** "Formula 1". */
  series: string;
  /** "FP1", "Qual", "Race". */
  session: string;
  /** Where, in one word: "Hungary". */
  place: string;
  /** The circuit's own name, for the upcoming card's second line. */
  track?: string;
  /** The circuit id, for the art and the flag. Absent outside F1. */
  circuitId?: string;
  /** Kick-off, already formatted: this card never does its own clock. */
  time: string;
  /**
   * The same instant, unformatted.
   *
   * Added for the wide card, which reports "Started 3:00PM" on a session
   * that is over, and needed by the adapter anyway: plan 010 #3 puts each
   * session on its own day, which means running it through `onDay()` like
   * a game, which needs a Date rather than a rendered string.
   */
  start: Date;
  /** "SAT". Only the upcoming card shows it; the rest are on the day. */
  day: string;
  state: "pre" | "live" | "final";
  /**
   * Where to watch, exactly as a Game carries it.
   *
   * Racing really does have this: measured over the 2026 calendar, every
   * F1 session carries `broadcasts: ["Apple TV"]`, which is correct for
   * the season's US rights. So the matcher has a real name to find, and a
   * wide race card can answer the question the row exists to answer.
   *
   * `channels` is empty until the matcher runs over it (plan 010 #5).
   */
  broadcasts: string[];
  channels: { id: string; name: string }[];
  channelsPending?: boolean;
  hiddenOnly?: boolean;
  /**
   * Is this a RACE, as opposed to practice or qualifying?
   *
   * The Grand Prix and the sprint both are. It decides which live header
   * the card gets: a race counts laps, and nothing else does.
   */
  race: boolean;
  /**
   * The lap being run, and the number there are.
   *
   * `laps` is OPTIONAL and that is not tidiness. The scoreboard carries a
   * lap NUMBER (status.period) and no total anywhere in the payload; the
   * total only appears if ESPN writes it into the status text, which
   * cannot be checked from here because F1 is not running. So the card
   * shows "LAP 41 / 72" when it is told the total and "LAP 41" when it is
   * not, and neither is a broken state.
   */
  lap?: number;
  laps?: number;
  /** The podium, or as much of it as exists yet. */
  top: Entrant[];
}

export function RaceCard({ race }: { race: Race }) {
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
      : race.time;
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
        <span className="racecard__series">{race.series}</span>

        {upcoming ? (
          /* The session, at the weight the podium would have had. It is the
           * only thing this card knows that the weekend card did not
           * already say, so it gets the room. */
          <span className="racecard__ahead">
            <span className="racecard__ahead-name">{race.session}</span>
            <span className="racecard__ahead-when">
              {race.day} {race.time}
            </span>
          </span>
        ) : (
          /* The order IS the content, so it gets the reading side. */
          <ol className="racecard__podium">
            {race.top.slice(0, 3).map((e) => (
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
            race.track && <span className="weekend__circuit">{race.track}</span>
          ) : (
            <span className="racecard__session">{race.session}</span>
          )}
        </span>
      </Tilt>
    </div>
  );
}
