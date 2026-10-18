import { useEffect, useState } from "react";

/**
 * What stands for a folder in the views that pick them (plan 028): the posters
 * of its newest titles, fanned in Stream's empty page, stacked small in the
 * Rows drawer, and one round in Settings. Decoration: the folder's name is
 * always beside it.
 */

/** A poster. One that will not load is a blank tile and not the browser's
 * broken-image box, as a card's is a lettermark (ui/Card.tsx). */
function Poster({ src, className }: { src: string | undefined; className: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return src && !broken ? (
    <img className={className} src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
  ) : (
    <span className={`${className} is-blank`} />
  );
}

/** Up to three posters, the newest in front and the next two behind it, fanned
 * out (`big`) or stacked small. A folder with none is a blank tile. */
export function PosterFan({ posters, big = false }: { posters: readonly string[]; big?: boolean }) {
  return (
    <span className={"xtfan" + (big ? " xtfan--big" : "")} aria-hidden="true">
      {posters[1] && <Poster src={posters[1]} className="xtfan__img xtfan__l" />}
      {posters[2] && <Poster src={posters[2]} className="xtfan__img xtfan__r" />}
      <Poster src={posters[0]} className="xtfan__img xtfan__m" />
    </span>
  );
}

/** The newest poster in a circle. */
export function PosterDot({ posters }: { posters: readonly string[] }) {
  return <Poster src={posters[0]} className="xtdot" />;
}
