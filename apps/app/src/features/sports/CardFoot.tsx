import { formatClock } from "../../lib/time";
import { carriageText, type Carriable } from "./carriage";

/**
 * The bottom rail of a wide card: where it is on the left, where to watch
 * it on the right.
 *
 * Shared by both wide cards (plan 010 #4). The class names are still
 * `gamecard__*` and that is a naming debt rather than a coupling one: the
 * two cards are the same object at the same size saying the same two
 * things, and renaming the rail would mean touching a stylesheet Adam has
 * tuned by hand for no change on screen.
 */
export function CardFoot({
  item,
  place,
  start,
}: {
  item: Carriable;
  /** Stadium, or the circuit. Bottom-left, beside the pin. */
  place?: string;
  /** Kick-off, for the one case that reports a time instead of a channel. */
  start: Date;
}) {
  const carriage = carriageText(item);
  return (
    <span className="gamecard__foot">
      {place && (
        <span className="gamecard__venue">
          <PinIcon />
          {place}
        </span>
      )}
      {/* A finished game has nothing to tune into, so it says when it
       * started instead of where to watch it: "On MLB.TV" under a
       * full-time score is an invitation to watch something already
       * over. ESPN carries no end time, or this would say that. */}
      {item.state === "final" ? (
        <span className="gamecard__carriage gamecard__carriage--none">
          Started {formatClock(start)}
        </span>
      ) : (
        <span
          className={
            "gamecard__carriage" +
            (item.channels.length === 0 ? " gamecard__carriage--none" : "")
          }
        >
          {/* No dot on a presumed match. The dot is the card's shorthand
            * for "this is on, right here, now", and the map only knows
            * where the LEAGUE usually lives. The sentence beside it already
            * says "Usually on"; a live pip next to that would take the
            * hedge straight back off again. */}
          {item.state === "live" &&
            item.channels.length > 0 &&
            !item.presumedOnly && <span className="gamecard__dot" aria-hidden />}
          {carriage}
          {item.channels.length > 1 && (
            <span className="gamecard__more" aria-hidden>
              &rsaquo;
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function PinIcon() {
  return (
    <svg
      width="9"
      height="11"
      viewBox="0 0 9 11"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <path
        d="M4.5.75c2 0 3.5 1.5 3.5 3.4 0 2.4-3.5 6.1-3.5 6.1S1 6.55 1 4.15C1 2.25 2.5.75 4.5.75Z"
        stroke="currentColor"
        strokeWidth="1"
      />
      <circle cx="4.5" cy="4.15" r="1.15" fill="currentColor" />
    </svg>
  );
}
