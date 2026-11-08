import { memo, useRef, useState } from "react";
import type { VodItem } from "../../stream/model";
import { itemKey } from "../../discover/data";

/** Classic's poster grid: Explorer's Thumbnails view. A listbox of titles,
 * one tab stop, arrows to move, Enter or a click to open (the normal grid's
 * behaviour: picking a title hands off to Stream). Focus is the selection,
 * as in Explorer: the focused title gets the navy caption. The infinite
 * scroll sentinel stays in DiscoverScreen, under this. */

const detail = (i: VodItem): string =>
  [i.year, i.runtimeMin ? `${i.runtimeMin} min` : ""].filter(Boolean).join(" · ");

const Thumb = memo(function Thumb({
  item,
  active,
  selected,
  onOpen,
  onFocus,
}: {
  item: VodItem;
  active: boolean;
  selected: boolean;
  onOpen: (i: VodItem) => void;
  onFocus: (key: string) => void;
}) {
  const [broken, setBroken] = useState(false);
  const key = itemKey(item);
  const sub = detail(item);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      className={"cl-disc-thumb" + (selected ? " cl-disc-thumb--sel" : "")}
      data-key={key}
      onFocus={() => onFocus(key)}
      onClick={() => onOpen(item)}
    >
      <span className="cl-disc-thumb__art">
        {item.poster && !broken ? (
          <img
            src={item.poster}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="cl-disc-thumb__mono">{item.title.slice(0, 1)}</span>
        )}
      </span>
      <span className="cl-disc-thumb__cap">
        <b>{item.title}</b>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
});

export function ClassicThumbs({
  items,
  onOpen,
}: {
  items: VodItem[];
  onOpen: (i: VodItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  // One tab stop: the selected title, else the first.
  const active = sel && items.some((i) => itemKey(i) === sel) ? sel : items[0] ? itemKey(items[0]) : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    // Columns are read from the layout: the first row is every thumb that
    // shares the first one's top.
    const cols = els.filter((el) => el.offsetTop === els[0].offsetTop).length || 1;
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    let to = at + (step[e.key] ?? 0);
    if (e.key === "Home") to = 0;
    else if (e.key === "End") to = els.length - 1;
    else if (!(e.key in step)) return;
    e.preventDefault();
    els[Math.max(0, Math.min(els.length - 1, to))]?.focus();
  };

  return (
    <div
      ref={ref}
      className="cl-disc-thumbs"
      role="listbox"
      aria-label="Titles"
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const k = itemKey(item);
        return (
          <Thumb
            key={k}
            item={item}
            active={k === active}
            selected={k === sel}
            onOpen={onOpen}
            onFocus={setSel}
          />
        );
      })}
    </div>
  );
}
