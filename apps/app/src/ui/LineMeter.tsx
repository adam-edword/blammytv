import { forwardRef, type HTMLAttributes } from "react";

/**
 * The line's count as a thing you see (plan 019, K5): multi-view's meter, one
 * dash per stream the line allows, filled for the ones in use and hatched for
 * the ones in use elsewhere. The Guide's sidebar said "3/3" in a 10px pill;
 * multi-view's bar drew these dashes. One control now.
 *
 * A line that allows more than `maxDashes` is words only: ten dashes are
 * wider than the Guide's sidebar and say nothing the number doesn't.
 *
 * forwardRef, and the rest of the props onto the span, because a Hint
 * clones it as its trigger (multi-view's bar says the words on hover once
 * they've dropped to fit).
 */
type MeterProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Streams the line allows; null when the panel doesn't say. */
  max: number | null;
  used: number;
  elsewhere?: number;
  /** The words beside the dashes. */
  text: string;
  /** Its name for a screen reader, when the words aren't the whole story. */
  label?: string;
  size?: "md" | "sm";
  maxDashes?: number;
};

export const LineMeter = forwardRef<HTMLSpanElement, MeterProps>(function LineMeter(
  { max, used, elsewhere = 0, text, label, size = "md", maxDashes = 6, className, ...rest },
  ref,
) {
  const dashes = max !== null && max <= maxDashes ? max : 0;
  return (
    <span
      ref={ref}
      {...rest}
      className={"meter" + (size === "sm" ? " meter--sm" : "") + (className ? ` ${className}` : "")}
      role="img"
      aria-label={label ?? text}
    >
      {dashes > 0 && (
        <span className="meter__dashes" aria-hidden>
          {Array.from({ length: dashes }, (_, i) => (
            <i key={i} className={i < used ? "is-on" : i < used + elsewhere ? "is-elsewhere" : undefined} />
          ))}
        </span>
      )}
      <span className="meter__text" aria-hidden>
        {text}
      </span>
    </span>
  );
});
