import type { VodItem } from "@blammytv/shared";
import { StreamCard } from "./StreamCard";

/** A titled, horizontally-scrolling row of cards (Netflix-style). The track
 * runs off the right edge of the viewport and scrolls to reveal more. */
export function MediaRow({
  title,
  layout,
  items,
}: {
  title: string;
  layout: "poster" | "landscape";
  items: VodItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="media-row">
      <h2 className="media-row__title">{title}</h2>
      <div className="media-row__track">
        {items.map((item) => (
          <StreamCard key={item.id} item={item} layout={layout} />
        ))}
      </div>
    </section>
  );
}
