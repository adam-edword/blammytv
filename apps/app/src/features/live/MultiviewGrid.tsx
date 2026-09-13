import { useEffect, useState } from "react";
import { MultiviewTile } from "./MultiviewTile";
import { MultiviewNotice } from "./MultiviewNotice";
import { multiviewNoticeSeen } from "./multiviewAck";
import { allowedSizes, usableSize, type GridSize } from "./multiview";
import type { XtreamConnections } from "../../data/xtream";

/**
 * The multi-view grid (plan 013): two, three or four live tiles, one with
 * sound.
 *
 * Laid out in CSS rather than by pushing rects at anything. The native
 * player needs measured pixels because it is a child window under the page;
 * these are ordinary elements IN the page, so `grid-template-areas` does the
 * job and reflows for free. `multiview.ts#tileRects` computes the same
 * layouts for the native path and is not used here.
 *
 * THE SIZE IS CAPPED BY THE LINE, not by the layout. One tile is one
 * provider connection; see allowedSizes. A viewer on a 3-connection line is
 * never offered 4, and a viewer on a 1-connection line is told multi-view
 * cannot run rather than shown four dead rectangles.
 */
export function MultiviewGrid({
  streams,
  conns,
  size,
  onSize,
  onClose,
}: {
  /** Up to four playable streams, already resolved to URLs. */
  streams: { id: string; name: string; url: string }[];
  conns: XtreamConnections | null;
  size: GridSize;
  onSize: (n: GridSize) => void;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState(0);
  // The notice gates the first grid ever, not this mount. Read once: it is a
  // stored flag, and re-reading it on every render would let the accept
  // inside the notice race its own dismissal.
  const [needsNotice, setNeedsNotice] = useState(() => !multiviewNoticeSeen());

  const sizes = allowedSizes(conns);
  const usable = usableSize(size, conns);

  // A playlist change can shrink the cap under a grid that is already open.
  // Clamping here rather than in the picker means the tiles follow, instead
  // of the control saying 3 while four streams keep running.
  useEffect(() => {
    if (usable !== null && usable !== size) onSize(usable);
  }, [usable, size, onSize]);

  // Focus must always land on a tile that exists. Shrinking 4 to 2 while
  // watching tile 4 would otherwise leave every tile muted.
  useEffect(() => {
    if (focus >= (usable ?? 0)) setFocus(0);
  }, [focus, usable]);

  if (usable === null) {
    return (
      <div className="mvgrid mvgrid--blocked">
        <p>
          Your line allows one stream at a time, so multi-view can’t run on it.
        </p>
        <button type="button" onClick={onClose}>
          Back
        </button>
      </div>
    );
  }

  const shown = streams.slice(0, usable);

  return (
    <>
      {needsNotice && (
        <MultiviewNotice conns={conns} onAccept={() => setNeedsNotice(false)} />
      )}
      <div className={`mvgrid mvgrid--${usable}`}>
        {shown.map((s, i) => (
          <MultiviewTile
            key={s.id}
            url={s.url}
            name={s.name}
            focused={i === focus}
            onFocus={() => setFocus(i)}
          />
        ))}
        {/* Fewer streams than tiles is normal: you opened a 4-up and only
          * three games are on. An empty cell says so rather than collapsing
          * the grid and moving everything else. */}
        {Array.from({ length: usable - shown.length }, (_, i) => (
          <div key={`empty-${i}`} className="mvtile mvtile--empty">
            <span className="mvtile__name">Nothing here yet</span>
          </div>
        ))}
      </div>
      <div className="mvgrid__bar">
        <span className="mvgrid__sizes" role="group" aria-label="Grid size">
          {sizes.map((n) => (
            <button
              type="button"
              key={n}
              className={n === usable ? "is-on" : undefined}
              aria-pressed={n === usable}
              onClick={() => onSize(n)}
            >
              {n}
            </button>
          ))}
        </span>
        <button type="button" className="mvgrid__close" onClick={onClose}>
          Close multi-view
        </button>
      </div>
    </>
  );
}
