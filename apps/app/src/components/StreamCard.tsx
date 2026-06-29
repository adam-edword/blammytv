import { useEffect, useRef } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, initials } from "../lib/vod";
import { smoothCenterIntoView } from "../lib/scroll";
import { isTv } from "../lib/tv";

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
  // press/release *timing* is unreliable — keyboard autorepeat and the emulator
  // emit early or paired keyups, so a held key reads as a tap. Instead detect
  // the hold from keydown `event.repeat`, which Chromium sets true for both a
  // held remote button and keyboard autorepeat. A quick tap (no repeat) opens;
  // the open is debounced so a stray autorepeat keyup landing just before the
  // first repeat doesn't open prematurely.
  const cb = useRef({ onOpen, onClear, item });
  cb.current = { onOpen, onClear, item };
  const cleared = useRef(false);
  const openTimer = useRef<number | null>(null);
  const cancelOpen = () => {
    if (openTimer.current != null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey: `card-${rowId}-${item.id}`,
    onEnterPress: () => {
      if (!onClear) {
        onOpen?.(item);
        return;
      }
      cleared.current = false; // start of a fresh press
      cancelOpen();
    },
    onEnterRelease: () => {
      if (!onClear) return;
      if (cleared.current) {
        cleared.current = false; // a hold already removed it — swallow the open
        return;
      }
      cancelOpen();
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        if (!cleared.current) cb.current.onOpen?.(cb.current.item);
      }, 140);
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

  // While focused, a held OK/center autorepeats — `event.repeat` flags it as a
  // hold and removes the entry (once), independent of release timing.
  const clearable = onClear != null;
  useEffect(() => {
    if (!focused || !clearable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !e.repeat || cleared.current) return;
      cleared.current = true;
      cancelOpen();
      cb.current.onClear?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focused, clearable]);
  useEffect(() => cancelOpen, []);
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
