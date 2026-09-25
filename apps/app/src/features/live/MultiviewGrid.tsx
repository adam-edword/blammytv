import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MultiviewTile, MvLogo, type TileChannel } from "./MultiviewTile";
import { MultiviewNotice } from "./MultiviewNotice";
import { multiviewNoticeSeen } from "./multiviewAck";
import { MV_SPACING, mvLayout, type MvKind, type Rect } from "./mvLayout";
import { airing } from "./mvTile";
import { scoreLine } from "./mvGames";
import type { Fixture } from "../sports/model";
import type { Programme } from "./model";
import { PlusIcon, VolumeIcon } from "../../ui/icons";
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
 *
 * THE SOUND FOLLOWS A STREAM, NOT A SLOT (audit F13, planned for P4 and
 * brought forward: P2's X made it bite). It used to be an index, so closing
 * the tile before the sound tile moved the sound to whichever stream slid
 * into that slot. It is the stream's id now, and when that stream goes the
 * sound falls to the first tile left.
 */

/** One stream in the grid, with what its tile shows. */
export interface GridStream {
  id: string;
  name: string;
  /** Null while its stream is being looked up (see `unresolved`). */
  url: string | null;
  /** The lookup came back empty. */
  unresolved?: boolean;
  channel: TileChannel;
  programmes?: Programme[];
  /** A game picked as a game, as ESPN last reported it (mvGames). */
  game?: Fixture;
}

/** How often what is on, and its progress line, move on. */
const TICK_MS = 30_000;

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
  soundId,
  onSound,
  onRemove,
  onReplace,
  onRetryResolve,
  onAdd,
  atCap,
}: {
  /** The grid's channels, in order. */
  streams: GridStream[];
  /** How many cells to lay out: the streams, and a place to add one while
   * there is only one (mvGrid.cellsFor). */
  cells: number;
  kind: MvKind;
  conns: XtreamConnections | null;
  /** The stream with the sound. The tab owns it, so a Replace can hand it
   * on and the grid remembers it between visits. */
  soundId: string | null;
  onSound: (id: string) => void;
  /** A tile's X: close that stream. */
  onRemove: (id: string) => void;
  /** A tile's Replace: open the picker for its place. */
  onReplace: (id: string, name: string) => void;
  onRetryResolve: (id: string) => void;
  /** The empty place: open the picker to add. */
  onAdd: () => void;
  /** The line is full. */
  atCap: boolean;
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

  // The notice gates the first grid ever, not this mount. Read once: it is a
  // stored flag, and re-reading it on every render would let the accept
  // inside the notice race its own dismissal.
  const [needsNotice, setNeedsNotice] = useState(() => !multiviewNoticeSeen());

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  const shown = streams.slice(0, cells);
  const layout = box ? mvLayout(kind, cells, box, MV_SPACING) : null;
  // Always a tile that exists: the one chosen, or the first when that one
  // has gone (closed, or dropped by a smaller grid). Derived, not stored,
  // so there is no frame where every tile is muted.
  const sound =
    shown.find((s) => s.id === soundId) ?? shown.find((s) => !s.unresolved) ?? shown[0];

  // "Sound: CNN", read out when the sound moves, not when the grid opens.
  const [said, setSaid] = useState("");
  const chooseSound = (s: GridStream) => {
    if (s.id !== sound?.id) setSaid(`Sound: ${s.name}`);
    onSound(s.id);
  };

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
            const on = s.id === sound?.id;
            const onNow = airing(s.programmes, now).now;
            return [
              <MultiviewTile
                key={s.id}
                url={s.url}
                unresolved={s.unresolved}
                name={s.name}
                channel={s.channel}
                programmes={s.programmes}
                game={s.game}
                now={now}
                focused={on}
                onFocus={() => chooseSound(s)}
                onRemove={() => onRemove(s.id)}
                onReplace={() => onReplace(s.id, s.name)}
                onRetryResolve={() => onRetryResolve(s.id)}
                atCap={atCap}
                style={place(r)}
              />,
              // The caption: who it is and what is on, under the picture.
              <div key={`cap-${s.id}`} className="mvcap" style={under(r)}>
                <MvLogo channel={s.channel} size={20} />
                <span className="mvcap__name">{s.name}</span>
                {on && (
                  <span className="mvcap__sound" aria-hidden>
                    <VolumeIcon size={14} />
                  </span>
                )}
                {s.game ? (
                  <span className="mvcap__now">
                    {scoreLine(s.game)}
                    {s.game.status ? ` · ${s.game.status}` : ""}
                  </span>
                ) : (
                  onNow && <span className="mvcap__now">{onNow.title}</span>
                )}
              </div>,
            ];
          })}
        {/* The place to add one: the whole stage while the grid is empty,
          * and beside a lone stream (frame E). */}
        {layout &&
          layout.tiles.slice(shown.length).map((r, i) => (
            <button
              key={`empty-${i}`}
              type="button"
              className="mvtile mvtile--empty"
              style={place(r)}
              onClick={onAdd}
            >
              <span className="mvadd__plus" aria-hidden>
                <PlusIcon size={20} />
              </span>
              <span className="mvadd__title">Add a channel</span>
              <span className="mvadd__sub">
                A live game or any channel. Or press <kbd>A</kbd>
              </span>
            </button>
          ))}
      </div>
      <div className="sr-only" aria-live="polite">
        {said}
      </div>
    </>
  );
}
