import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelGroup } from "@blammytv/shared";
import { StarIcon, RecentsIcon, ChevronIcon } from "./icons";
import { extractEmoji } from "../lib/emoji";

export const FAVORITES_ID = "__favorites__";
export const RECENTS_ID = "__recents__";

/** Collapsed glyph for a source: its emoji if it has one, else its first
 * character as a fallback "icon". */
function glyphFor(name: string): string {
  return extractEmoji(name) || name.trim().charAt(0).toUpperCase();
}

/** Left rail of the guide: Favorites + a collapsible source folder holding the
 * channel categories from config. When `collapsed` (the panel is dragged
 * narrow), titles are hidden and each source shows just its emoji/glyph. */
export const CategorySidebar = memo(function CategorySidebar({
  groups,
  selectedId,
  focusedId,
  onSelect,
  sourceName = "Source Name",
  collapsed = false,
}: {
  groups: ChannelGroup[];
  selectedId: string;
  /** The remote cursor's category (gets the focus ring) — distinct from the
   * active/selected category. */
  focusedId?: string;
  onSelect: (id: string) => void;
  sourceName?: string;
  collapsed?: boolean;
}) {
  const [sourceOpen, setSourceOpen] = useState(true);

  // Keep the remote-focused category scrolled into view (the rail scrolls on its
  // own). The ref rides whichever button currently matches `focusedId`.
  const focusedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusedId) focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  const visible = useMemo(
    () => groups.filter((g) => !g.hidden).sort((a, b) => a.order - b.order),
    [groups],
  );

  return (
    <aside
      className={"categories" + (collapsed ? " categories--collapsed" : "")}
      aria-label="Categories"
    >
      <button
        ref={focusedId === FAVORITES_ID ? focusedRef : undefined}
        className={
          "category category--icon" +
          (selectedId === FAVORITES_ID ? " category--active" : "") +
          (focusedId === FAVORITES_ID ? " is-focused" : "")
        }
        type="button"
        title={collapsed ? "Favorites" : undefined}
        aria-label={collapsed ? "Favorites" : undefined}
        onClick={() => onSelect(FAVORITES_ID)}
      >
        <StarIcon size={18} className="category__star" />
        {!collapsed && <span className="category__label">Favorites</span>}
      </button>

      <button
        ref={focusedId === RECENTS_ID ? focusedRef : undefined}
        className={
          "category category--icon" +
          (selectedId === RECENTS_ID ? " category--active" : "") +
          (focusedId === RECENTS_ID ? " is-focused" : "")
        }
        type="button"
        title={collapsed ? "Recents" : undefined}
        aria-label={collapsed ? "Recents" : undefined}
        onClick={() => onSelect(RECENTS_ID)}
      >
        <RecentsIcon size={18} className="category__star" />
        {!collapsed && <span className="category__label">Recents</span>}
      </button>

      <button
        className="category category--source"
        type="button"
        aria-expanded={sourceOpen}
        title={collapsed ? sourceName : undefined}
        aria-label={collapsed ? sourceName : undefined}
        onClick={() => setSourceOpen((open) => !open)}
      >
        <ChevronIcon
          size={13}
          className={
            "category__chevron" +
            (sourceOpen ? "" : " category__chevron--collapsed")
          }
        />
        {!collapsed && <span className="category__label">{sourceName}</span>}
      </button>

      {sourceOpen &&
        visible.map((g) => (
          <button
            key={g.id}
            ref={focusedId === g.id ? focusedRef : undefined}
            className={
              "category" +
              (selectedId === g.id ? " category--active" : "") +
              (focusedId === g.id ? " is-focused" : "")
            }
            type="button"
            title={collapsed ? g.name : undefined}
            aria-label={collapsed ? g.name : undefined}
            onClick={() => onSelect(g.id)}
          >
            {collapsed ? (
              <span className="category__glyph">{glyphFor(g.name)}</span>
            ) : (
              <span className="category__label">{g.name}</span>
            )}
          </button>
        ))}
    </aside>
  );
});
