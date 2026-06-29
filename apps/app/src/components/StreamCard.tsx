import { useEffect } from "react";
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
}) {
  const art = layout === "landscape" ? item.backdrop ?? item.poster : item.poster;
  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey: `card-${rowId}-${item.id}`,
    onEnterPress: () => onOpen?.(item),
    onFocus: (layout: FocusableComponentLayout) => {
      if (layout.node) smoothCenterIntoView(layout.node, 250);
    },
  });
  // Mirror norigin's focus onto native DOM focus for a11y — desktop only. On TV
  // it diverges during fast nav and lights up a stale card's :focus-visible.
  useEffect(() => {
    if (focused && !isTv) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
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
