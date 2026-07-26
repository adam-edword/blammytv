import type { Competitor } from "./model";

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
        <span className="gamewash__tint" style={{ background: `#${team.color}` }} />
      )}
      {team.logo && (
        <img className="gamewash__mark" src={team.logo} alt="" loading="lazy" />
      )}
    </span>
  );
}
