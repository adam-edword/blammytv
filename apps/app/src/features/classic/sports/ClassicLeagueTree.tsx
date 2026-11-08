import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { SPORTS } from "../../sports/leagues";
import type { Follows } from "../../sports/follows";

/**
 * The Sports board's leagues as an Explorer tree (plan 035): Sports at the
 * root, a folder per sport, the leagues under it, +/- boxes and dotted lines.
 *
 * It makes the same selection the Default picker does. A league is picked or
 * not through `onPick`, several at a time, and the board narrows to them; a
 * sport is only a folder that opens and closes. Sports holding a league you
 * follow or have picked start open.
 *
 * Arrow keys walk the visible rows, Right opens a folder (or steps into it),
 * Left closes it (or steps out), Enter and Space pick a league or toggle a
 * folder. One row is in the tab order at a time.
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

  const act = (el: HTMLElement) => {
    const id = el.dataset.id ?? "";
    if (id === "root") setRootOpen((o) => !o);
    else if (id.startsWith("s:")) toggle(id.slice(2));
    else onPick(id.slice(2));
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
        if (expanded === "false") act(el);
        else if (expanded === "true") go(all[i + 1]);
        break;
      case "ArrowLeft":
        if (expanded === "true") act(el);
        else go(el.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
        break;
      case "Enter":
      case " ":
        act(el);
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
          <li role="treeitem" aria-expanded={rootOpen} data-id="root" tabIndex={tab("root")}>
            <div className="cl-tv__n" onClick={(e) => click(e, () => setRootOpen((o) => !o))}>
              <b className={"cl-tv__bx" + (rootOpen ? "" : " is-closed")} aria-hidden />
              <i className={"cl-tv__fd" + (rootOpen ? " is-open" : "")} aria-hidden />
              <span className="cl-tv__lb">Sports</span>
            </div>
            {rootOpen && (
              <ul role="group">
                {sports.map((s) => {
                  const on = open.has(s.key);
                  const id = `s:${s.key}`;
                  return (
                    <li key={s.key} role="treeitem" aria-expanded={on} data-id={id} tabIndex={tab(id)}>
                      <div className="cl-tv__n" onClick={(e) => click(e, () => toggle(s.key))}>
                        <b className={"cl-tv__bx" + (on ? "" : " is-closed")} aria-hidden />
                        <i className={"cl-tv__fd" + (on ? " is-open" : "")} aria-hidden />
                        <span className="cl-tv__lb">{s.name}</span>
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
                                  onClick={(e) => click(e, () => onPick(l.path))}
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
