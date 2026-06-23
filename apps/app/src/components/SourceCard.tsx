import type { StreamSource } from "@blammytv/shared";
import { PlayIcon } from "./icons";

/** One source row in the selector: a prominent quality label (+ ⚡ when it's
 * instant), the backend's pre-formatted meta lines, and a play affordance.
 * It's a focusable button so it works under a TV remote. Clicking it plays. */
export function SourceCard({
  source,
  onPlay,
}: {
  source: StreamSource;
  onPlay?: () => void;
}) {
  return (
    <button className="source-card" type="button" onClick={onPlay}>
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
