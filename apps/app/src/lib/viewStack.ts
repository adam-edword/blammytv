import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A screen's own back/forward history, with scroll position.
 *
 * The app has no router: each tab keeps its own view state, so each tab has
 * to answer "what does back mean" itself. This is that answer, shared, so
 * Stream, Discover and the Library behave identically instead of three
 * near-copies drifting apart.
 *
 * Two rules the hand-rolled versions learned the hard way:
 *
 * - Stack mutation stays OUT of the setState updater. StrictMode
 *   double-invokes updaters, and a pop inside one ran twice: Back became a
 *   no-op in dev. The committed view is mirrored in a ref instead.
 * - Going FORWARD to a new page lands at the top; going BACK restores where
 *   you were. The browser clamps scrollTop when the new page is shorter, so
 *   the position has to be captured on the way out or it is already gone by
 *   the time back is pressed.
 */

type Entry<V> = { view: V; scroll: number };

/** How long to keep re-applying a restored scroll position. A back-out
 * often lands on a page whose content is still arriving (Discover refetches
 * its feed), and scrollTop silently clamps to whatever is laid out so far. */
const RESTORE_MS = 1200;

export function useViewStack<V>(initial: V | (() => V)) {
  const [view, setView] = useState<V>(initial);
  const viewRef = useRef(view);
  viewRef.current = view;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const back = useRef<Entry<V>[]>([]);
  const fwd = useRef<Entry<V>[]>([]);
  /** Scroll position to apply after the next committed view change. */
  const want = useRef<number | null>(null);

  /** Where we are right now, scroll included. Refs only, so its identity
   * never changes and the navigators below stay stable. */
  const here = useCallback(
    (): Entry<V> => ({
      view: viewRef.current,
      scroll: scrollRef.current?.scrollTop ?? 0,
    }),
    [],
  );

  const navigate = useCallback(
    (next: V) => {
      back.current.push(here());
      fwd.current = [];
      want.current = 0; // a page you have not seen starts at the top
      setView(next);
    },
    [here],
  );

  /** True when there was somewhere to go. */
  const goBack = useCallback(() => {
    const prev = back.current.pop();
    if (!prev) return false;
    fwd.current.push(here());
    want.current = prev.scroll;
    setView(prev.view);
    return true;
  }, [here]);

  const goForward = useCallback(() => {
    const next = fwd.current.pop();
    if (!next) return false;
    back.current.push(here());
    want.current = next.scroll;
    setView(next.view);
    return true;
  }, [here]);

  /** Swap the current view without touching history: a correction, not a
   * navigation (full meta landing, a stale genre normalizing). */
  const replace = useCallback((next: V | ((prev: V) => V)) => {
    setView(next);
  }, []);

  /** Hold the scroll position across something that unmounts the page
   * without navigating — playback replaces the whole Stream tree, and the
   * container that comes back is a fresh element starting at the top.
   * capture() must run BEFORE that commit, so it is called from the action
   * itself rather than an effect. */
  const held = useRef<number | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);
  const capture = useCallback(() => {
    // Only while the page is actually on screen. Playback calls this again
    // on every episode roll and source switch, by which point the container
    // is long gone — reading 0 there would throw away the real position
    // captured when playback started.
    const el = scrollRef.current;
    if (el) held.current = el.scrollTop;
  }, []);
  /** Put a position back after the next commit. Also the entry point for a
   * position that outlived the component (Discover's session snapshot). */
  const restoreTo = useCallback((y: number) => {
    want.current = y;
    setRestoreTick((t) => t + 1);
  }, []);
  const restore = useCallback(() => {
    const y = held.current;
    if (y == null) return;
    held.current = null;
    restoreTo(y);
  }, [restoreTo]);

  const reset = useCallback(() => {
    back.current = [];
    fwd.current = [];
  }, []);

  const depth = useCallback(() => back.current.length, []);

  /** The view Back would return to, without going there. Lets a screen tell
   * "you drilled in normally" from "you were dropped here", which is the
   * difference between Back meaning the page above and Back meaning the
   * page you happened to come from. */
  const peek = useCallback((): V | undefined => back.current.at(-1)?.view, []);

  useLayoutEffect(() => {
    const y = want.current;
    want.current = null;
    const el = scrollRef.current;
    if (y == null || !el) return;
    el.scrollTop = y;
    // Top of the page needs no chasing, and neither does a position that
    // already stuck.
    if (y === 0 || Math.abs(el.scrollTop - y) < 1) return;
    // Content is still growing. Re-apply until it fits or the window
    // closes, and give up the moment the user scrolls themselves: fighting
    // someone's wheel is worse than losing the position.
    let raf = 0;
    let done = false;
    const started = performance.now();
    const stop = () => {
      done = true;
      cancelAnimationFrame(raf);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
    const tick = () => {
      if (done) return;
      el.scrollTop = y;
      if (Math.abs(el.scrollTop - y) < 1 || performance.now() - started > RESTORE_MS)
        return stop();
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    raf = requestAnimationFrame(tick);
    return stop;
  }, [view, restoreTick]);

  return {
    view,
    scrollRef,
    navigate,
    goBack,
    goForward,
    replace,
    reset,
    depth,
    peek,
    capture,
    restore,
    restoreTo,
  };
}
