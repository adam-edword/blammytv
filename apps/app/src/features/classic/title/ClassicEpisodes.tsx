import { useState, type KeyboardEvent } from "react";
import { dayLabel } from "../../../lib/time";
import { isOut } from "../../stream/mapper";
import type { Episode, Season, VodItem } from "../../stream/model";
import { ClassicList, type ClassicCol } from "./ClassicList";

/** A show's page in Classic (plan 035): a header strip, the seasons as a
 * TreeView on the left, the season's episodes as a Details list on the
 * right. Same data and the same pick as the normal page, handed in by
 * `Episodes`. */
export function ClassicEpisodes({
  item,
  metaState,
  onRetryMeta,
  season,
  seasonIdx,
  onSeason,
  watched,
  nextUp,
  now,
  onPick,
}: {
  item: VodItem;
  metaState: "pending" | "failed" | "ready";
  onRetryMeta?: () => void;
  season: Season | undefined;
  seasonIdx: number;
  onSeason: (i: number) => void;
  watched: Set<string>;
  nextUp: string | null | undefined;
  now: number;
  onPick: (episodeId: string, label: string, info: { season: number; episode: number; title: string }) => void;
}) {
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const eps = season?.episodes ?? [];
  const picked = eps.find((e) => e.id === sel) ?? eps.find((e) => e.id === nextUp) ?? eps[0];
  const play = (e: Episode) =>
    season && onPick(e.id, `S${season.number} · E${e.number}: ${e.title}`, { season: season.number, episode: e.number, title: e.title });
  const cols: ClassicCol<Episode>[] = [
    { key: "no", label: "No.", width: "70px", cell: (e) => e.number, sort: (e) => e.number },
    { key: "title", label: "Title", width: "minmax(0,1fr)", cell: (e) => e.title, sort: (e) => e.title },
    {
      key: "air",
      label: "Air Date",
      width: "160px",
      cell: (e) => (isOut(e, now) ? (e.airDate ?? "") : e.airsAt != null ? `Airs ${dayLabel(new Date(e.airsAt))}` : ""),
      sort: (e) => e.airsAt ?? 0,
    },
    {
      key: "seen",
      label: "Watched",
      width: "100px",
      cell: (e) => (
        <span className={"clt-ck" + (watched.has(e.id) ? " is-on" : "")} role="img" aria-label={watched.has(e.id) ? "Watched" : "Not Watched"} />
      ),
      sort: (e) => (watched.has(e.id) ? 0 : 1),
    },
  ];
  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" && open) onSeason(Math.min(item.seasons.length - 1, seasonIdx + 1));
    else if (e.key === "ArrowUp" && open) onSeason(Math.max(0, seasonIdx - 1));
    else if (e.key === "ArrowLeft") setOpen(false);
    else if (e.key === "ArrowRight") setOpen(true);
    else return;
    e.preventDefault();
  };
  const years = item.year ? `${item.year} · ` : "";
  return (
    <div className="clt clt-show">
      <div className="clt-strip">
        {item.poster ? <img className="clt-art" src={item.poster} alt="" /> : <div className="clt-art" aria-hidden />}
        <div>
          <h2>{item.title}</h2>
          <div className="clt-sub">
            {years}
            {item.seasons.length} {item.seasons.length === 1 ? "season" : "seasons"}
          </div>
          {item.synopsis && <div className="clt-sub clt-one">{item.synopsis}</div>}
        </div>
      </div>
      {item.seasons.length === 0 ? (
        <div className="clt-state clt-fill" role={metaState === "failed" ? "alert" : metaState === "pending" ? "status" : undefined}>
          {metaState === "failed" ? "Couldn’t Load Episodes" : metaState === "pending" ? "Loading Episodes…" : "No Episodes Listed"}
          {metaState === "failed" && (
            <button type="button" className="clt-b" onClick={onRetryMeta}>
              Try Again
            </button>
          )}
        </div>
      ) : (
        <div className="clt-panes">
          <div className="clt-tree">
            <div className="clt-pt">Seasons</div>
            <div
              className="clt-treebox"
              role="tree"
              aria-label="Seasons"
              tabIndex={0}
              aria-activedescendant={open ? `clt-season-${seasonIdx}` : undefined}
              onKeyDown={onTreeKey}
            >
              <ul className="clt-tv" role="none">
                <li role="none">
                  <div role="treeitem" aria-expanded={open} aria-level={1} aria-selected={false} className="clt-n">
                    <button type="button" tabIndex={-1} className="clt-bx" aria-label={open ? "Collapse" : "Expand"} data-open={open} onClick={() => setOpen((o) => !o)} />
                    <i className="clt-fd is-op" aria-hidden />
                    <span className="clt-lb">{item.title}</span>
                  </div>
                  {open && (
                    <ul role="group">
                      {item.seasons.map((s, i) => (
                        <li key={s.id} role="none">
                          <div
                            id={`clt-season-${i}`}
                            role="treeitem"
                            aria-level={2}
                            aria-selected={i === seasonIdx}
                            className="clt-n clt-lf"
                            onClick={() => onSeason(i)}
                          >
                            <i className={"clt-fd" + (i === seasonIdx ? " is-op" : "")} aria-hidden />
                            <span className={"clt-lb" + (i === seasonIdx ? " is-sel" : "")}>{s.name}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              </ul>
            </div>
          </div>
          <ClassicList
            label={`${season?.name ?? "Episodes"} Episodes`}
            // A new season is a new list: its sort and selection start over.
            key={season?.id}
            cols={cols}
            rows={eps}
            rowId={(e) => e.id}
            selected={picked?.id ?? null}
            onSelect={setSel}
            onOpen={play}
            disabled={(e) => !isOut(e, now)}
          />
        </div>
      )}
    </div>
  );
}
