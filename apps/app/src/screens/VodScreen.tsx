import type { VodItem } from "@blammytv/shared";
import { MediaCard } from "../components/MediaCard";

/** Shared grid for the Series and Movies tabs. */
export function VodScreen({
  items,
  favorites,
  emptyLabel,
}: {
  items: VodItem[];
  favorites: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <div className="vod-empty">{emptyLabel}</div>;
  }
  const favSet = new Set(favorites);
  return (
    <div className="vod-screen">
      <div className="poster-grid">
        {items.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            favorite={favSet.has(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
