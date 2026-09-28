import { memo, useEffect, useState } from "react";
import { Tilt } from "./Tilt";
import { REDUCED_MOTION } from "../lib/reducedMotion";
import { artLoaded } from "../lib/artIn";
import type { VodItem } from "../features/stream/model";
import { cardMetaLine, type CardMetaField } from "../features/settings/cardMeta";

// The poster card. Moved here from features/stream/StreamScreen.tsx in
// v0.10.31 (ROADMAP M2, plan 014 L2), unchanged: Stream's rows, Discover's
// grid and Library's lists all draw it.

/** Memoized: mapped by the hundreds across Stream rows, Discover's
 * infinite grid and My List, each wrapping a stateful Tilt — parent
 * re-renders (search keystrokes, enrichment passes) must not re-render
 * every mounted card. Callers keep metaFields/onOpen identities stable. */
export const Card = memo(function Card({
  item,
  metaFields,
  onOpen,
}: {
  item: VodItem;
  metaFields: CardMetaField[];
  onOpen: (i: VodItem) => void;
}) {
  // Real catalogs carry poster URLs of wildly varying health — a broken
  // one falls back to the lettermark like a missing one does, instead of
  // the browser's broken-image box (same pattern as the guide's logos).
  const [broken, setBroken] = useState(false);
  // Enrichment can swap a dead preview poster for a working full-meta
  // one under the same item id — give the new URL a chance.
  useEffect(() => setBroken(false), [item.poster]);
  const meta = cardMetaLine(metaFields, {
    rating: item.rating,
    year: item.year,
    runtimeMin: item.runtimeMin,
    genre: item.genres[0],
    kind: item.kind,
  });
  // Apple TV-style pointer tilt on the poster only — the title/meta below
  // stay planted. Angles well under the library's 20° default: the real
  // thing is a gentle lean, not a flip. OS-level reduced-motion wins.
  const reducedMotion = REDUCED_MOTION;
  return (
    <button
      type="button"
      className="stream-card"
      data-hint={item.title}
      onClick={() => onOpen(item)}
    >
      <Tilt
        className="stream-card__tilt"
        tiltEnable={!reducedMotion}
        tiltMaxAngleX={5}
        tiltMaxAngleY={5}
        scale={reducedMotion ? 1 : 1.03}
        transitionSpeed={650}
        glareEnable={!reducedMotion}
        glareMaxOpacity={0.12}
        glarePosition="all"
        glareBorderRadius="var(--radius-pic)"
      >
        {item.poster && !broken ? (
          <img
            key={item.poster}
            className="stream-card__poster art-in"
            src={item.poster}
            alt=""
            loading="lazy"
            draggable={false}
            onLoad={artLoaded}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="stream-card__mono">{item.title.slice(0, 1)}</span>
        )}
      </Tilt>
      <span className="stream-card__name">{item.title}</span>
      {meta && <span className="stream-card__meta">{meta}</span>}
    </button>
  );
});
