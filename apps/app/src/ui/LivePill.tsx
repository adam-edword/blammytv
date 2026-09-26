import type { ReactNode } from "react";

/**
 * LIVE, drawn one way (plan 019, K4): multi-view's tile pill. It was three
 * things before: the Guide hero's accent-bordered pill, Sports' red dot and
 * the theater's button (plan 016 3.3 counted them).
 *
 * The dot is the accent, the app's signal for "this is live". The fill is a
 * tint of the text colour it sits in, so it reads on a picture (white ink)
 * and on the page alike. `behind` replaces the word with how far behind live
 * a stream has fallen, on a quieter dot.
 */
export function LivePill({
  behind,
  children,
  className,
}: {
  behind?: string | null;
  /** Words other than LIVE (a game's clock). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={"live-pill" + (behind ? " is-behind" : "") + (className ? ` ${className}` : "")}>
      {behind ?? children ?? "LIVE"}
    </span>
  );
}
