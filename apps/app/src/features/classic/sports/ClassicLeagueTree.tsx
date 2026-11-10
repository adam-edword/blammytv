import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { SPORTS } from "../../sports/leagues";
import type { Follows } from "../../sports/follows";

/**
 * The Sports board's leagues as an Explorer tree (plan 035): Sports at the
 * root, a folder per sport, the leagues under it, +/- boxes and dotted lines.
 *
 * It makes the same selection the Default picker does. A league is picked or
 * not through `onPick`, several at a time, and the board narrows to them.
 * Explorer's rule for the folders: a click on a LABEL selects it (a sport is
 * all of its leagues, picked through the same `onPick`; Sports clears the
 * filter) and only the +/- box or a double-click on the label opens and
 * closes it. Sports holding a league you follow or have picked start open.
 *
 * Arrow keys walk the visible rows, Right opens a folder (or steps into it),
 * Left closes it (or steps out), Enter and Space select. One row is in the
 * tab order at a time.
 */
export function ClassicLeagueTree({
  follows,
  picked,
  onPick,
  onClearPicks,
}: {
  follows: Follows;
  picked: string[];
  onPick: (path: string) => void;
  onClearPicks: () => void;
}) {
  const sports = useMemo(
    () => [...SPORTS].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const [rootOpen, setRootOpen] = useState(true);
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        sports
          .filter((s) =>
            s.leagues.some(
              (l) => follows.leagues.includes(l.path) || picked.includes(l.path),
            ),
          )
          .map((s) => s.key),
      ),
  );
  // The one row in the tab order, by id. Starts on the root.
  const [here, setHere] = useState("root");
  const tree = useRef<HTMLUListElement>(null);

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const rows = () =>
    [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
  const go = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    setHere(el.dataset.id ?? "root");
    el.focus();
  };

  /** A sport is selected when every one of its leagues is picked. */
  const sportOn = (leagues: { path: string }[]) =>
    leagues.length > 0 && leagues.every((l) => picked.includes(l.path));
  /** Select a row: Sports clears the filter, a sport narrows to exactly its
   * leagues (clear, then pick each: the same `onPick` a league uses), a league
   * toggles as it always did. */
  const select = (id: string) => {
    if (id === "root") onClearPicks();
    else if (id.startsWith("s:")) {
      onClearPicks();
      sports.find((s) => s.key === id.slice(2))?.leagues.forEach((l) => onPick(l.path));
    } else onPick(id.slice(2));
  };
  /** Open or close a folder row. */
  const flip = (id: string) => {
    if (id === "root") setRootOpen((o) => !o);
    else toggle(id.slice(2));
  };

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!el) return;
    const all = rows();
    const i = all.indexOf(el);
    const expanded = el.getAttribute("aria-expanded");
    switch (e.key) {
      case "ArrowDown":
        go(all[i + 1]);
        break;
      case "ArrowUp":
        go(all[i - 1]);
        break;
      case "Home":
        go(all[0]);
        break;
      case "End":
        go(all[all.length - 1]);
        break;
      case "ArrowRight":
        if (expanded === "false") flip(el.dataset.id ?? "");
        else if (expanded === "true") go(all[i + 1]);
        break;
      case "ArrowLeft":
        if (expanded === "true") flip(el.dataset.id ?? "");
        else go(el.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
        break;
      case "Enter":
      case " ":
        select(el.dataset.id ?? "");
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const tab = (id: string) => (here === id ? 0 : -1);
  /** A row's click: take the tab stop, then do what Enter would. */
  const click = (e: { currentTarget: HTMLElement }, run: () => void) => {
    go(e.currentTarget.parentElement);
    run();
  };
  /** The +/- box: opens or closes without touching the selection. */
  const box = (id: string, on: boolean) => (
    <b
      className={"cl-tv__bx" + (on ? "" : " is-closed")}
      aria-hidden
      onClick={(e) => {
        e.stopPropagation();
        go(e.currentTarget.closest<HTMLElement>('[role="treeitem"]'));
        flip(id);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );

  return (
    <div className="cl-sports__tree">
      <div className="cl-sports__pt">Leagues</div>
      <div className="cl-sports__treebox">
        <ul
          className="cl-tv"
          role="tree"
          aria-label="Leagues"
          aria-multiselectable="true"
          ref={tree}
          onKeyDown={onKey}
        >
          <li
            role="treeitem"
            aria-expanded={rootOpen}
            aria-selected={picked.length === 0}
            data-id="root"
            tabIndex={tab("root")}
          >
            <div
              className="cl-tv__n"
              onClick={(e) => click(e, () => select("root"))}
              onDoubleClick={() => flip("root")}
            >
              {box("root", rootOpen)}
              <i className={"cl-tv__fd" + (rootOpen ? " is-open" : "")} aria-hidden />
              <span className={"cl-tv__lb" + (picked.length === 0 ? " is-sel" : "")}>Sports</span>
            </div>
            {rootOpen && (
              <ul role="group">
                {sports.map((s) => {
                  const on = open.has(s.key);
                  const id = `s:${s.key}`;
                  const chosen = sportOn(s.leagues);
                  return (
                    <li
                      key={s.key}
                      role="treeitem"
                      aria-expanded={on}
                      aria-selected={chosen}
                      data-id={id}
                      tabIndex={tab(id)}
                    >
                      <div
                        className="cl-tv__n"
                        onClick={(e) => click(e, () => select(id))}
                        onDoubleClick={() => flip(id)}
                      >
                        {box(id, on)}
                        <i className={"cl-tv__fd" + (on ? " is-open" : "")} aria-hidden />
                        <span className={"cl-tv__lb" + (chosen ? " is-sel" : "")} title={s.name}>
                          {s.name}
                        </span>
                      </div>
                      {on && (
                        <ul role="group">
                          {s.leagues.map((l) => {
                            const lid = `l:${l.path}`;
                            const sel = picked.includes(l.path);
                            return (
                              <li
                                key={l.path}
                                role="treeitem"
                                aria-selected={sel}
                                data-id={lid}
                                tabIndex={tab(lid)}
                              >
                                <div
                                  className="cl-tv__n cl-tv__n--leaf"
                                  data-hint={l.name}
                                  onClick={(e) => click(e, () => select(lid))}
                                >
                                  <i className="cl-tv__fd" aria-hidden />
                                  <span className={"cl-tv__lb" + (sel ? " is-sel" : "")}>{l.label}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        </ul>
      </div>
      {picked.length > 0 && (
        <button type="button" className="cl-sports__clear" onClick={onClearPicks}>
          Clear Filter ({picked.length})
        </button>
      )}
    </div>
  );
}
