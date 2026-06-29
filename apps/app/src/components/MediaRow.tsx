import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { StreamCard } from "./StreamCard";

/** A titled, horizontally-scrolling row of cards (Netflix-style). The track
 * runs off the right edge of the viewport and scrolls to reveal more. A focus
 * container so the remote remembers which card you were on when moving between
 * rows. */
export function MediaRow({
  title,
  layout,
  items,
  onOpen,
  rowId,
  progressById,
}: {
  title: string;
  layout: "poster" | "landscape";
  items: VodItem[];
  onOpen?: (item: VodItem) => void;
  rowId: string;
  /** Optional 0..1 watched fraction per item id (Continue Watching row). */
  progressById?: Record<string, number>;
}) {
  const { ref, focusKey } = useFocusable({
    saveLastFocusedChild: true,
    trackChildren: true,
  });
  if (items.length === 0) return null;
  return (
    <FocusContext.Provider value={focusKey}>
      <section className="media-row" ref={ref}>
        <h2 className="media-row__title">{title}</h2>
        <div className="media-row__track">
          {items.map((item) => (
            <StreamCard
              key={item.id}
              item={item}
              layout={layout}
              onOpen={onOpen}
              rowId={rowId}
              progressPct={progressById?.[item.id]}
            />
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
