import { useEffect, useMemo, useState } from "react";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripIcon } from "../../ui/icons";
import { SortableList, SortableRow } from "../../ui/Sortable";
import { Toggle } from "../../ui/Toggle";
import { EYEBROW } from "../../ui/eyebrow";
import { peekCatalogRows } from "../home/catalogRows";
import { homeRows, onHomeRowsChange, saveHomeRows, type HomeRow, type HomeRowKind } from "../home/layout";

/** A row's own name, for the kinds that have one of their own, and what the
 * grey line under it says it is. A catalog row's name is the catalog's. */
const OWN: Record<Exclude<HomeRowKind, "catalog">, string> = {
  carousel: "Featured Carousel",
  continue: "Continue Watching",
  upnext: "Up Next",
};
const KIND: Record<HomeRowKind, string> = {
  carousel: "Carousel",
  continue: "Watching",
  upnext: "Watching",
  catalog: "Catalog",
};

/**
 * Home: what is on the page behind the logo (plan 033). The rows in the order
 * they show, each with its name, a switch and a handle to drag it by, the same
 * list as a playlist's rows (xtvod/RowsEditor.tsx, on ui/Sortable).
 *
 * Every change is saved as it is made, and Home is drawn behind Settings, so
 * it moves as you go (layout.ts fires the event Home listens to).
 *
 * The carousel is pinned to the top and only switches. Continue Watching, Up
 * Next and the catalog rows switch but are not removed, and phase 1 has no
 * other kind, so there is no remove button and no Add Row yet: both would be
 * empty. A catalog row is listed only while a build of its catalog is known,
 * so a source you signed out of does not leave rows here you cannot remove.
 */
export function HomePage() {
  // Read once per visit: the catalogs are the last builds kept (nothing is
  // fetched), and Home appends a row it has not seen as its catalogs load.
  const catalog = useMemo(() => peekCatalogRows(), []);
  const own = useMemo(() => new Map(catalog.map((r) => [r.id, r.title])), [catalog]);
  const [rows, setRows] = useState<HomeRow[]>(() =>
    homeRows(catalog.map((r) => r.id)),
  );
  useEffect(() => onHomeRowsChange(setRows), []);

  const nameOf = (r: HomeRow) => r.title ?? ownName(r, own);
  const edit = (id: string, patch: Partial<Pick<HomeRow, "on" | "title">>) =>
    setRows(saveHomeRows(rows.map((r) => (r.id === id ? ({ ...r, ...patch } as HomeRow) : r))));

  const pinned = rows.filter((r) => r.kind === "carousel");
  const hidden = rows.filter((r) => r.kind === "catalog" && !own.has(r.id));
  const listed = rows.filter((r) => r.kind !== "carousel" && !hidden.includes(r));
  const items = listed.map((r) => ({ id: r.id, label: nameOf(r) }));

  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>Home</h3>
      <section className="settings-section homerows" data-setting="home-rows">
        <div className="xtedit__minehead">
          <h4 className="customize-row__title">Home Rows</h4>
          {listed.length > 1 && <p className="xtedit__hint">Drag to change the order.</p>}
        </div>
        {pinned.length > 0 && (
          <ul className="xtdrawer__list homerows__pinned" aria-label="Pinned Row">
            {pinned.map((r) => (
              <li key={r.id} className="xtrow" data-row={r.id}>
                {/* The carousel stays on top: no handle, and the space it
                  * would take is kept so the names line up. */}
                <span className="homerows__nogrip" aria-hidden />
                <span className="xtrow__text">
                  <span className="xtrow__name">{OWN.carousel}</span>
                  <span className="xtrow__kind">{KIND.carousel}</span>
                </span>
                <Toggle on={r.on} onChange={(on) => edit(r.id, { on })} label={OWN.carousel} />
              </li>
            ))}
          </ul>
        )}
        <SortableList
          items={items}
          strategy={verticalListSortingStrategy}
          vertical
          label="Rows"
          className="xtdrawer__list"
          onReorder={(ids) => {
            const byId = new Map(rows.map((r) => [r.id, r]));
            setRows(saveHomeRows([...pinned, ...ids.map((id) => byId.get(id)!), ...hidden]));
          }}
        >
          {listed.map((r, i) => (
            <SortableRow key={r.id} id={r.id} className="xtrow">
              {(grip) => (
                <>
                  <button type="button" className="xtrow__grip" {...grip} aria-label={`Reorder ${items[i].label}`}>
                    <GripIcon size={16} />
                  </button>
                  <span className="xtrow__text">
                    <RowTitle name={ownName(r, own)} title={r.title} onChange={(title) => edit(r.id, { title })} />
                    <span className="xtrow__kind">{KIND[r.kind]}</span>
                  </span>
                  <Toggle on={r.on} onChange={(on) => edit(r.id, { on })} label={items[i].label} />
                </>
              )}
            </SortableRow>
          ))}
        </SortableList>
      </section>
    </>
  );
}

function ownName(r: HomeRow, own: ReadonlyMap<string, string>): string {
  return r.kind === "catalog" ? (own.get(r.id) ?? r.id) : OWN[r.kind];
}

/**
 * A row's name as a field. What is typed is saved as it is typed, so Home
 * follows; emptying it is allowed while typing and puts the row's own name
 * back when you leave the field (the title is then unset, not blank).
 */
function RowTitle({
  name,
  title,
  onChange,
}: {
  name: string;
  title: string | undefined;
  onChange: (title: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="homerows__title"
      type="text"
      value={draft ?? title ?? name}
      aria-label={`Name of ${name}`}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        setDraft(e.target.value);
        const typed = e.target.value.trim();
        if (typed) onChange(typed === name ? undefined : typed);
      }}
      onBlur={() => {
        if (draft !== null && !draft.trim()) onChange(undefined);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
