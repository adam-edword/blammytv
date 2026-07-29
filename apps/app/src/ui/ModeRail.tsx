import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/** One tab: its stored key, the word on the pill, and its mark. The icon is
 * a function of `active` because at least one of them changes when selected
 * (Live's star goes rainbow). */
export interface RailMode<K extends string> {
  key: K;
  label: string;
  icon: (active: boolean) => ReactNode;
}

/**
 * The sidebar's mode rail, built to the Claude app's actual mechanics
 * (verified from its DOM): buttons resize INSTANTLY when the label
 * collapses/expands, and a single indicator element glides to the settled
 * target via transform+width. One animated element, exact one-shot
 * measurement, nothing to chase.
 *
 * Shared rather than copied. It was Live TV's, and the Sports board wanted
 * the same sidebar; a second copy is how two rails that are meant to be the
 * same control drift into two controls that nearly are. The modes are the
 * only thing that differs, so the modes are the argument.
 *
 * The stylesheet stays in live.css under .mode-rail, which is where every
 * rule for it already lives and where the theme packs already reach for it.
 */
export function ModeRail<K extends string>({
  modes,
  mode,
  onChange,
}: {
  modes: RailMode<K>[];
  mode: K;
  onChange: (m: K) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0, snap: true });

  // Roving-tabindex arrow-key navigation (WAI-ARIA tablist): only the active
  // tab is in the tab order; arrows move selection AND focus, Home/End jump to
  // the ends.
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const i = modes.findIndex((m) => m.key === mode);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = (i + 1) % modes.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + modes.length) % modes.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = modes.length - 1;
    else return;
    e.preventDefault();
    const key = modes[next].key;
    onChange(key);
    railRef.current
      ?.querySelector<HTMLButtonElement>(`[data-mode="${key}"]`)
      ?.focus();
  };

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = (snap: boolean) => {
      const btn = rail.querySelector<HTMLButtonElement>(
        `[data-mode="${mode}"]`,
      );
      if (btn) {
        setInd((prev) => ({
          x: btn.offsetLeft,
          w: btn.offsetWidth,
          // First placement snaps into position; later ones glide.
          snap: snap || prev.w === 0,
        }));
      }
    };
    measure(false);
    // Font load / rail resize move the settled targets — reposition
    // without animating.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure(true);
    });
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(rail);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [mode]);

  return (
    <div className="mode-rail" role="tablist" ref={railRef}>
      <div
        className={
          "mode-rail__indicator" +
          (ind.snap ? " mode-rail__indicator--snap" : "")
        }
        style={{
          transform: `translateX(${ind.x}px)`,
          width: ind.w,
          visibility: ind.w ? "visible" : "hidden",
        }}
        aria-hidden
      />
      {modes.map((m) => {
        const active = m.key === mode;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            data-mode={m.key}
            aria-selected={active}
            aria-label={m.label}
            tabIndex={active ? 0 : -1}
            className={
              "mode-rail__chip" + (active ? " mode-rail__chip--active" : "")
            }
            onClick={() => onChange(m.key)}
            onKeyDown={onKey}
          >
            {m.icon(active)}
            {/* Every label stacks in one grid cell so the active pill is the
             * same width in every mode — otherwise space-between nudges the
             * idle icons as the pill's label length changes. */}
            <span className="mode-rail__label" aria-hidden>
              {modes.map((x) => (
                <span
                  key={x.key}
                  className={
                    "mode-rail__label-line" +
                    (x.key === m.key ? "" : " mode-rail__label-line--ghost")
                  }
                >
                  {x.label}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
