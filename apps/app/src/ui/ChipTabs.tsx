import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The chip rail from the redesign: near-black track, one raised #2a2a2a thumb
 * that slides under the active label. Used for the settings tabs, the
 * playlist-kind sub-tabs, and the Live sidebar's mode rail; labels are Bold 12
 * everywhere, inactive ones dimmed. Labels can be any node (icons included) —
 * the thumb re-measures whenever content changes size.
 */
export function ChipTabs<K extends string>({
  tabs,
  active,
  onChange,
  className,
  thumbKey,
  trailing,
}: {
  tabs: ReadonlyArray<{ key: K; label: ReactNode; ariaLabel?: string }>;
  active: K;
  onChange: (key: K) => void;
  /** Modifier classes, e.g. "chip-tabs--bare" (trackless header rail). */
  className?: string;
  /** Park the thumb on this data-tab instead of `active` — the header
   * rail slides it onto the search chip while its input is focused.
   * The thumb is presentation; `active` stays the truth of which page
   * is showing. */
  thumbKey?: string;
  /** Extra chip(s) after the tabs, inside the rail — give them a
   * data-tab to be thumb-targetable (they're observed for resize like
   * the buttons, so a width-morphing chip drags the thumb with it). */
  trailing?: ReactNode;
}) {
  // Position the thumb off the active button's measured offsets.
  const railRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const target = thumbKey ?? active;
    const measure = () => {
      const btn = rail.querySelector<HTMLElement>(`[data-tab="${target}"]`);
      if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    // Label widths move when the webfont lands, the rail resizes, or a chip
    // animates its own width (the Live rail's fixed-geometry morph) —
    // observe the buttons too so the thumb tracks them mid-transition.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    const ro = new ResizeObserver(measure);
    ro.observe(rail);
    rail
      .querySelectorAll<HTMLElement>("[data-tab]")
      .forEach((btn) => ro.observe(btn));
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [active, thumbKey]);

  return (
    <div
      className={"chip-tabs" + (className ? ` ${className}` : "")}
      ref={railRef}
    >
      {thumb && (
        <span
          className="chip-tabs__thumb"
          style={{ left: thumb.left, width: thumb.width }}
          aria-hidden
        />
      )}
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          data-tab={tab.key}
          aria-label={tab.ariaLabel}
          className={
            "chip-tabs__tab" + (tab.key === active ? " chip-tabs__tab--active" : "")
          }
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}
