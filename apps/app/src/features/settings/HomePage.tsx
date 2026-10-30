import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { CloseIcon, GripIcon, PlusIcon } from "../../ui/icons";
import { SortableList, SortableRow } from "../../ui/Sortable";
import { Toggle } from "../../ui/Toggle";
import { EYEBROW } from "../../ui/eyebrow";
import { loadFavorites } from "../live/favorites";
import { loadRecents } from "../live/recents";
import { followedSports, followsAny, gamesTitle, onGamesToday, peekGamesToday, playable } from "../home/liveData";
import { peekCatalogRows } from "../home/catalogRows";
import {
  gamesId,
  homeRows,
  onHomeRowsChange,
  removable,
  reorderWithin,
  saveHomeRows,
  savedId,
  traktId,
  TRAKT_LISTS,
  withNewCatalogRows,
  type HomeRow,
  type HomeRowKind,
  type LiveKind,
} from "../home/layout";
import { RowGlyph } from "../home/RowGlyph";
import { importStrand } from "../home/strand";
import { TRAKT_NAMES } from "../home/traktRows";
import { useRecordings } from "../recordings/store";
import { AIO_CONN_CHANGED } from "./aiostreams";
import { JF_CHANGED } from "../jellyfin/store";
import { XT_CHANGED } from "../xtvod/store";
import { XT_LOADED } from "../xtvod/vod";
import { loadFollows } from "../sports/follows";
import { loadLists, type UserList } from "../stream/lists";
import { traktStatus } from "../trakt/client";
import { ImportLayoutDialog } from "./ImportLayoutDialog";
import { hasLivePlaylist } from "./startupSources";

/** A row's own name, for the kinds that have one of their own, and what the
 * grey line under it says it is. A catalog row's name is the catalog's. */
const OWN: Record<"carousel" | "continue" | "upnext" | LiveKind, string> = {
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
  saved: "Watching",
  trakt: "Films & Shows",
  needs: "Needs a Source",
};

/** Where focus goes when there is no row to give it to: the Add Row button. */
const ADD = "#add";

/** A row Add Row can add, and what the menu calls it. */
interface Offer {
  label: string;
  row: HomeRow;
}

/**
 * Home: what is on the page behind the logo (plan 033). The rows in the order
 * they show, each with its name, a switch and a handle to drag it by, the same
 * list as a playlist's rows (xtvod/RowsEditor.tsx, on ui/Sortable).
 *
 * Every change is saved as it is made, and Home is drawn behind Settings, so
 * it moves as you go (layout.ts fires the event Home listens to).
 *
 * The carousel is pinned to the top and only switches. Continue Watching, Up
 * Next and the catalog rows switch but are not removed. The rest are removed
 * with the x and come back from Add Row, which offers the ones not on Home:
 * the live rows (On Now, Recent Channels, Today's Games, Recordings, which
 * need a playlist), Saved (one for each Library list, picked from a submenu
 * of the lists not on Home yet) and Trakt's four lists. A Needs a Source row
 * is only ever made by Import Layout, so Add Row never offers one. A row with
 * nothing to draw says why under its name. A catalog row is listed only while
 * a build of its catalog is known, so a source you signed out of does not
 * leave rows here you cannot remove.
 */
