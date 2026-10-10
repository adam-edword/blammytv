import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { tabKeyTarget } from "./tabKeys";

/** One page of the rail: its key, its name, the line under it and its mark. */
export interface RailItem<K extends string> {
  key: K;
  label: string;
  /** The one-line description under the name. */
  blurb: string;
  icon?: ReactNode;
}

/**
 * A vertical tablist: Settings' five pages down the left of the card (plan
 * 025). Each item is a mark, a name and a line saying what the page is for.
 *
 * A SEPARATE CONTROL, NOT A SEGMENTED ORIENTATION. Segmented is a capsule: a
 * pill track, one word per option, a thumb measured along x, a track that
 * scrolls sideways and a wheel handler for it. A column of two-line items
 * shares none of that but its keys, so the keys are the shared part
 * (`tabKeyTarget`) and the rest is drawn for the column.
 *
 * What it keeps from Segmented: the chosen item is the same `--tint-on` chip,
 * and it is a THUMB that glides between items on the spring (the standing
 * rule from plan 014, the thumb stays), not a background that jumps. One tab
 * stop; the arrows move the choice and the focus together; Home and End jump.
 *
 * The item's accessible name is its label alone. The line under it is its
 * description, so a screen reader says "Playback, tab, 2 of 5, how it plays"
 * rather than reading the two as one name.
 */
export function Rail<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: ReadonlyArray<RailItem<K>>;
  value: K;
  onChange: (key: K) => void;
  /** The tablist's name, for a screen reader. */
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ y: 0, h: 0, snap: true });
  const id = useId();

  // Two effects, split as Segmented's are: a change of choice glides; the
  // late signals that should not animate (the webfont landing, a resize that
  // re-flows the blurbs) snap, and read the live value from a ref.
  const valueRef = useRef(value);
  valueRef.current = value;
  const measure = useCallback((snap: boolean) => {
    const el = ref.current;
    if (!el) return;
    const opt = el.querySelector<HTMLElement>(`[data-rail="${CSS.escape(valueRef.current)}"]`);
    if (!opt) {
      // A value none of these items carries: no thumb, rather than one left
      // over an item that isn't chosen.
      setThumb((prev) => (prev.h ? { y: 0, h: 0, snap: true } : prev));
      return;
    }
    setThumb((prev) => ({
      y: opt.offsetTop,
      h: opt.offsetHeight,
      // The first placement snaps; later ones glide.
      snap: snap || prev.h === 0,
    }));
  }, []);
  useLayoutEffect(() => {
    measure(false);
  }, [value, items.length, measure]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure(true);
    });
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(el);
    el.querySelectorAll<HTMLElement>("[data-rail]").forEach((o) => ro.observe(o));
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [measure, items.length]);

  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((o) => o.key === value);
    const next = tabKeyTarget(e.key, i, items.length);
    if (next === null) return;
    e.preventDefault();
    const key = items[next].key;
    onChange(key);
    ref.current
      ?.querySelector<HTMLButtonElement>(`[data-rail="${CSS.escape(key)}"]`)
      ?.focus();
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation="vertical"
      aria-label={label}
      className={"rail" + (className ? ` ${className}` : "")}
    >
      <span
        className={"rail__thumb" + (thumb.snap ? " rail__thumb--snap" : "")}
        style={{
          transform: `translateY(${thumb.y}px)`,
          height: thumb.h,
          visibility: thumb.h ? "visible" : "hidden",
        }}
        aria-hidden
      />
      {items.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            data-rail={o.key}
            className={"rail__opt" + (on ? " is-on" : "")}
            aria-label={o.label}
            aria-describedby={`${id}-${o.key}`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.key)}
            onKeyDown={onKey}
          >
            {o.icon && (
              <span className="rail__icon" aria-hidden>
                {o.icon}
              </span>
            )}
            <span className="rail__text">
              <span className="rail__name">{o.label}</span>
              <span className="rail__blurb" id={`${id}-${o.key}`}>
                {o.blurb}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
