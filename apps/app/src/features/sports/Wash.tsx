import type { CSSProperties } from "react";
import type { Competitor } from "./model";

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
}: {
  home: Competitor;
  away: Competitor;
}) {
  return (
    <span className="gameveil" aria-hidden>
      <Wash side="home" team={home} />
      <Wash side="away" team={away} />
    </span>
  );
}

/**
 * How many copies of the crest make the progressive blur.
 *
 * There is no such thing as a gradient blur in CSS: `filter: blur()` is one
 * radius for the whole element. The way to fake it is to stack the same
 * image at climbing radii and mask each copy to its own band, so the sharp
 * copy shows where the crest sits and the soft ones take over as it runs
 * toward the text. Three is enough for the bands to read as continuous;
 * more is just more layers to composite, on every card in the row.
 *
 * The app's other progressive blur (the header veil) stacks
 * `backdrop-filter` instead, and is parked because it never looked right.
 * That technique blurs whatever happens to be behind it. This one blurs a
 * known image, which is why it can be aimed.
 */
const MARK_STEPS = [1, 2, 3];

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
}: {
  side: "home" | "away";
  team: Competitor;
}) {
  return (
    <span className={`gamewash gamewash--${side}`} aria-hidden>
      {team.color && (
        <span
          className="gamewash__tint"
          // The colour, not the gradient: the card decides which way it
          // runs, and that differs by side.
          style={{ "--team": `#${team.color}` } as CSSProperties}
        />
      )}
      {team.logo &&
        MARK_STEPS.map((step) => (
          <img
            key={step}
            className={`gamewash__mark gamewash__mark--${step}`}
            src={team.logo}
            alt=""
            loading="lazy"
          />
        ))}
    </span>
  );
}
