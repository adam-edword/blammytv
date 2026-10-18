import { useId, useState } from "react";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "../../components/ui/button";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { liftedRow } from "../../lib/liftedRow";
import { CloseIcon, GripIcon, SearchIcon } from "../../ui/icons";
import { SortableList, SortableRow } from "../../ui/Sortable";
import { Toggle } from "../../ui/Toggle";
import { PosterFan } from "./FolderArt";
import { KIND_WORD, type XtKind } from "./keys";
import { KindSegmented } from "./KindSegmented";
import { folderLabel, kindsOffered, pickId, rowsOf } from "./staging";
import { useStaging } from "./useStaging";
import { useXtRefresh } from "./useXtRefresh";
import { xtLibraries } from "./vod";

/**
 * Stream's Rows drawer (plan 028, direction D): the button after the rows, and
 * the drawer it opens from the right. A real dialog: focus moves in and stays
 * in, Escape closes it, and focus goes back to the button.
 *
 * Inside: "Your Rows", the staged picks in the order they will show, each
 * dragged by its handle (or lifted with Space) and taken out with its x, and
 * then every folder with a switch, found by search and by Movies or Shows.
 *
 * Nothing is live. A switch, a drag or an x changes the draft, and the rows
 * behind change when Done writes it. Closing any other way (Escape, the x, a
 * click outside) leaves the draft behind: the body is mounted for each opening.
 */

export function XtRowsDrawer({ edit }: { edit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="xtrows__act">
        <DialogTrigger asChild>
          <Button type="button" variant="secondary">
            {edit ? "Edit Rows" : "Add Rows from Your Playlist"}
          </Button>
        </DialogTrigger>
      </div>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="xtdrawer"
          aria-describedby={undefined}
          // Escape puts a lifted row back (ui/Sortable.tsx) and closes nothing.
          onEscapeKeyDown={(e) => {
            if (liftedRow()) e.preventDefault();
          }}
        >
          <DrawerBody onDone={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

const countLabel = (n: number) => (n === 0 ? "No Rows On" : n === 1 ? "1 Row On" : `${n} Rows On`);

function DrawerBody({ onDone }: { onDone: () => void }) {
  useXtRefresh();
  const libs = xtLibraries();
  const stage = useStaging();
  const mineId = useId();
  const foldersId = useId();
  const [query, setQuery] = useState("");
  const kinds = kindsOffered(libs);
  const [chosen, setChosen] = useState<XtKind>("movie");
  const kind = kinds.includes(chosen) ? chosen : (kinds[0] ?? "movie");
  const several = libs.length > 1;
  const needle = query.trim().toLowerCase();

  const mine = libs.map((lib) => ({ lib, rows: rowsOf(lib, stage.picks(lib.id)) }));
  const count = mine.reduce((n, m) => n + m.rows.length, 0);
  const found = libs.map((lib) => ({
    lib,
    folders: lib.folders.filter((f) => f.kind === kind && (!needle || f.name.toLowerCase().includes(needle))),
  }));
  const anyFound = found.some((f) => f.folders.length > 0);

  return (
    <>
      <div className="xtdrawer__head">
        <DialogTitle className="xtdrawer__title text-2xl font-bold">Rows</DialogTitle>
        <DialogPrimitive.Close asChild>
          <Button type="button" variant="secondary" size="icon-sm" aria-label="Close">
            <CloseIcon size={16} />
          </Button>
        </DialogPrimitive.Close>
      </div>
      <div className="xtdrawer__tools">
        <label className="xtdrawer__search">
          <SearchIcon size={16} className="xtdrawer__searchicon" />
          <Input
            type="search"
            className="pl-9"
            value={query}
            placeholder="Search Folders"
            aria-label="Search Folders"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <KindSegmented kinds={kinds} value={kind} onChange={setChosen} />
      </div>

      <div className="xtdrawer__body">
        <section aria-labelledby={mineId} data-xtdrawer-rows>
          <h3 id={mineId} className="xtdrawer__sec">
            Your Rows
          </h3>
          {count === 0 && <p className="xtdrawer__note">No rows yet. Switch on a folder below.</p>}
          {mine.map(({ lib, rows }) => {
            if (rows.length === 0) return null;
            const items = rows.map((r) => ({ id: pickId(r.pick), label: folderLabel(r.folder, lib, several) }));
            return (
              <div key={lib.id} className="xtdrawer__lib">
                {several && <h4 className="xtdrawer__libname">{lib.name}</h4>}
                <SortableList
                  items={items}
                  strategy={verticalListSortingStrategy}
                  vertical
                  label={several ? `Rows from ${lib.name}` : "Rows"}
                  className="xtdrawer__list"
                  onReorder={(ids) =>
                    stage.reorder(
                      lib.id,
                      ids.map((id) => rows.find((r) => pickId(r.pick) === id)!.pick),
                    )
                  }
                >
                  {rows.map(({ pick, folder }, i) => (
                    <SortableRow key={items[i].id} id={items[i].id} className="xtrow">
                      {(grip) => (
                        <>
                          <button type="button" className="xtrow__grip" {...grip} aria-label={`Reorder ${items[i].label}`}>
                            <GripIcon size={16} />
                          </button>
                          <PosterFan posters={folder.posters} />
                          <span className="xtrow__text">
                            <span className="xtrow__name">{folder.name}</span>
                            <span className="xtrow__kind">{KIND_WORD[folder.kind]}</span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${items[i].label}`}
                            onClick={() => stage.toggle(lib.id, pick.kind, pick.id)}
                          >
                            <CloseIcon size={14} />
                          </Button>
                        </>
                      )}
                    </SortableRow>
                  ))}
                </SortableList>
              </div>
            );
          })}
        </section>

        <section aria-labelledby={foldersId} data-xtdrawer-folders>
          <h3 id={foldersId} className="xtdrawer__sec">
            Folders
          </h3>
          {!anyFound && (
            <p className="xtdrawer__note">{needle ? `No folders match “${query.trim()}”.` : "No folders to show."}</p>
          )}
          {found.map(({ lib, folders }) => {
            if (folders.length === 0) return null;
            const on = new Set(stage.picks(lib.id).map(pickId));
            return (
              <div key={lib.id} className="xtdrawer__lib">
                {several && <h4 className="xtdrawer__libname">{lib.name}</h4>}
                <ul className="xtdrawer__list" aria-label={several ? `${KIND_WORD[kind]} from ${lib.name}` : KIND_WORD[kind]}>
                  {folders.map((f) => (
                    <li key={f.id} className="xtfolder">
                      <PosterFan posters={f.posters} />
                      <span className="xtfolder__name">{f.name}</span>
                      <Toggle on={on.has(pickId(f))} onChange={() => stage.toggle(lib.id, f.kind, f.id)} label={folderLabel(f, lib, several)} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      </div>

      <div className="xtdrawer__foot">
        <span className="xtdrawer__count">{countLabel(count)}</span>
        <Button
          type="button"
          onClick={() => {
            stage.commit();
            onDone();
          }}
        >
          Done
        </Button>
      </div>
    </>
  );
}
