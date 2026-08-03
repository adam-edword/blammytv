import { LeaguesIcon } from "../../ui/icons";

/**
 * The board with nothing on it (plan 010 #40).
 *
 * It was one line of grey text doing four jobs, which read as the board
 * having failed rather than as the board having an answer. A day with
 * nothing on it is a real, ordinary answer to "what is on", and the screen
 * that says so should look as considered as the screen full of cards.
 *
 * TWO SHAPES, because the states make two different claims:
 *
 *   EMPTY and ERROR are statements, so they get a statement's composition:
 *   a mark, one line that says what happened, one that says what to do,
 *   and where there is something to do, a button that does it.
 *
 *   LOADING is not empty at all. It is the board arriving, so it draws the
 *   board's own geometry: a sentence of grey text says "there is nothing
 *   here", where the skeleton says "this is where it goes". Worth the
 *   pixels now in a way it was not before, because an empty follow store
 *   asks for 151 leagues over two days and that measured 8.3s warm and 38s
 *   cold at the six-request gate.
 *
 * The language is Discover's, deliberately (`.discover--empty` and
 * `.disc-skel`): centred column, a headline at 28px, a muted note under it,
 * one primary action, and the same 1.3s breath on the placeholders. This
 * app already had an answer for "a screen with nothing on it" and a second
 * one that nearly matched would be the worse outcome.
 */

export function SportsEmpty({
  title,
  note,
  alert,
  action,
}: {
  title: string;
  note: string;
  /** An error rather than an emptiness: announced, not just described. */
  alert?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="sports-empty">
      {/* The trophy, quiet and large. One mark across all three states
        * rather than a different picture per failure: the headline already
        * says which one this is, and a zoo of icons for "nothing here"
        * reads as decoration. */}
      <span className="sports-empty__mark" aria-hidden>
        <LeaguesIcon />
      </span>
      <h2 className="sports-empty__title">{title}</h2>
      <p className="sports-empty__note" role={alert ? "alert" : "status"}>
        {note}
      </p>
      {action && (
        <button
          type="button"
          className="btn-primary sports-empty__action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * The board arriving, at the board's own geometry.
 *
 * The counts are the shape rather than a promise: a row of three and a
 * grid of eight is roughly what a real day looks like at 1920px, and the
 * grid is the same `auto-fill` track as the real one, so it reflows at the
 * same widths and nothing jumps when the games land. It deliberately does
 * NOT try to guess how many are coming, which nothing here knows until the
 * fetch does.
 *
 * `aria-hidden` on the art with a textual twin beside it, the treatment
 * ui.css's `.vh` exists for: a screen reader should hear "Loading", not
 * eleven empty boxes.
 */
export function BoardSkeleton() {
  return (
    <>
      <p className="vh" role="status">
        Loading today&rsquo;s games…
      </p>
      <div className="sports-skel" aria-hidden>
        <span className="sports-skel__title" />
        <div className="sports-skel__row">
          {[0, 1, 2].map((i) => (
            <span className="sports-skel__wide" key={i} />
          ))}
        </div>
        <span className="sports-skel__title sports-skel__title--sub" />
        <div className="sports-skel__grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span className="sports-skel__card" key={i} />
          ))}
        </div>
      </div>
    </>
  );
}
