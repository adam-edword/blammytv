import type { CSSProperties, ReactNode } from "react";
import { artLoaded } from "../../lib/artIn";
import { EYEBROW_ON_IMAGE } from "../../ui/eyebrow";

/**
 * A title's loading screen (v0.10.21), for both halves of a VOD start: the
 * stream screen's wait while the addon finds a source, and the player's
 * while mpv opens it. One look for both, so nothing changes halfway through
 * a load.
 *
 * From Adam's reference, another app's: the title's backdrop blurred to a
 * wash and darkened to black at the edges, the logo in the middle, and a bar
 * along the bottom that says what it is doing. The player's own bar is
 * hidden meanwhile (TheaterOverlay), so there is one logo on screen, not two.
 *
 * THE BAR MOVES ON REAL STAGES, NOT ON A CLOCK:
 * - finding: the addon is being asked for a source (StreamScreen);
 * - opening: mpv has the URL and has not opened the file yet;
 * - buffering: mpv has opened it (the status poll has a position and a
 *   duration) and the first frame has not landed.
 * The first frame ends the screen. It never shows a percentage: mpv has no
 * honest one for a first open, since it starts at the first frame it can
 * decode rather than at a fill target, and a number creeping on a timer
 * would be the one thing on this screen that isn't true.
 */
export type LoadStage = "finding" | "opening" | "buffering";

const STAGES: Record<LoadStage, { label: string; at: number }> = {
  finding: { label: "Finding a source", at: 0.25 },
  opening: { label: "Opening the stream", at: 0.55 },
  buffering: { label: "Buffering", at: 0.85 },
};

export function VodLoading({
  art,
  backdrop,
  title,
  stage,
  slow = false,
  children,
}: {
  /** The logo, or a poster standing in for one. */
  art?: string;
  /** The wide art the wash is made from. None: plain black. */
  backdrop?: string;
  /** Shown in type when there is no art. */
  title: string;
  stage: LoadStage;
  /** A find that has stopped looking normal: the label says so. */
  slow?: boolean;
  /** Under the logo: the resolving screen's Cancel. */
  children?: ReactNode;
}) {
  const s = STAGES[stage];
  const label = slow ? "Still looking for a source" : s.label;
  return (
    <div className="vodload" aria-live="polite">
      {backdrop && (
        <div className="vodload__bg" aria-hidden>
          <img
            key={backdrop}
            className="art-in"
            src={backdrop}
            alt=""
            decoding="async"
            onLoad={artLoaded}
          />
        </div>
      )}
      <div className="vodload__art">
        {art ? (
          <img className="tune__vodlogo" src={art} alt="" aria-hidden />
        ) : (
          <span className="tune__vodtitle">{title}</span>
        )}
        {children}
      </div>
      <div
        className="vodload__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s.at * 100)}
      >
        <div className="vodload__track">
          <div className="vodload__fill" style={{ "--at": s.at } as CSSProperties} />
        </div>
        <p className={`vodload__label ${EYEBROW_ON_IMAGE}`}>{label}…</p>
      </div>
    </div>
  );
}
