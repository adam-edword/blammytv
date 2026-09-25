import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MultiviewTile, MvLogo, type TileChannel } from "./MultiviewTile";
import { MultiviewNotice } from "./MultiviewNotice";
import { multiviewNoticeSeen } from "./multiviewAck";
import {
  MV_SPACING,
  mvLayout,
  naturalSplit,
  nudgeSplit,
  splitAt,
  splitRange,
  type MvKind,
  type Rect,
} from "./mvLayout";
import { airing } from "./mvTile";
import { stepSound } from "./mvGrid";
import { forMultiview } from "./mvKeys";
import { scoreLine } from "./mvGames";
import type { Fixture } from "../sports/model";
import type { Programme } from "./model";
import { MuteIcon, PlusIcon, VolumeIcon } from "../../ui/icons";
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
 *
 * THE SEAM (P4b) is the gap between Focus's big tile and its stack. Drag
 * it and every tile follows the pointer 1:1, the real videos resized as it
 * goes; let go and the split is kept for this count. Double-click it, or
 * `\`, for the natural split; `[` and `]` nudge it.
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

/** The seam's grab strip: exactly the gap. Wider would put an element over
 * the pictures' edges, and nothing is drawn over a picture (M4). */
const SEAM_HIT = MV_SPACING.gap;
/** How long the seam's "Big tile 77%" stays up after a key moves it. */
const TIP_MS = 1200;

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
  split,
  onSplit,
  conns,
  soundId,
  volume,
  muted,
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
  /** Focus's split for this count, or undefined for the natural one. */
  split?: number;
  /** A drag or a key moved the seam; null is back to natural. */
  onSplit: (split: number | null) => void;
  conns: XtreamConnections | null;
  /** The stream with the sound. The tab owns it, so a Replace can hand it
   * on and the grid remembers it between visits. */
  soundId: string | null;
  /** The bar's volume and mute, for the sound tile. */
  volume: number;
  muted: boolean;
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

  // A drag holds its own split until the pointer lets go, so the tiles
  // follow it without a save per pixel. `grab` is where on the seam the
  // pointer took hold, so the seam does not jump to centre under it.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const grab = useRef({ offset: 0, moved: false });
  const [tip, setTip] = useState(false);
  const tipTimer = useRef(0);
  const flashTip = () => {
    setTip(true);
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(false), TIP_MS);
  };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  const shown = streams.slice(0, cells);
  const layout = box ? mvLayout(kind, cells, box, MV_SPACING, dragSplit ?? split) : null;
  // Only a seam that can move is offered: on a stage too short to give
  // either side more, the range has collapsed and it stays put.
  const range = box && kind === "focus" && cells >= 2 ? splitRange(cells, box, MV_SPACING) : null;
  const seam =
    range && range[1] - range[0] > 1e-6 && layout?.seam && layout.split !== undefined
      ? { ...layout.seam, split: layout.split, range }
      : null;
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

  // Tiles that have failed: they can't take the sound, so the keys pass
  // over them (a click on one already does nothing).
  const [dead, setDead] = useState<ReadonlySet<string>>(new Set());
  const markDead = (id: string, is: boolean) =>
    setDead((was) => {
      if (was.has(id) === is) return was;
      const next = new Set(was);
      if (is) next.add(id);
      else next.delete(id);
      return next;
    });

  // The tile keys from plan 017's table: 1 to 4 make that tile current (the
  // sound, and Focus's big spot), ← and → move it along, R replaces it and
  // Delete closes it. Read through a ref so the listener is added once.
  const keys = useRef({ shown, sound, dead, chooseSound, onReplace, onRemove, seam, box, cells, onSplit, flashTip });
  keys.current = { shown, sound, dead, chooseSound, onReplace, onRemove, seam, box, cells, onSplit, flashTip };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!forMultiview(e)) return;
      const k = keys.current;
      const n = Number(e.key);
      let target: GridStream | undefined;
      if (Number.isInteger(n) && n >= 1 && n <= 4) {
        target = k.shown[n - 1];
        if (target && k.dead.has(target.id)) target = undefined;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const id = stepSound(
          k.shown.map((s) => s.id),
          k.dead,
          k.sound?.id ?? null,
          e.key === "ArrowRight" ? 1 : -1,
        );
        target = k.shown.find((s) => s.id === id);
      } else if ((e.key === "r" || e.key === "R") && k.sound) {
        e.preventDefault();
        k.onReplace(k.sound.id, k.sound.name);
        return;
      } else if (e.key === "Delete" && k.sound) {
        e.preventDefault();
        k.onRemove(k.sound.id);
        return;
      } else if ((e.key === "[" || e.key === "]" || e.key === "\\") && k.seam && k.box) {
        // Focus's seam: `[` and `]` nudge it, `\` puts it back.
        e.preventDefault();
        k.onSplit(
          e.key === "\\"
            ? null
            : nudgeSplit(k.cells, k.box, MV_SPACING, k.seam.split, e.key === "]" ? 1 : -1),
        );
        k.flashTip();
        return;
      } else {
        return;
      }
      e.preventDefault();
      if (target) k.chooseSound(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {needsNotice && (
        <MultiviewNotice conns={conns} onAccept={() => setNeedsNotice(false)} />
      )}
      <div className={"mvgrid" + (dragSplit !== null ? " is-seam-drag" : "")} ref={ref}>
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
                volume={volume}
                muted={muted}
                onFocus={() => chooseSound(s)}
                onDead={(is) => markDead(s.id, is)}
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
                    {muted ? <MuteIcon size={14} /> : <VolumeIcon size={14} />}
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
        {seam && box && (
          <div
            className={"mvseam" + (dragSplit !== null ? " is-dragging" : "")}
            role="separator"
            aria-orientation="vertical"
            aria-label="Big tile size"
            aria-valuemin={Math.round(seam.range[0] * 100)}
            aria-valuemax={Math.round(seam.range[1] * 100)}
            aria-valuenow={Math.round(seam.split * 100)}
            aria-valuetext={`Big tile ${Math.round(seam.split * 100)}%`}
            tabIndex={0}
            style={{
              left: Math.round(seam.x - SEAM_HIT / 2),
              top: Math.round(seam.top),
              width: SEAM_HIT,
              height: Math.round(seam.bottom - seam.top),
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const left = ref.current?.getBoundingClientRect().left ?? 0;
              grab.current = { offset: e.clientX - left - seam.x, moved: false };
              setDragSplit(seam.split);
            }}
            onPointerMove={(e) => {
              if (dragSplit === null) return;
              const left = ref.current?.getBoundingClientRect().left ?? 0;
              grab.current.moved = true;
              setDragSplit(splitAt(cells, box, MV_SPACING, e.clientX - left - grab.current.offset));
            }}
            onPointerUp={() => {
              if (dragSplit === null) return;
              if (grab.current.moved) onSplit(dragSplit);
              setDragSplit(null);
            }}
            onPointerCancel={() => setDragSplit(null)}
            onDoubleClick={() => {
              onSplit(null);
              flashTip();
            }}
            onKeyDown={(e) => {
              // Focused, it is a splitter: ← and → move it (not the sound),
              // Home and End take it to either end.
              const to =
                e.key === "ArrowLeft" || e.key === "ArrowRight"
                  ? nudgeSplit(cells, box, MV_SPACING, seam.split, e.key === "ArrowRight" ? 1 : -1)
                  : e.key === "Home"
                    ? seam.range[0]
                    : e.key === "End"
                      ? seam.range[1]
                      : null;
              if (to === null) return;
              e.preventDefault();
              onSplit(to);
              flashTip();
            }}
          >
            <i aria-hidden />
          </div>
        )}
        {seam && box && (dragSplit !== null || tip) && (
          <>
            <div
              className="mvseam-guide"
              aria-hidden
              style={{
                left: Math.round(
                  mvLayout(kind, cells, box, MV_SPACING, naturalSplit(cells, box, MV_SPACING)).seam
                    ?.x ?? 0,
                ),
                top: Math.round(seam.top),
                height: Math.round(seam.bottom - seam.top),
              }}
            />
            <div
              className="mvseam-tip"
              aria-hidden
              style={{ left: Math.round(seam.x), top: Math.max(4, Math.round(seam.top) - 42) }}
            >
              Big tile <b>{Math.round(seam.split * 100)}%</b> · double-click to reset
            </div>
          </>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        {said}
      </div>
    </>
  );
}
