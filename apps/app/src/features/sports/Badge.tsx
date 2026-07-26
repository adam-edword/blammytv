import type { Competitor } from "./model";

/**
 * The team's mark, small and sharp, at the card's outer edge.
 *
 * Shared by both cards, and one CSS rule behind it, so the two cannot
 * drift apart the way per-card copies of a thing always do.
 *
 * Prefers the inverted mark, because one drawn this small on a near-black
 * card has to survive on its own and several are all but invisible
 * otherwise (see Competitor.logoDark). That one is derived from a URL
 * pattern rather than handed to us, and it 404s for some clubs, so a
 * failure falls back to the mark we were actually given. `failed` guards
 * the fallback from failing in turn and looping.
 */
export function Badge({ team }: { team: Competitor }) {
  if (!team.logo) return null;
  return (
    <img
      className="gamebadge"
      src={team.logoDark ?? team.logo}
      alt=""
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        if (img.dataset.failed || !team.logo || img.src === team.logo) return;
        img.dataset.failed = "1";
        img.src = team.logo;
      }}
    />
  );
}
