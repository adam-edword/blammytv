import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { CheckIcon, StreamIcon } from "../../ui/icons";
import { StateCard } from "../../ui/StateCard";
import { PosterFan } from "./FolderArt";
import { KIND_WORD, type XtKind } from "./keys";
import { KindSegmented } from "./KindSegmented";
import { kindsOffered, pickId, rowsOf } from "./staging";
import { useStaging } from "./useStaging";
import { useXtRefresh } from "./useXtRefresh";
import { xtLibraries } from "./vod";

/**
 * Stream with nothing else in it (plan 028, direction B): a provider's library
 * and no row picked yet. The page is the provider's folders as cards, each a
 * fan of its three newest posters, and a click stages the folder (an accent
 * ring and a check) or unstages it.
 *
 * Nothing is live. The button writes the staged folders, in the order they
 * were clicked, and the page turns into the rows (Stream draws the Rows
 * drawer's button after them). With more than one playlist the folders are
 * grouped under each one's name.
 */

/** The button's word: what it does, and how many rows it will show. */
const showLabel = (n: number) => (n === 0 ? "Show Rows" : n === 1 ? "Show 1 Row" : `Show ${n} Rows`);

export function XtCollections() {
  useXtRefresh();
  const libs = xtLibraries();
  const stage = useStaging();
  const headId = useId();
  const kinds = kindsOffered(libs);
  const [chosen, setChosen] = useState<XtKind>("movie");
  const kind = kinds.includes(chosen) ? chosen : (kinds[0] ?? "movie");
  const several = libs.length > 1;
  const count = libs.reduce((n, lib) => n + rowsOf(lib, stage.picks(lib.id)).length, 0);

  return (
    <section className="xtcoll" data-xtcoll aria-labelledby={headId}>
      <header className="xtcoll__head">
        <div className="xtcoll__intro">
          <h2 id={headId} className="xtcoll__title">
            Choose Folders
          </h2>
          <p className="xtcoll__note">Each folder you pick becomes a row on Stream.</p>
        </div>
        <div className="xtcoll__acts">
          <KindSegmented kinds={kinds} value={kind} onChange={setChosen} />
          <Button type="button" disabled={count === 0} onClick={stage.commit}>
            {showLabel(count)}
          </Button>
        </div>
      </header>
      {kinds.length === 0 ? (
        <StateCard
          className="stream__note"
          icon={<StreamIcon size={28} />}
          title="No Folders to Show"
          sub="Find this playlist’s movies and shows in Discover."
        />
      ) : (
        libs.map((lib) => {
          const folders = lib.folders.filter((f) => f.kind === kind);
          if (folders.length === 0) return null;
          const on = new Set(stage.picks(lib.id).map(pickId));
          return (
            <div key={lib.id} className="xtcoll__lib" role="group" aria-label={several ? lib.name : KIND_WORD[kind]}>
              {several && <h3 className="xtcoll__lib-title">{lib.name}</h3>}
              <div className="xtcoll__grid">
                {folders.map((f) => {
                  const picked = on.has(pickId(f));
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className="xtcard"
                      aria-pressed={picked}
                      onClick={() => stage.toggle(lib.id, f.kind, f.id)}
                    >
                      <span className="xtcard__art">
                        <PosterFan posters={f.posters} big />
                        {picked && (
                          <span className="xtcard__check" aria-hidden="true">
                            <CheckIcon size={14} />
                          </span>
                        )}
                      </span>
                      <span className="xtcard__name">{f.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
