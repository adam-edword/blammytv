import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MiniGuideView } from "./MiniGuide";
import {
  loadShape,
  saveShape,
  stepFrom,
  type MiniGuideData,
  type MiniShape,
} from "./miniGuideModel";

/**
 * The mini-guide (plan 036): change channel without leaving the player. A
 * strip of cards where the channel's logo and title sit, or a list down the
 * left, and a switch inside it for which. It lists the Guide's current list in
 * the Guide's order, and browsing it tunes nothing: Enter or a click does.
 * PageUp and PageDown tune at once and show the strip for a moment.
 *
 * `useMiniGuide` is the state and the keys, called by TheaterOverlay with what
 * the host (LiveScreen) offers; it draws nothing itself. The overlay places
 * `node` and sends every key through `key` ahead of its own, so Escape closes
 * this before it would leave full screen. Stream and Sports pass nothing, and
 * every key then falls through as it always did.
 */

/** How long PageUp and PageDown leave the strip up. */
const PEEK_MS = 2600;

type Mode = "open" | "peek" | null;

export interface MiniGuideHandle {
  /** There is a list to browse (live, theater or fullscreen, host gave one). */
  available: boolean;
  /** Open for browsing, not the peek after PageUp or PageDown. */
  open: boolean;
  /** What is drawn: null, or the strip (a peek is always the strip). */
  shown: MiniShape | null;
  /** G and the button. */
  toggle: () => void;
  close: () => void;
  /** One key. True when the guide took it. */
  key: (key: string) => boolean;
  node: ReactNode;
}

export function useMiniGuide(data: MiniGuideData | undefined): MiniGuideHandle {
  const [mode, setMode] = useState<Mode>(null);
  const [shape, setShapeState] = useState<MiniShape>(loadShape);
  const [sel, setSel] = useState(0);
  // The key handler is one stable function that reads the live values.
  const dataRef = useRef(data);
  dataRef.current = data;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const selRef = useRef(sel);
  selRef.current = sel;
  const peekTimer = useRef(0);

  const setModeNow = useCallback((m: Mode) => {
    modeRef.current = m;
    setMode(m);
  }, []);
  const select = useCallback((i: number) => {
    selRef.current = i;
    setSel(i);
  }, []);
  const close = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    setModeNow(null);
  }, [setModeNow]);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  // Open and shut, for the host. The callback is the one from the open, so
  // the close still reaches it when the list has already gone (gone mini).
  const isOpen = mode === "open";
  useEffect(() => {
    if (!isOpen) return;
    const told = dataRef.current?.onOpenChange;
    told?.(true);
    return () => told?.(false);
  }, [isOpen]);
  // Gone with the list: the player went mini, or became a film.
  useEffect(() => {
    if (!data) close();
  }, [data, close]);

  const playingIndex = useCallback(() => {
    const d = dataRef.current;
    return d ? d.channels.findIndex((c) => c.channel.id === d.playingId) : -1;
  }, []);
  const tune = useCallback((i: number) => {
    const d = dataRef.current;
    const c = d?.channels[i];
    // The playing channel again is no tune: it would only reorder Recents.
    if (d && c && c.channel.id !== d.playingId) d.onTune(c.channel.id);
  }, []);
  const open = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    select(Math.max(0, playingIndex()));
    setModeNow("open");
  }, [playingIndex, select, setModeNow]);
  const toggle = useCallback(() => {
    if (!dataRef.current?.channels.length) return;
    if (modeRef.current === "open") close();
    else open();
  }, [close, open]);
  const pick = useCallback(
    (i: number) => {
      tune(i);
      close();
    },
    [close, tune],
  );
  const setShape = useCallback((s: MiniShape) => {
    setShapeState(s);
    saveShape(s);
  }, []);

  const key = useCallback(
    (k: string): boolean => {
      const d = dataRef.current;
      const n = d?.channels.length ?? 0;
      if (!d || n === 0) return false;
      const lk = k.toLowerCase();
      const m = modeRef.current;
      if (lk === "g") {
        toggle();
        return true;
      }
      if (lk === "pageup" || lk === "pagedown") {
        // One channel has nowhere to go: leave the key alone.
        if (n < 2) return false;
        // Browsing, the selection moves and tunes. Otherwise from the one playing.
        const from = m ? selRef.current : playingIndex();
        const i = stepFrom(from, lk === "pagedown" ? 1 : -1, n);
        select(i);
        tune(i);
        if (m !== "open") {
          window.clearTimeout(peekTimer.current);
          setModeNow("peek");
          peekTimer.current = window.setTimeout(close, PEEK_MS);
        }
        return true;
      }
      if (m === null) return false;
      if (lk === "escape") {
        close();
        return true;
      }
      if (m !== "open") return false;
      if (lk === "enter") {
        pick(Math.min(selRef.current, n - 1));
        return true;
      }
      // The arrows that lie along the shape move; the other two stay the
      // volume or the seek, as they are with it shut.
      const along = shapeRef.current === "strip" ? ["arrowleft", "arrowright"] : ["arrowup", "arrowdown"];
      const at = along.indexOf(lk);
      if (at < 0) return false;
      select(Math.min(n - 1, Math.max(0, Math.min(selRef.current, n - 1) + (at ? 1 : -1))));
      return true;
    },
    [close, pick, playingIndex, select, setModeNow, toggle, tune],
  );

  const shown: MiniShape | null = mode === null ? null : mode === "peek" ? "strip" : shape;
  const node =
    data && shown ? (
      <MiniGuideView
        // A new view per shape, so a switch lands the selection without the glide.
        key={shown}
        data={data}
        shape={shown}
        peek={mode === "peek"}
        sel={Math.min(sel, data.channels.length - 1)}
        onPick={pick}
        onShape={setShape}
      />
    ) : null;

  return {
    available: !!data && data.channels.length > 0,
    open: mode === "open",
    shown: data ? shown : null,
    toggle,
    close,
    key,
    node,
  };
}
