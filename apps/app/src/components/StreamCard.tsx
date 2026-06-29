import { useEffect, useRef } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, initials } from "../lib/vod";
import { smoothCenterIntoView } from "../lib/scroll";
import { isTv } from "../lib/tv";

/** Continue Watching hold-to-clear thresholds. */
const HOLD_MS = 500; // hold OK this long to remove an entry
const RELEASE_MS = 90; // keyup with no follow-up keydown within this = released

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

  // Hold-to-clear (Continue Watching only). Telling a hold from a tap by
  // press/release *timing* via norigin is unreliable (it throttles keydowns and
  // emits one onEnterRelease). The raw key stream is the real signal: a held OK
  // repeats keydown every ~30–50ms on BOTH keyboard (DOWN/UP pairs) and the
  // remote (DOWNs with no UP until release), all with repeat=false. So we time
  // the hold from the first keydown and treat a keyup with no follow-up keydown
  // (within RELEASE_MS) as the release: hold past HOLD_MS clears, a tap opens.
  const cb = useRef({ onOpen, onClear, item });
  cb.current = { onOpen, onClear, item };

  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey: `card-${rowId}-${item.id}`,
    // CW cards drive OK from the raw key listener below; others open on press.
    onEnterPress: () => {
      if (!onClear) onOpen?.(item);
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

  const clearable = onClear != null;
  useEffect(() => {
    if (!focused || !clearable) return;
    let firstDownAt = 0;
    let cleared = false;
    let openTimer: number | null = null;
    const cancelOpen = () => {
      if (openTimer != null) {
        clearTimeout(openTimer);
        openTimer = null;
      }
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      cancelOpen(); // still pressing — a pending release-open is premature
      if (firstDownAt === 0) firstDownAt = performance.now();
      if (!cleared && performance.now() - firstDownAt >= HOLD_MS) {
        cleared = true;
        cb.current.onClear?.();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      cancelOpen();
      // Debounce: a follow-up keydown (still held) cancels this; otherwise it's
      // a real release → open if it was a tap (not a hold that already cleared).
      openTimer = window.setTimeout(() => {
        openTimer = null;
        if (!cleared && firstDownAt !== 0) cb.current.onOpen?.(cb.current.item);
        firstDownAt = 0;
        cleared = false;
      }, RELEASE_MS);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      cancelOpen();
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [focused, clearable]);
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
