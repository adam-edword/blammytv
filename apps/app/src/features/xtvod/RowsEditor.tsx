import { useId, useState } from "react";
import { rectSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "../../components/ui/button";
import { CloseIcon } from "../../ui/icons";
import { SortableList, SortableRow } from "../../ui/Sortable";
import { PosterDot } from "./FolderArt";
import { KIND_WORD, type XtKind } from "./keys";
import { KindSegmented } from "./KindSegmented";
import { kindsOffered, pickId, rowsOf } from "./staging";
import { useStaging } from "./useStaging";
import { useXtRefresh } from "./useXtRefresh";
import { xtLibraries } from "./vod";

/**
 * A playlist's rows, in Settings (plan 028, direction C), under the playlist.
 * "Your Rows" are pills, a round poster and the folder's name, dragged into the
 * order they show in Stream (or lifted with Space) and taken out with their x.
 * "More Folders" are the pills of the rest, and a click adds one to the end of
 * Your Rows.
 *
 * Staged, as the playlist's folder editor and its Advanced fields are
 * (settings/PlaylistsTab.tsx): nothing reaches Stream until Save, Discard puts
 * the pills back, and leaving Settings drops what was not saved.
 */

export function XtRowsEditor({ playlistId }: { playlistId: string }) {
  useXtRefresh();
  const lib = xtLibraries().find((l) => l.id === playlistId);
  const stage = useStaging();
  const mineId = useId();
  const moreId = useId();
  const [chosen, setChosen] = useState<XtKind>("movie");
  if (!lib) return null;
  const kinds = kindsOffered([lib]);
  const kind = kinds.includes(chosen) ? chosen : (kinds[0] ?? "movie");
  const picks = stage.picks(lib.id);
  const rows = rowsOf(lib, picks);
  const on = new Set(picks.map(pickId));
  const more = lib.folders.filter((f) => f.kind === kind && !on.has(pickId(f)));
  const items = rows.map((r) => ({ id: pickId(r.pick), label: `${r.folder.name}, ${KIND_WORD[r.folder.kind]}` }));

  return (
    <div className="xtedit" data-xtedit={lib.id}>
      <section aria-labelledby={mineId}>
        <h4 id={mineId} className="xtedit__title">
          Your Rows
        </h4>
        {rows.length === 0 ? (
          <p className="xtedit__note">No rows yet. Pick a folder below.</p>
        ) : (
          <SortableList
            items={items}
            strategy={rectSortingStrategy}
            label="Your Rows"
            className="xtedit__pills"
            onReorder={(ids) =>
              stage.reorder(
                lib.id,
                ids.map((id) => rows.find((r) => pickId(r.pick) === id)!.pick),
              )
            }
          >
            {rows.map(({ pick, folder }, i) => (
              <SortableRow key={items[i].id} id={items[i].id} className="xtpill">
                {(grip) => (
                  <>
                    <button type="button" className="xtpill__body" {...grip} aria-label={`Reorder ${items[i].label}`}>
                      <PosterDot posters={folder.posters} />
                      <span className="xtpill__name">{folder.name}</span>
                      <span className="xtpill__kind">{KIND_WORD[folder.kind]}</span>
                    </button>
                    <button
                      type="button"
                      className="xtpill__x"
                      aria-label={`Remove ${items[i].label}`}
                      onClick={() => stage.toggle(lib.id, pick.kind, pick.id)}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </>
                )}
              </SortableRow>
            ))}
          </SortableList>
        )}
      </section>

      <section aria-labelledby={moreId}>
        <div className="xtedit__morehead">
          <h4 id={moreId} className="xtedit__title">
            More Folders
          </h4>
          <KindSegmented kinds={kinds} value={kind} onChange={setChosen} size="sm" />
        </div>
        {more.length === 0 ? (
          <p className="xtedit__note">{lib.folders.some((f) => f.kind === kind) ? "Every folder here is in Your Rows." : "No folders to show."}</p>
        ) : (
          <ul className="xtedit__pills" aria-label={`More ${KIND_WORD[kind]} Folders`}>
            {more.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="xtpill xtpill--add"
                  aria-label={`Add ${f.name}, ${KIND_WORD[f.kind]}`}
                  onClick={() => stage.toggle(lib.id, f.kind, f.id)}
                >
                  <PosterDot posters={f.posters} />
                  <span className="xtpill__name">{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {stage.dirty && (
        <div className="xtedit__bar">
          <Button variant="secondary" size="sm" type="button" onClick={stage.discard}>
            Discard
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={stage.commit}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
