import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PlayIcon } from "../../../ui/icons";
import { Line } from "../../stream/SourceList";
import type { StreamSource } from "../../stream/model";
import { FlCombo } from "./controls";
import { filterPills, viewSources, type SourceSort } from "./sourceView";

/**
 * A title's sources as WinUI's ListView (plan 035, "Fluent to tier 3"): the
 * pills and the Sort box above, one 8px card of rows under them.
 *
 * It draws what SourceList draws, from the same StreamSource: the quality
 * badge, the addon's own lines (a source has no size or language field, so
 * the secondary line is the addon's later lines as it wrote them), a
 * "Cached" pill when the source is. A pick is exactly the old pick: the
 * queue it hands on is the sources after it in the ADDON's order, not the
 * drawn one, so the fallback is the one SourceList gives.
 *
 * ONE TAB STOP, the arrows move the selection with the focus (the ListView's
 * own single selection). Enter, a double click or the play mark plays; a
 * single click only selects.
 */
export function SourceListView({
  sources,
  onPick,
}: {
  sources: StreamSource[];
  onPick: (s: StreamSource, queue: StreamSource[]) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<SourceSort>("best");
  const pills = useMemo(() => filterPills(sources), [sources]);
  // A new list (another episode) can lack the pill that was on.
  const on = pills.some((p) => p.key === filter) ? filter : "all";
  const rows = useMemo(() => viewSources(sources, on, sort), [sources, on, sort]);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [sources, on, sort]);
  const at = Math.min(sel, rows.length - 1);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const pick = (s: StreamSource) => onPick(s, sources.slice(sources.indexOf(s) + 1));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = rows.length - 1;
    const to =
      e.key === "ArrowDown"
        ? Math.min(last, at + 1)
        : e.key === "ArrowUp"
          ? Math.max(0, at - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (e.key === "Enter" && rows[at]) {
      e.preventDefault();
      pick(rows[at]);
    }
    if (to == null) return;
    e.preventDefault();
    setSel(to);
    els.current[to]?.focus();
  };

  return (
    <section className="fls-sources" aria-labelledby="fls-sources-h">
      <div className="fls-sources__head">
        <h2 id="fls-sources-h" className="fls-sources__title">
          Sources
        </h2>
        <div className="fls-pills" role="group" aria-label="Filter Sources">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              className="fls-pill"
              aria-pressed={p.key === on}
              onClick={() => setFilter(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <FlCombo
          className="fls-sources__sort"
          label="Sort"
          value={sort}
          options={[
            { value: "best", label: "Best Match" },
            { value: "quality", label: "Quality" },
          ]}
          onChange={(v) => setSort(v as SourceSort)}
        />
      </div>
      <div className="fls-list" role="listbox" aria-label="Sources" onKeyDown={onKeyDown}>
        {rows.map((s, n) => {
          const [name, ...rest] = s.lines;
          return (
            <div
              key={s.id}
              ref={(el) => {
                els.current[n] = el;
              }}
              role="option"
              aria-selected={n === at}
              tabIndex={n === at ? 0 : -1}
              className="fls-src"
              data-cache={s.cache}
              onClick={() => setSel(n)}
              onFocus={() => setSel(n)}
              onDoubleClick={() => pick(s)}
            >
              <span className={"fls-badge" + (/^(2160|4320)p/i.test(s.quality) ? " fls-badge--hi" : "")}>
                {s.quality}
              </span>
              <span className="fls-src__text">
                <span className="fls-src__name">
                  <Line text={name ?? s.fileName ?? s.quality} />
                </span>
                {rest.length > 0 && (
                  <span className="fls-src__sub">
                    <Line text={rest.join(" · ")} />
                  </span>
                )}
              </span>
              {s.cache === "cached" && <span className="fls-cached">Cached</span>}
              <span
                className="fls-src__play"
                aria-hidden
                onClick={(e) => {
                  e.stopPropagation();
                  pick(s);
                }}
              >
                <PlayIcon size={14} />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
