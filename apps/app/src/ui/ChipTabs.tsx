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
}: {
  tabs: ReadonlyArray<{ key: K; label: ReactNode; ariaLabel?: string }>;
  active: K;
  onChange: (key: K) => void;
}) {
  // Position the thumb off the active button's measured offsets.
  const railRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      const btn = rail.querySelector<HTMLButtonElement>(
        `[data-tab="${active}"]`,
      );
      if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    // Label widths move when the webfont lands or the rail resizes —
    // re-measure so the thumb doesn't keep a stale size.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    const ro = new ResizeObserver(measure);
    ro.observe(rail);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [active]);

  return (
    <div className="chip-tabs" ref={railRef}>
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
    </div>
  );
}
