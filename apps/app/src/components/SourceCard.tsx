import { useEffect } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { StreamSource } from "@blammytv/shared";
import { PlayIcon } from "./icons";
import { smoothCenterIntoView } from "../lib/scroll";

/** One source row in the selector: a prominent quality label (+ ⚡ when it's
 * instant), the backend's pre-formatted meta lines, and a play affordance.
 * It's a focusable button so it works under a TV remote. Clicking it plays.
 *
 * Pass `focusKey` to join spatial navigation (the source-selection screen); omit
 * it (e.g. the in-player panel) to render as a plain click/tap button. */
export function SourceCard({
  source,
  onPlay,
  focusKey,
}: {
  source: StreamSource;
  onPlay?: () => void;
  focusKey?: string;
}) {
  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey,
    focusable: focusKey != null,
    onEnterPress: () => onPlay?.(),
    onFocus: (layout: FocusableComponentLayout) => {
      if (layout.node) smoothCenterIntoView(layout.node, 200);
    },
  });
  // Mirror norigin's focus onto native DOM focus too (keeps a11y honest).
  useEffect(() => {
    if (focused) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  return (
    <button
      ref={ref}
      className={"source-card" + (focused ? " is-focused" : "")}
      type="button"
      onClick={onPlay}
    >
      <span className="source-card__quality">
        <span className="source-card__res">{source.quality}</span>
        {source.cached && (
          <span className="source-card__bolt" aria-label="Instant">
            ⚡
          </span>
        )}
      </span>

      <span className="source-card__meta">
        {source.lines.map((line, i) => (
          <span key={i} className="source-card__line">
            {line}
          </span>
        ))}
      </span>

      <PlayIcon size={20} className="source-card__play" />
    </button>
  );
}