export function HomePage() {
  // The catalogs are the last builds kept (nothing is fetched). Read again when
  // a source changes or its catalog lands, so a new source's rows are here as
  // they are on Home (Home appends them as its catalogs load).
  const [catalog, setCatalog] = useState(peekCatalogRows);
  useEffect(() => {
    const again = () => setCatalog(peekCatalogRows());
    const events = [AIO_CONN_CHANGED, JF_CHANGED, XT_CHANGED, XT_LOADED];
    for (const e of events) window.addEventListener(e, again);
    const off = onHomeRowsChange(again);
    return () => {
      for (const e of events) window.removeEventListener(e, again);
      off();
    };
  }, []);
  const own = useMemo(() => new Map(catalog.map((r) => [r.id, r.title])), [catalog]);
  // The Library's lists, and what is followed, read once per visit: nothing
  // saves to either while Settings is up.
  const lists = useMemo(() => loadLists(), []);
  const sports = useMemo(() => followedSports(loadFollows()), []);
  const live = hasLivePlaylist();
  const [stored, setRows] = useState<HomeRow[]>(() =>
    homeRows(catalog.map((r) => r.id), live),
  );
  useEffect(() => onHomeRowsChange(setRows), []);
  // The rows Home would draw: a catalog row it has not met yet comes last,
  // switched on, as Home appends it.
  const rows = useMemo(() => withNewCatalogRows(stored, catalog.map((r) => r.id)) as HomeRow[], [stored, catalog]);
  const signedIn = useTraktSignedIn();
  const why = useWhyEmpty(live, lists, signedIn);

  // After a row is removed or added the page moves focus to a row (or Add Row),
  // so it is not left on the <body>, and says what happened.
  const root = useRef<HTMLElement>(null);
  const focusNext = useRef<string | null>(null);
  const addedFromMenu = useRef(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    const grip = root.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`);
    (grip ?? root.current?.querySelector<HTMLElement>(".homerows__add"))?.focus();
  }, [rows]);

  const nameOf = (r: HomeRow) => r.title ?? ownName(r, own, lists);
  const edit = (id: string, patch: Partial<Pick<HomeRow, "on" | "title">>) =>
    setRows(
      saveHomeRows(
        rows.map((r) => {
          if (r.id !== id) return r;
          // A Needs a Source row is its title: emptying the field keeps the old one.
          if (r.kind === "needs") return { ...r, ...patch, title: patch.title || r.title };
          return { ...r, ...patch } as HomeRow;
        }),
      ),
    );

  const pinned = rows.filter((r) => r.kind === "carousel");
  const hidden = rows.filter((r) => r.kind === "catalog" && !own.has(r.id));
  const listed = rows.filter((r) => r.kind !== "carousel" && !hidden.includes(r));
  const items = listed.map((r) => ({ id: r.id, label: nameOf(r) }));
  const remove = (id: string) => {
    const at = listed.findIndex((r) => r.id === id);
    const near = listed[at + 1] ?? listed[at - 1];
    // The next row's handle, else the one before, else Add Row (the row removed is offered there).
    focusNext.current = near?.id ?? ADD;
    setSaid(`${items[at].label} removed.`);
    setRows(saveHomeRows(rows.filter((r) => r.id !== id)));
  };
  const add = (row: HomeRow) => {
    focusNext.current = row.id;
    addedFromMenu.current = true;
    setSaid(`${row.kind === "games" ? gamesTitle(row.sport) : ownName(row, own, lists)} added.`);
    setRows(saveHomeRows([...rows, row]));
  };

  // What Add Row offers: what is not on Home yet. The live rows only with a
  // live source (they play through the Guide or open the Sports board, which
  // are not there without one), except Recordings, which are files on this PC;
  // Saved and Trakt need none.
  const have = new Set(rows.map((r) => r.id));
  const liveOffers = (kinds: LiveKind[]): Offer[] =>
    kinds.filter((k) => !have.has(k)).map((k) => ({ label: OWN[k], row: { id: k, kind: k, on: true } }));
  // Today's Games, then a row for each sport followed (a sport's own row is its
  // own: it can be on Home beside Today's Games).
  const sportOffers: Offer[] = sports
    .filter((s) => !have.has(gamesId(s)))
    .map((s) => ({ label: gamesTitle(s), row: { id: gamesId(s), kind: "games", sport: s, on: true } }));
  const savedOffers: Offer[] = lists
    .filter((l) => !have.has(savedId(l.id)))
    .map((l) => ({ label: l.name, row: { id: savedId(l.id), kind: "saved", list: l.id, on: true } }));
  const traktOffers: Offer[] = TRAKT_LISTS.filter((l) => !have.has(traktId(l))).map((l) => ({
    label: TRAKT_NAMES[l],
    row: { id: traktId(l), kind: "trakt", list: l, on: true },
  }));
  const offered = [
    { label: "Watching", saved: savedOffers, offers: [] as Offer[] },
    {
      label: "Live TV",
      saved: [] as Offer[],
      offers: [...(live ? liveOffers(["onnow", "recent"]) : []), ...liveOffers(["recordings"])],
    },
    { label: "Sports", saved: [] as Offer[], offers: live ? [...liveOffers(["games"]), ...sportOffers] : [] },
    { label: "Films & Shows", saved: [] as Offer[], offers: traktOffers },
  ].filter((g) => g.saved.length > 0 || g.offers.length > 0);

  return (
    <>
      <h3 className={`settings__group ${EYEBROW}`}>Home</h3>
      <section ref={root} className="settings-section homerows" data-setting="home-rows">
        <p className="sr-only" role="status" aria-live="polite">
          {said}
        </p>
        <div className="xtedit__minehead">
          <h4 className="customize-row__title">Home Rows</h4>
          {listed.length > 1 && <p className="xtedit__hint">Drag to change the order.</p>}
          <ImportLayoutDialog
            onImport={(text) => {
              const out = importStrand(text, rows, loadLists());
              if (out) setRows(saveHomeRows(out.rows));
              return out && { added: out.added, already: out.already };
            }}
          />
          {offered.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" type="button" className="homerows__add">
                  <PlusIcon size={14} />
                  Add Row
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                // A row just added takes focus (the menu would give it back to its button).
                onCloseAutoFocus={(e) => {
                  if (addedFromMenu.current) e.preventDefault();
                  addedFromMenu.current = false;
                }}
              >
                {offered.map((g, i) => (
                  <div key={g.label} role="group" aria-label={g.label}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                    {g.saved.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Saved</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {g.saved.map((o) => (
                            <DropdownMenuItem key={o.row.id} onSelect={() => add(o.row)}>
                              {o.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    {g.offers.map((o) => (
                      <DropdownMenuItem key={o.row.id} onSelect={() => add(o.row)}>
                        {o.label}
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
                <RowGlyph kind={r.kind} />
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
          // Only the rows shown move, each into a slot one of them held: the
          // carousel and any catalog row hidden here keep theirs.
          onReorder={(ids) => setRows(saveHomeRows(reorderWithin(rows, ids)))}
        >
          {listed.map((r, i) => (
            <SortableRow key={r.id} id={r.id} className="xtrow">
              {(grip) => (
                <>
                  <button type="button" className="xtrow__grip" {...grip} data-grip={r.id} aria-label={`Reorder ${items[i].label}`}>
                    <GripIcon size={16} />
                  </button>
                  <RowGlyph kind={r.kind} />
                  <span className="xtrow__text">
                    <RowTitle
                      name={ownName(r, own, lists)}
                      title={r.kind === "needs" ? undefined : r.title}
                      onChange={(title) => edit(r.id, { title })}
                    />
                    <span className="xtrow__kind">{KIND[r.kind]}</span>
                    {why(r) && <span className="homerows__why">{why(r)}</span>}
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

function ownName(r: HomeRow, own: ReadonlyMap<string, string>, lists: readonly UserList[]): string {
  switch (r.kind) {
    case "catalog":
      return own.get(r.id) ?? r.id;
    case "saved":
      return lists.find((l) => l.id === r.list)?.name ?? "Saved";
    case "trakt":
      return TRAKT_NAMES[r.list];
    case "needs":
      return r.title;
    case "games":
      return gamesTitle(r.sport);
    default:
      return OWN[r.kind];
  }
}

/** Whether Trakt is signed in: null until it has answered. Asked once per visit. */
function useTraktSignedIn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void traktStatus().then((s) => live && setOn(s.configured && s.connected));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/**
 * Why a row has nothing to draw, as one line, or "" when it has something or
 * that is not known yet. Read from the same places Home draws from, so the two
 * agree: favourites, recents, the recordings store, the Library's lists, the
 * Trakt sign-in, and, for the games, what Home counted (liveData.ts), since
 * only Home fetches them.
 */
function useWhyEmpty(live: boolean, lists: readonly UserList[], signedIn: boolean | null): (row: HomeRow) => string {
  const recordings = playable(useRecordings());
  const games = useSyncExternalStore(onGamesToday, peekGamesToday);
  return (row) => {
    switch (row.kind) {
      case "saved": {
        const list = lists.find((l) => l.id === row.list);
        if (!list) return "This list is gone.";
        return list.entries.length === 0 ? "Save titles to this list to fill this row." : "";
      }
      case "trakt":
        return signedIn === false ? "Sign in to Trakt to fill this row." : "";
      case "needs":
        return "Imported from Strand. Nothing fills this row yet.";
      case "carousel":
      case "continue":
      case "upnext":
      case "catalog":
        return "";
    }
    // Recordings are files on this PC: they need no playlist.
    if (!live && row.kind !== "recordings") return "Add a playlist to fill this row.";
    switch (row.kind) {
      case "onnow":
        return loadFavorites().length === 0 ? "Star channels in the Guide to fill this row." : "";
      case "recent":
        return loadRecents().length === 0 ? "Channels you watch show here." : "";
      case "recordings":
        return recordings.length === 0 ? "Recordings you make show here." : "";
      case "games": {
        const follows = loadFollows();
        if (!followsAny(follows) || (row.sport && !followedSports(follows).includes(row.sport)))
          return "Follow a league in Sports to fill this row.";
        if (games === null) return "";
        return row.sport
          ? (games.bySport[row.sport] ?? 0) === 0
            ? "No games today."
            : ""
          : games.all === 0
            ? "No games today for your leagues."
            : "";
      }
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
