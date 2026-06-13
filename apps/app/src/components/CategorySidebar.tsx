import { useState } from "react";
import type { ChannelGroup } from "@blammytv/shared";
import { StarIcon, ChevronIcon } from "./icons";

export const FAVORITES_ID = "__favorites__";

/** Left rail of the guide: Favorites + a collapsible source folder holding the
 * channel categories from config. (One source for now; the folder is its own
 * unit so multiple sources can each get one later.) */
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
  const [sourceOpen, setSourceOpen] = useState(true);

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

      <button
        className="category category--source"
        type="button"
        aria-expanded={sourceOpen}
        onClick={() => setSourceOpen((open) => !open)}
      >
        <ChevronIcon
          className={
            "category__chevron" +
            (sourceOpen ? "" : " category__chevron--collapsed")
          }
        />
        <span>{sourceName}</span>
      </button>

      {sourceOpen &&
        visible.map((g) => (
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
