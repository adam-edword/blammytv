import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { CloseIcon, GripIcon, PlusIcon } from "../../ui/icons";
import { SortableList, SortableRow } from "../../ui/Sortable";
import { Toggle } from "../../ui/Toggle";
import { EYEBROW } from "../../ui/eyebrow";
import { loadFavorites } from "../live/favorites";
import { loadRecents } from "../live/recents";
import { followsAny, onGamesToday, peekGamesToday, playable } from "../home/liveData";
import { peekCatalogRows } from "../home/catalogRows";
import { homeRows, onHomeRowsChange, removable, saveHomeRows, type HomeRow, type HomeRowKind, type LiveKind } from "../home/layout";
import { useRecordings } from "../recordings/store";
import { loadFollows } from "../sports/follows";
import { hasLivePlaylist } from "./startupSources";

/** A row's own name, for the kinds that have one of their own, and what the
 * grey line under it says it is. A catalog row's name is the catalog's. */
const OWN: Record<Exclude<HomeRowKind, "catalog">, string> = {
  carousel: "Featured Carousel",
  continue: "Continue Watching",
  upnext: "Up Next",
  onnow: "On Now",
  recent: "Recent Channels",
  games: "Today’s Games",
  recordings: "Recordings",
};
const KIND: Record<HomeRowKind, string> = {
  carousel: "Carousel",
  continue: "Watching",
  upnext: "Watching",
  catalog: "Catalog",
  onnow: "Live TV",
  recent: "Live TV",
  recordings: "Live TV",
  games: "Sports",
};

/** The Add Row menu's groups: the kinds that can be added, by where they come from. */
const GROUPS: { label: string; kinds: LiveKind[] }[] = [
  { label: "Live TV", kinds: ["onnow", "recent", "recordings"] },
  { label: "Sports", kinds: ["games"] },
];

/**
 * Home: what is on the page behind the logo (plan 033). The rows in the order
 * they show, each with its name, a switch and a handle to drag it by, the same
 * list as a playlist's rows (xtvod/RowsEditor.tsx, on ui/Sortable).
 *
 * Every change is saved as it is made, and Home is drawn behind Settings, so
 * it moves as you go (layout.ts fires the event Home listens to).
 *
 * The carousel is pinned to the top and only switches. Continue Watching, Up
 * Next and the catalog rows switch but are not removed. The live rows (On Now,
 * Recent Channels, Today's Games, Recordings) are removed with the x and come
 * back from Add Row, which offers the ones not on Home. A row with nothing to
 * draw says why under its name. A catalog row is listed only while a build of
 * its catalog is known, so a source you signed out of does not leave rows here
 * you cannot remove.
 */
export function HomePage() {
  // Read once per visit: the catalogs are the last builds kept (nothing is
  // fetched), and Home appends a row it has not seen as its catalogs load.
  const catalog = useMemo(() => peekCatalogRows(), []);
  const own = useMemo(() => new Map(catalog.map((r) => [r.id, r.title])), [catalog]);
  const live = hasLivePlaylist();
  const [rows, setRows] = useState<HomeRow[]>(() =>
    homeRows(catalog.map((r) => r.id), live),
  );
  useEffect(() => onHomeRowsChange(setRows), []);
  const why = useWhyEmpty(live);

  const nameOf = (r: HomeRow) => r.title ?? ownName(r, own);
  const edit = (id: string, patch: Partial<Pick<HomeRow, "on" | "title">>) =>
    setRows(saveHomeRows(rows.map((r) => (r.id === id ? ({ ...r, ...patch } as HomeRow) : r))));

  const pinned = rows.filter((r) => r.kind === "carousel");
  const hidden = rows.filter((r) => r.kind === "catalog" && !own.has(r.id));
  const listed = rows.filter((r) => r.kind !== "carousel" && !hidden.includes(r));
  const items = listed.map((r) => ({ id: r.id, label: nameOf(r) }));
  const remove = (id: string) => setRows(saveHomeRows(rows.filter((r) => r.id !== id)));
  const add = (kind: LiveKind) => setRows(saveHomeRows([...rows, { id: kind, kind, on: true }]));
  // Only with a live source: every live row plays through the Guide or opens
  // the Sports board, which are not there without one.
  const offered = live
    ? GROUPS.map((g) => ({ ...g, kinds: g.kinds.filter((k) => !rows.some((r) => r.kind === k)) })).filter(
        (g) => g.kinds.length > 0,
      )
    : [];

  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>Home</h3>
      <section className="settings-section homerows" data-setting="home-rows">
        <div className="xtedit__minehead">
          <h4 className="customize-row__title">Home Rows</h4>
          {listed.length > 1 && <p className="xtedit__hint">Drag to change the order.</p>}
          {offered.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" type="button" className="homerows__add">
                  <PlusIcon size={14} />
                  Add Row
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {offered.map((g, i) => (
                  <div key={g.label} role="group" aria-label={g.label}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                    {g.kinds.map((k) => (
                      <DropdownMenuItem key={k} onSelect={() => add(k)}>
                        {OWN[k]}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
                <span className="homerows__nox" aria-hidden />
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
                    {removable(r.kind) && why(r.kind) && <span className="homerows__why">{why(r.kind)}</span>}
                  </span>
                  <Toggle on={r.on} onChange={(on) => edit(r.id, { on })} label={items[i].label} />
                  {removable(r.kind) ? (
                    <button type="button" className="homerows__x" aria-label={`Remove ${items[i].label}`} onClick={() => remove(r.id)}>
                      <CloseIcon size={14} />
                    </button>
                  ) : (
                    <span className="homerows__nox" aria-hidden />
                  )}
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
 * Why a live row has nothing to draw, as one line, or "" when it has
 * something or that is not known yet. Read from the same places Home draws
 * from, so the two agree: favourites, recents, the recordings store, and, for
 * the games, what Home counted (liveData.ts), since only Home fetches them.
 */
function useWhyEmpty(live: boolean): (kind: HomeRowKind) => string {
  const recordings = playable(useRecordings());
  const games = useSyncExternalStore(onGamesToday, peekGamesToday);
  return (kind) => {
    if (!removable(kind)) return "";
    if (!live) return "Add a playlist to fill this row.";
    switch (kind) {
      case "onnow":
        return loadFavorites().length === 0 ? "Star channels in the Guide to fill this row." : "";
      case "recent":
        return loadRecents().length === 0 ? "Channels you watch show here." : "";
      case "recordings":
        return recordings.length === 0 ? "Recordings you make show here." : "";
      case "games":
        if (!followsAny(loadFollows())) return "Follow a league in Sports to fill this row.";
        return games === 0 ? "No games today for your leagues." : "";
    }
  };
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
