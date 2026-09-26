import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { EYEBROW_ON_IMAGE } from "../../ui/eyebrow";
import { PlayIcon } from "../../ui/icons";
import { Kbd } from "../../ui/Kbd";
import { groupSources } from "./mapper";
import type { StreamSource } from "./model";

/**
 * A title's sources, as multi-view's picker lists channels (plan 019, K10
 * and "Sources"). One list for a film's column and the player's panel.
 *
 * GROUPED BY CACHE, for anyone: Cached, then the sources nothing marks
 * either way, then Not cached, each labelled with its count, and no labels
 * at all when nothing is known (a setup without debrid sees one list). The
 * addon's order holds inside each group; see `groupSources`.
 *
 * EVERY LINE, as before: these are what a source is picked BY, and a
 * truncated one hides the audio track or the size that made it the right
 * choice. The first is the text colour at 600, the rest muted, each one
 * line with the whole text on hover.
 *
 * ONE TAB STOP, the arrows move through it (plan 019 rule 10): a roving
 * tabindex over the flat order the rows are drawn in. Enter or Space plays,
 * which is the row being a real button.
 *
 * The queue a pick hands on is the rows after it in the order they are
 * DRAWN, so a failover tries the next cached source before an unknown one.
 */
export function SourceList({
  sources,
  currentUrl,
  onPick,
  footer = true,
  fallbackLabel = "Sources",
}: {
  sources: StreamSource[];
  /** The one playing now (the player's panel): it keeps its ring. */
  currentUrl?: string;
  onPick: (s: StreamSource, queue: StreamSource[]) => void;
  /** The keys and the count along the bottom. */
  footer?: boolean;
  /** The label over the one list nothing is known about. Null where
   * something else already names it (the player panel's head). */
  fallbackLabel?: string | null;
}) {
  const groups = useMemo(() => groupSources(sources), [sources]);
  const flat = useMemo(() => groups.flatMap((g) => g.sources), [groups]);
  const at = Math.max(0, flat.findIndex((s) => s.streamUrl === currentUrl));
  const [active, setActive] = useState(at);
  useEffect(() => setActive(at), [at, flat]);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = flat.length - 1;
    const to =
      e.key === "ArrowDown"
        ? Math.min(last, active + 1)
        : e.key === "ArrowUp"
          ? Math.max(0, active - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to == null) return;
    e.preventDefault();
    setActive(to);
    rows.current[to]?.focus();
  };

  let i = -1;
  return (
    <div className="srclist">
      <div className="srclist__body" onKeyDown={onKeyDown}>
        {groups.map((g) => (
          <div
            key={g.status}
            className="srclist__group"
            role="group"
            aria-label={g.label ? `${g.label}, ${g.sources.length}` : (fallbackLabel ?? "Sources")}
          >
            {/* One label per group; the one list nothing is known about
              * says what it is instead, so the column still has a name. */}
            {(g.label ?? fallbackLabel) && (
              <div className="srclist__sec" aria-hidden>
                <span className={EYEBROW_ON_IMAGE}>
                  {g.label ?? fallbackLabel}
                  {g.label && <b>{g.sources.length}</b>}
                </span>
              </div>
            )}
            {g.sources.map((s) => {
              const n = ++i;
              const current = !!currentUrl && s.streamUrl === currentUrl;
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    rows.current[n] = el;
                  }}
                  type="button"
                  tabIndex={n === active ? 0 : -1}
                  className={"row vod-source" + (current ? " vod-source--current" : "")}
                  data-cache={s.cache}
                  aria-current={current || undefined}
                  title={s.lines.join("\n")}
                  onFocus={() => setActive(n)}
                  onClick={() => onPick(s, flat.slice(n + 1))}
                >
                  <span className="vod-source__quality">{s.quality}</span>
                  <span className="vod-source__lines">
                    {s.lines.map((l, j) => (
                      <span key={j}>{l}</span>
                    ))}
                  </span>
                  <PlayIcon size={16} className="vod-source__play" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {footer && flat.length > 0 && (
        <div className="srclist__foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> play
          </span>
          <span className="srclist__count">
            {flat.length} {flat.length === 1 ? "source" : "sources"}
          </span>
        </div>
      )}
    </div>
  );
}
