import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export interface ClassicCol<T> {
  key: string;
  label: string;
  /** A grid track: "1fr", "100px". */
  width: string;
  cell: (row: T) => ReactNode;
  /** What a click on the header sorts by. No sort: the header is plain. */
  sort?: (row: T) => string | number;
}

/**
 * Classic's Details list view (plan 035): raised column headers that sort
 * when clicked, a sunken white body, the selected row navy with a dotted
 * focus rectangle. One tab stop; the arrows, Home and End move the
 * selection, Enter or a double click opens it. Rows keep the order they are
 * given until a header is pressed, so a caller's own order (the addon's
 * ranking) is the default.
 */
export function ClassicList<T>({
  label,
  cols,
  rows,
  rowId,
  selected,
  onSelect,
  onOpen,
  disabled,
}: {
  label: string;
  cols: ClassicCol<T>[];
  rows: T[];
  rowId: (row: T) => string;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (row: T) => void;
  /** A row that does nothing when opened (an episode not out yet). */
  disabled?: (row: T) => boolean;
}) {
  const uid = useId();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const shown = useMemo(() => {
    const by = sort && cols.find((c) => c.key === sort.key)?.sort;
    if (!sort || !by) return rows;
    return rows
      .map((r, i) => [r, i] as const)
      .sort(([a, i], [b, j]) => {
        const x = by(a);
        const y = by(b);
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return c * sort.dir || i - j;
      })
      .map(([r]) => r);
  }, [rows, cols, sort]);
  const at = Math.max(0, shown.findIndex((r) => rowId(r) === selected));
  const domId = (id: string) => `${uid}-${id}`;
  const move = (to: number) => {
    const r = shown[Math.max(0, Math.min(shown.length - 1, to))];
    if (!r) return;
    onSelect(rowId(r));
    document.getElementById(domId(rowId(r)))?.scrollIntoView?.({ block: "nearest" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(shown.length - 1);
    else if (e.key === "Enter" && shown[at] && !disabled?.(shown[at])) onOpen(shown[at]);
    else return;
    e.preventDefault();
  };
  const cur = shown[at];
  return (
    <div
      className="clt-list"
      role="grid"
      aria-label={label}
      aria-rowcount={shown.length + 1}
      tabIndex={0}
      aria-activedescendant={cur ? domId(rowId(cur)) : undefined}
      onKeyDown={onKeyDown}
      style={{ "--clt-cols": cols.map((c) => c.width).join(" ") } as CSSProperties}
    >
      <div className="clt-lh" role="row">
        {cols.map((c) => (
          <div
            key={c.key}
            role="columnheader"
            aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
          >
            {c.sort ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 1 ? -1 : 1 }))}
              >
                {c.label}
                {sort?.key === c.key && <i aria-hidden className={sort.dir === 1 ? "up" : "down"} />}
              </button>
            ) : (
              <span>{c.label}</span>
            )}
          </div>
        ))}
      </div>
      <div className="clt-lbody">
        {shown.map((r) => {
          const id = rowId(r);
          const off = !!disabled?.(r);
          return (
            <div
              key={id}
              id={domId(id)}
              role="row"
              aria-selected={id === selected}
              aria-disabled={off || undefined}
              className={"clt-lr" + (id === selected ? " is-sel" : "") + (off ? " is-off" : "")}
              onClick={() => onSelect(id)}
              onDoubleClick={() => !off && onOpen(r)}
            >
              {cols.map((c) => (
                <div key={c.key} role="gridcell">
                  {c.cell(r)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
