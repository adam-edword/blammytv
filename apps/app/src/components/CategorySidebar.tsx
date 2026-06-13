import type { ChannelGroup } from "@blammytv/shared";
import { StarIcon, ChevronIcon } from "./icons";

export const FAVORITES_ID = "__favorites__";

/** Left rail of the guide: Favorites + the channel categories from config. */
export function CategorySidebar({
  groups,
  selectedId,
  onSelect,
  sourceName = "Source Name",
}: {
  groups: ChannelGroup[];
  selectedId: string;
  onSelect: (id: string) => void;
  sourceName?: string;
}) {
  const visible = groups
    .filter((g) => !g.hidden)
    .sort((a, b) => a.order - b.order);

  return (
    <aside className="categories" aria-label="Categories">
      <button
        className={
          "category category--icon" +
          (selectedId === FAVORITES_ID ? " category--active" : "")
        }
        type="button"
        onClick={() => onSelect(FAVORITES_ID)}
      >
        <StarIcon className="category__star" />
        <span>Favorites</span>
      </button>

      <div className="category category--source">
        <ChevronIcon className="category__chevron" />
        <span>{sourceName}</span>
      </div>

      {visible.map((g) => (
        <button
          key={g.id}
          className={
            "category" + (selectedId === g.id ? " category--active" : "")
          }
          type="button"
          onClick={() => onSelect(g.id)}
        >
          {g.name}
        </button>
      ))}
    </aside>
  );
}
