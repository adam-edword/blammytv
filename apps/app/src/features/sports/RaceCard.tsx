import { art, circuit } from "./circuits";

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
  /** The circuit id, for the art and the flag. Absent outside F1. */
  circuitId?: string;
  /** Kick-off, already formatted: this card never does its own clock. */
  time: string;
  state: "pre" | "live" | "final";
  /** The podium, or as much of it as exists yet. */
  top: Entrant[];
}

export function RaceCard({ race }: { race: Race }) {
  const track = art(race.circuitId);
  const flag = race.circuitId ? circuit(race.circuitId)?.flag : undefined;
  return (
    <button type="button" className="racecard" title={`${race.place} ${race.session}`}>
      {/* The host country's colours, hugging the right edge. The card was
        * all greys and a couple of driver flags, and a race has a country
        * in a way a fixture between two clubs does not. */}
      {flag && (
        <span className="racecard__flag" aria-hidden>
          <img src={flag} alt="" loading="lazy" />
        </span>
      )}
      <span className="racecard__clock">
        {race.state === "live" && <span className="gamepip" aria-hidden />}
        {race.time}
      </span>
      <span className="racecard__series">{race.series}</span>

      {/* The order IS the content, so it gets the reading side. */}
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
        <span className="racecard__place-name">{race.place}</span>
        <span className="racecard__session">{race.session}</span>
      </span>
    </button>
  );
}
