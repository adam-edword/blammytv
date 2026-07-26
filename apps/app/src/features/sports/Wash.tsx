import type { CSSProperties } from "react";
import type { Competitor } from "./model";

/**
 * The layers of the crest's progressive blur. Empty on purpose: each one is
 * a backdrop-filter with its own radius and band, all of it in sports.css,
 * where the numbers can be read next to the measurements that chose them.
 * Eight is what the falloff needs; the count only lives here because CSS
 * cannot conjure elements.
 */
const HAZE_LAYERS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The same washes, laid back over the FINISHED card at low opacity.
 *
 * Adam's Figma trick: the text underneath picks up a hint of each team's
 * colour instead of sitting on it as pure white, so the two halves read as
 * belonging to their sides. It has to be the last thing in the card and it
 * must never take a click, which is the whole of its CSS.
 */
export function WashVeil({
  home,
  away,
  lost,
}: {
  home: Competitor;
  away: Competitor;
  lost?: Side;
}) {
  return (
    <span className="gameveil" aria-hidden>
      <Wash side="home" team={home} lost={lost === "home"} />
      <Wash side="away" team={away} lost={lost === "away"} />
    </span>
  );
}

export type Side = "home" | "away";

/**
 * The colour behind one half of a game card: the competitor's mark, blurred
 * hard and bled off its own edge, over a tint of the team colour.
 *
 * Two layers rather than one so a missing logo still leaves the colour
 * instead of a black void, which matters because logos arrive from a
 * schedule source that does not guarantee them.
 *
 * Shared by both card sizes. The blur radius and the bleed are CSS, scoped
 * per card, so the small card can wash more gently without a second copy of
 * this markup.
 */
export function Wash({
  side,
  team,
  lost,
}: {
  side: Side;
  team: Competitor;
  /** Beaten, and the game is over. Drains the colour out of this half. */
  lost?: boolean;
}) {
  return (
    <span
      className={`gamewash gamewash--${side}${lost ? " gamewash--lost" : ""}`}
      aria-hidden
    >
      {team.logo ? (
        // The crest is the background, on its own. The colour was only ever
        // standing in for it, and running both puts a flat wash over the
        // one thing with any detail in it.
        <span className="gamewash__crest">
          <img className="gamewash__mark" src={team.logo} alt="" loading="lazy" />
          {/* The progressive blur. Each <i> blurs the already-blurred
            * result beneath it, so the radii compound into one continuous
            * dissolve; the stylesheet owns the radius and the band of
            * each. Live card only, and priced there: see sports.css. */}
          <span className="gamewash__haze">
            {HAZE_LAYERS.map((layer) => (
              <i key={layer} />
            ))}
          </span>
        </span>
      ) : (
        team.color && (
          <span
            className="gamewash__tint"
            // The colour, not the gradient: the card decides which way it
            // runs, and that differs by side.
            style={{ "--team": `#${team.color}` } as CSSProperties}
          />
        )
      )}
    </span>
  );
}
