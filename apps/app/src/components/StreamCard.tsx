import { useEffect, useRef, useState } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, initials } from "../lib/vod";
import { smoothCenterIntoView } from "../lib/scroll";
import { isTv } from "../lib/tv";

// A held OK repeats keydown ~30–50ms on both keyboard (DOWN/UP pairs) and remote
// (DOWNs, no UP until release), all repeat=false — so we time the press from the
// raw key stream rather than norigin's throttled press/release.
const HINT_MS = 500; // CW: overlay appears, and the tap-vs-hold boundary
const HOLD_MS = 2000; // CW: hold this long to remove the entry
const RELEASE_MS = 90; // a keyup with no follow-up keydown within this = released

// Module-level: a hold just removed a card. Focus jumps to a sibling, but the
// key is still down — consume the rest of that physical press so its release
// doesn't open the card focus landed on.
let holdConsumed = false;

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
  /** When set (Continue Watching), holding OK removes the entry (a tap opens),
   * and a "continue holding to clear" overlay shows once the hold passes 0.5s. */
  onClear?: () => void;
}) {
  const art = layout === "landscape" ? item.backdrop ?? item.poster : item.poster;
  const cb = useRef({ onOpen, onClear, item });
  cb.current = { onOpen, onClear, item };
  const [pressed, setPressed] = useState(false);
  const [holdHint, setHoldHint] = useState(false);
  const clearable = onClear != null;

  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey: `card-${rowId}-${item.id}`,
    // OK is driven by the raw key listener below (so we can animate the press and
    // act on release, plus hold-to-clear on CW); onEnterPress is a no-op.
    onEnterPress: () => {},
    onFocus: (layout: FocusableComponentLayout) => {
      if (layout.node) smoothCenterIntoView(layout.node, 250);
    },
  });
  // Mirror norigin's focus onto native DOM focus for a11y — desktop only. On TV
  // it diverges during fast nav and lights up a stale card's :focus-visible.
  useEffect(() => {
    if (focused && !isTv) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);

  // Press handling for the focused card: shrink while OK is down, expand + act on
  // release. A tap opens; on CW, holding past HOLD_MS removes the entry.
  useEffect(() => {
    if (!focused) return;
    let firstDownAt = 0;
    let lastUpAt = 0;
    let cleared = false;
    let releaseTimer: number | null = null;
    let hintTimer: number | null = null;
    const cancelRelease = () => {
      if (releaseTimer != null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
    };
    const cancelHint = () => {
      if (hintTimer != null) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      cancelRelease(); // still pressing — a pending release is premature
      if (holdConsumed) return; // tail of a hold that already cleared a card
      if (firstDownAt === 0) {
        firstDownAt = performance.now();
        setPressed(true);
        if (clearable) hintTimer = window.setTimeout(() => setHoldHint(true), HINT_MS);
      }
      if (clearable && !cleared && performance.now() - firstDownAt >= HOLD_MS) {
        cleared = true;
        holdConsumed = true; // swallow the rest of this press across the unmount
        cancelHint();
        setHoldHint(false);
        setPressed(false);
        cb.current.onClear?.();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      lastUpAt = performance.now();
      cancelRelease();
      releaseTimer = window.setTimeout(() => {
        releaseTimer = null;
        setPressed(false);
        cancelHint();
        setHoldHint(false);
        if (holdConsumed) {
          holdConsumed = false;
          firstDownAt = 0;
          cleared = false;
          return;
        }
        const held = firstDownAt ? lastUpAt - firstDownAt : 0;
        // Open on a tap (or any release for non-CW cards). A CW card held long
        // enough to show the overlay, then released, cancels — no open.
        if (!cleared && firstDownAt !== 0 && (!clearable || held < HINT_MS)) {
          cb.current.onOpen?.(cb.current.item);
        }
        firstDownAt = 0;
        cleared = false;
      }, RELEASE_MS);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      cancelRelease();
      cancelHint();
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      setPressed(false);
      setHoldHint(false);
    };
  }, [focused, clearable]);

  return (
    <button
      ref={ref}
      className={
        `stream-card stream-card--${layout}` +
        (focused ? " is-focused" : "") +
        (pressed ? " is-pressed" : "")
      }
      type="button"
      title={item.title}
      onClick={() => onOpen?.(item)}
    >
      <div className="stream-card__art">
        {art ? (
          <img src={art} alt="" loading="lazy" decoding="async" />
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
        {holdHint && (
          <div className="stream-card__hold" aria-hidden="true">
            Continue holding to clear
          </div>
        )}
      </div>
      <span className="stream-card__title">{item.title}</span>
      <span className="stream-card__meta">{formatMeta(item)}</span>
    </button>
  );
}
