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
  onClear,
}: {
  title: string;
  layout: "poster" | "landscape";
  items: VodItem[];
  onOpen?: (item: VodItem) => void;
  rowId: string;
  /** Optional 0..1 watched fraction per item id (Continue Watching row). */
  progressById?: Record<string, number>;
  /** When set (Continue Watching), holding OK on a card removes it. */
  onClear?: (item: VodItem) => void;
}) {
  const { ref, focusKey } = useFocusable({
    saveLastFocusedChild: true,
    trackChildren: true,
    // Can't escape a row sideways: ◀ at the first card / ▶ at the last stays put
    // instead of norigin walking up the tree and grabbing a card in another row
    // (which read as "the cursor vanished"). ▲/▼ still move between rows.
    isFocusBoundary: true,
    focusBoundaryDirections: ["left", "right"],
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
              onClear={onClear ? () => onClear(item) : undefined}
            />
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
