import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Hint } from "./Hint";

/** One option: its key, its word (also its accessible name) and its mark. */
export interface SegOption<K extends string> {
  key: K;
  label: string;
  /** A function when the mark changes with the choice (the Guide's star goes
   * rainbow when it is the chosen mode). */
  icon?: ReactNode | ((on: boolean) => ReactNode);
  /** The tooltip, for when the word isn't showing. Defaults to the word. */
  hint?: string;
}

/**
 * THE segmented control (plan 019, K2): multi-view's `.mvseg`, the capsule's
 * glass with round ends, and a thumb that SLIDES to the chosen option.
 *
 * One control where there were five drawings of it: ChipTabs (Settings and
 * onboarding), the sidebars' ModeRail, the season bar, the draw filter and
 * multi-view's own Grid and Focus. Each looked like a different thing
 * because each was built for one screen.
 *
 * THE THUMB STAYS (Adam, 2026-09-06, plan 014): the chosen option is a 16%
 * tint that moves between options on the spring, not a background that
 * jumps. It is the capsule's own travelling pill at control scale.
 *
 * TWO ROLES, because two different things wear this shape:
 * - `tabs` switches what the panel under it shows. A tablist, one tab stop,
 *   and the arrows move the choice and the focus together (plan 016 3.4).
 * - `choice` sets a value (Grid or Focus, a season). Pressed buttons, each
 *   its own tab stop, which is what they were and what harnesses read.
 */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  role = "choice",
  words = "all",
  hints = false,
  size = "md",
  fill = false,
  label,
  className,
}: {
  options: ReadonlyArray<SegOption<K>>;
  value: K;
  onChange: (key: K) => void;
  role?: "tabs" | "choice";
  /** Which options show their word: all of them, only the chosen one (the
   * sidebars, where the chosen mode is named and the rest are marks), or
   * none (marks only, the word as a tooltip). */
  words?: "all" | "chosen" | "none";
  /** Tooltips on every option even with the words showing, for a caller
   * that hides the words itself (multi-view's bar at a narrow width). */
  hints?: boolean;
  size?: "md" | "sm";
  /** Stretch across the row, options spread out (the sidebars' rails). */
  fill?: boolean;
  /** The group's name, for a screen reader. */
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0, snap: true });

  /**
   * TWO EFFECTS, and the split is ModeRail's hard-won fix, kept. A change of
   * choice always glides. The late signals that should NOT animate (the
   * webfont landing, a real resize) are wired once on mount and read the live
   * value from a ref. In one effect, `document.fonts.ready` (already resolved
   * once the font is in) fires right after every re-run and snaps the thumb
   * a frame after the glide started, so it never glided at all.
   */
  const valueRef = useRef(value);
  valueRef.current = value;
  const measure = useCallback((snap: boolean) => {
    const opt = ref.current?.querySelector<HTMLElement>(
      `[data-seg="${CSS.escape(valueRef.current)}"]`,
    );
    if (!opt) return;
    setThumb((prev) => ({
      x: opt.offsetLeft,
      w: opt.offsetWidth,
      // The first placement snaps; later ones glide.
      snap: snap || prev.w === 0,
    }));
  }, []);
  useLayoutEffect(() => {
    measure(false);
  }, [value, words, measure]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure(true);
    });
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(el);
    el.querySelectorAll<HTMLElement>("[data-seg]").forEach((o) => ro.observe(o));
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [measure, options.length]);

  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (role !== "tabs") return;
    const i = options.findIndex((o) => o.key === value);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else return;
    e.preventDefault();
    const key = options[next].key;
    onChange(key);
    ref.current
      ?.querySelector<HTMLButtonElement>(`[data-seg="${CSS.escape(key)}"]`)
      ?.focus();
  };

  return (
    <div
      ref={ref}
      role={role === "tabs" ? "tablist" : "group"}
      aria-label={label}
      className={
        "seg" +
        (size === "sm" ? " seg--sm" : "") +
        (fill ? " seg--fill" : "") +
        (className ? ` ${className}` : "")
      }
    >
      <span
        className={"seg__thumb" + (thumb.snap ? " seg__thumb--snap" : "")}
        style={{
          transform: `translateX(${thumb.x}px)`,
          width: thumb.w,
          visibility: thumb.w ? "visible" : "hidden",
        }}
        aria-hidden
      />
      {options.map((o) => {
        const on = o.key === value;
        const mark = typeof o.icon === "function" ? o.icon(on) : o.icon;
        const button = (
          <button
            key={o.key}
            type="button"
            data-seg={o.key}
            className={"seg__opt" + (on ? " is-on" : "")}
            aria-label={o.label}
            {...(role === "tabs"
              ? { role: "tab", "aria-selected": on, tabIndex: on ? 0 : -1 }
              : { "aria-pressed": on })}
            onClick={() => onChange(o.key)}
            onKeyDown={onKey}
          >
            {mark}
            {words === "all" && <span className="seg__word">{o.label}</span>}
            {words === "chosen" && (
              // Every word stacks in one cell, the others invisible, so the
              // chosen option is the same width whichever one it is and the
              // marks beside it don't shuffle.
              <span className="seg__words" aria-hidden>
                {options.map((x) => (
                  <span key={x.key} className={x.key === o.key ? undefined : "is-ghost"}>
                    {x.label}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
        const tip = words === "none" || hints || (words === "chosen" && !on);
        return tip ? (
          <Hint key={o.key} label={o.hint ?? o.label}>
            {button}
          </Hint>
        ) : (
          button
        );
      })}
    </div>
  );
}
