import { useEffect, useRef } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, initials } from "../lib/vod";
import { smoothCenterIntoView } from "../lib/scroll";
import { isTv } from "../lib/tv";

/** Hold OK/center this long to fire the clear action (Continue Watching). */
const HOLD_MS = 600;

/** A single Stream catalog card. Posters are 2:3, landscape stills are 16:9
 * (used by rows like Continue Watching). Artwork falls back to a monogram
 * placeholder when the backend hasn't supplied an image. */
export function StreamCard({
  item,
  layout,
  onOpen,
  rowId,
  progressPct,
  onClear,
}: {
  item: VodItem;
  layout: "poster" | "landscape";
  onOpen?: (item: VodItem) => void;
  /** Row id — combined with the item id for a stable, unique focus key so focus
   * survives navigating away and back. */
  rowId: string;
  /** 0..1 watched fraction — draws a Continue Watching progress bar on the art
   * (only meaningful on landscape cards). */
  progressPct?: number;
  /** When set (Continue Watching), holding OK/center fires this to remove the
   * card; a quick tap still opens. Without it, the card opens on press as usual. */
  onClear?: () => void;
}) {
  const art = layout === "landscape" ? item.backdrop ?? item.poster : item.poster;

  // Hold-to-clear (CW only): onEnterPress is keydown, onEnterRelease is keyup, so
  // a timer started on press and cancelled on release distinguishes hold vs tap.
  const holdTimer = useRef<number | null>(null);
  const holdFired = useRef(false);
  const clearHoldTimer = () => {
    if (holdTimer.current != null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey: `card-${rowId}-${item.id}`,
    onEnterPress: () => {
      if (!onClear) {
        onOpen?.(item);
        return;
      }
      if (holdTimer.current != null) return; // key-repeat while already held
      holdFired.current = false;
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        holdFired.current = true;
        onClear();
      }, HOLD_MS);
    },
    onEnterRelease: () => {
      if (!onClear) return;
      clearHoldTimer();
      if (holdFired.current) holdFired.current = false; // hold cleared it; swallow open
      else onOpen?.(item); // it was a tap
    },
    onFocus: (layout: FocusableComponentLayout) => {
      if (layout.node) smoothCenterIntoView(layout.node, 250);
    },
  });
  // Mirror norigin's focus onto native DOM focus for a11y — desktop only. On TV
  // it diverges during fast nav and lights up a stale card's :focus-visible.
  useEffect(() => {
    if (focused && !isTv) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  // Don't let a pending hold-timer fire after the card unmounts.
  useEffect(() => clearHoldTimer, []);
  return (
    <button
      ref={ref}
      className={
        `stream-card stream-card--${layout}` + (focused ? " is-focused" : "")
      }
      type="button"
      title={item.title}
      onClick={() => onOpen?.(item)}
    >
      <div className="stream-card__art">
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="stream-card__placeholder">{initials(item.title)}</span>
        )}
        {progressPct != null && progressPct > 0 && (
          <div className="stream-card__progress" aria-hidden="true">
            <div
              className="stream-card__progress-fill"
              style={{ width: `${Math.min(100, progressPct * 100)}%` }}
            />
          </div>
        )}
      </div>
      <span className="stream-card__title">{item.title}</span>
      <span className="stream-card__meta">{formatMeta(item)}</span>
    </button>
  );
}
