import { useEffect } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, initials } from "../lib/vod";

/** A single Stream catalog card. Posters are 2:3, landscape stills are 16:9
 * (used by rows like Continue Watching). Artwork falls back to a monogram
 * placeholder when the backend hasn't supplied an image. */
export function StreamCard({
  item,
  layout,
  onOpen,
}: {
  item: VodItem;
  layout: "poster" | "landscape";
  onOpen?: (item: VodItem) => void;
}) {
  const art = layout === "landscape" ? item.backdrop ?? item.poster : item.poster;
  const { ref, focused } = useFocusable<HTMLButtonElement>({
    onEnterPress: () => onOpen?.(item),
    onFocus: (layout: FocusableComponentLayout) =>
      layout.node?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      }),
  });
  // Mirror norigin's focus onto the native DOM focus too (keeps a11y honest).
  useEffect(() => {
    if (focused) ref.current?.focus({ preventScroll: true });
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
      </div>
      <span className="stream-card__title">{item.title}</span>
      <span className="stream-card__meta">{formatMeta(item)}</span>
    </button>
  );
}
