import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MultiviewTile } from "./MultiviewTile";
import { MultiviewNotice } from "./MultiviewNotice";
import { multiviewNoticeSeen } from "./multiviewAck";
import { MV_SPACING, mvLayout, type MvKind, type Rect } from "./mvLayout";
import { VolumeIcon } from "../../ui/icons";
import type { XtreamConnections } from "../../data/xtream";

/**
 * The multi-view stage (plans 013 and 017): up to four live tiles, one with
 * sound, placed by mvLayout.
 *
 * MEASURED AND PLACED, not a CSS grid. The grid it replaces split the stage
 * into 1fr cells and letterboxed each picture somewhere inside its cell, so
 * every tile was a black box of the wrong shape. Here the stage is measured
 * and every picture is exactly 16:9, with its name in a caption row under it
 * rather than on it (Adam, on M4: "as long as it doesn't cover the content").
 */

/** Whole pixels for the element, so a picture's edges land on the grid. */
const place = (r: Rect): CSSProperties => ({
  left: Math.round(r.x),
  top: Math.round(r.y),
  width: Math.round(r.w),
  height: Math.round(r.h),
});

const under = (r: Rect): CSSProperties => ({
  left: Math.round(r.x),
  top: Math.round(r.y + r.h),
  width: Math.round(r.w),
  height: MV_SPACING.caption,
});

export function MultiviewGrid({
  streams,
  cells,
  kind,
  conns,
}: {
  /** Up to four playable streams, already resolved to URLs. */
  streams: { id: string; name: string; url: string }[];
  /** How many cells to lay out: the size the line allows. */
  cells: number;
  kind: MvKind;
  conns: XtreamConnections | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Rect | null>(null);
  // The stage's own size, re-read whenever it changes: the window, full
  // screen, the rail. Layout-timed so the first paint already has tiles in
  // their places rather than at 0,0 for a frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setBox((was) => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        return was && was.w === w && was.h === h ? was : { x: 0, y: 0, w, h };
      });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [focus, setFocus] = useState(0);
  // The notice gates the first grid ever, not this mount. Read once: it is a
  // stored flag, and re-reading it on every render would let the accept
  // inside the notice race its own dismissal.
  const [needsNotice, setNeedsNotice] = useState(() => !multiviewNoticeSeen());

  // Focus must always land on a tile that exists. Shrinking 4 to 2 while
  // watching tile 4 would otherwise leave every tile muted.
  useEffect(() => {
    if (focus >= cells) setFocus(0);
  }, [focus, cells]);

  const shown = streams.slice(0, cells);
  const layout = box ? mvLayout(kind, cells, box, MV_SPACING) : null;

  return (
    <>
      {needsNotice && (
        <MultiviewNotice conns={conns} onAccept={() => setNeedsNotice(false)} />
      )}
      <div className="mvgrid" ref={ref}>
        {layout &&
          shown.flatMap((s, i) => {
            const r = layout.tiles[i];
            if (!r) return [];
            const on = i === focus;
            return [
              <MultiviewTile
                key={s.id}
                url={s.url}
                name={s.name}
                focused={on}
                onFocus={() => setFocus(i)}
                style={place(r)}
              />,
              <div key={`cap-${s.id}`} className="mvcap" style={under(r)}>
                <span className="mvcap__name">{s.name}</span>
                {on && (
                  <span className="mvcap__sound" aria-hidden>
                    <VolumeIcon size={14} />
                  </span>
                )}
              </div>,
            ];
          })}
        {/* Fewer streams than cells is normal: you opened a 4-up and only
          * three games are on. The empty cell keeps its place and says how
          * to fill it, rather than the grid collapsing and moving the rest. */}
        {layout &&
          layout.tiles.slice(shown.length).map((r, i) => (
            <div key={`empty-${i}`} className="mvtile mvtile--empty" style={place(r)}>
              <span className="mvtile__hint">Pick a channel on the right</span>
            </div>
          ))}
      </div>
    </>
  );
}
