import { Button } from "../components/ui/button";
import {
  useCallback,
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

  /**
   * TWO EFFECTS, and the split is the whole fix.
   *
   * The indicator never glided: it teleported between modes, and had done
   * since the rail was written. Measured, not guessed — the element carried
   * `--snap` (which is `transition: none`) at rest, 60ms into a change, and
   * after it settled. So the rail has had the same thumb, colour, border and
   * 380ms spring as the settings rail all along, with the animation switched
   * off a moment after being switched on, every single time.
   *
   * The cause was `document.fonts.ready` sitting in the SAME effect as the
   * mode-change measurement. Once the webfont has loaded that promise is
   * already resolved, so `.then(() => measure(true))` fires on the microtask
   * queue immediately after every re-run — including the re-run a mode
   * change triggers. The order per click was: measure(false) sets snap
   * false, the resolved promise lands, measure(true) sets it back to true,
   * and the browser paints once, with no transition. (The ResizeObserver's
   * immediate first callback did the same thing; both had to go.)
   *
   * So: one effect owns the mode change and always glides. Another owns the
   * late signals that genuinely should snap — the font landing and a real
   * resize — and is wired ONCE on mount, where a "reposition without
   * animating" belongs. It reads the live mode from a ref rather than from
   * its own closure, which is what lets it stay mount-only.
   */
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const measure = useCallback((snap: boolean) => {
    const rail = railRef.current;
    const btn = rail?.querySelector<HTMLButtonElement>(
      `[data-mode="${modeRef.current}"]`,
    );
    if (!btn) return;
    setInd((prev) => ({
      x: btn.offsetLeft,
      w: btn.offsetWidth,
      // First placement snaps into position; later ones glide.
      snap: snap || prev.w === 0,
    }));
  }, []);

  useLayoutEffect(() => {
    measure(false);
  }, [mode, measure]);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
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
  }, [measure]);

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
          <Button variant="ghost" size="sm"
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
          </Button>
        );
      })}
    </div>
  );
}
