import { useState } from "react";
import { SaveButton } from "../../stream/SaveButton";
import type { StreamSource, VodItem } from "../../stream/model";
import { ClassicList, type ClassicCol } from "./ClassicList";

/** "1 h 44 min", as the mock sets it. */
const runtime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

/** 1080p, 2160p, 4K: a number to sort by. */
const qualityRank = (q: string) => (/4k/i.test(q) ? 2160 : Number(/(\d{3,4})p/i.exec(q)?.[1] ?? 0));

const cachedLabel = (s: StreamSource) => (s.cache === "cached" ? "Yes" : s.cache === "uncached" ? "No" : "Unknown");
// The half stars no Windows font has, as the source list's hover says them.
const nameOf = (s: StreamSource) => (s.lines.join(" · ") || s.fileName || s.quality).replace(/[⯨-⯫]/g, "½");

/** A title's page in Classic (plan 035): a Properties sheet on the left, the
 * title's sources as a Details list on the right. Same data and the same
 * pick as the normal page, handed in by `Detail`. */
export function ClassicTitle({
  item,
  episodeLabel,
  watched,
  sources,
  notices,
  onRetry,
  onPick,
}: {
  item: VodItem;
  episodeLabel?: string;
  /** "Watched Sep 12", or null. */
  watched: string | null;
  sources: StreamSource[] | null | "failed";
  notices: string[];
  onRetry: () => void;
  onPick: (s: StreamSource, queue: StreamSource[]) => void;
}) {
  const list = Array.isArray(sources) ? sources : [];
  const [sel, setSel] = useState<string | null>(null);
  const picked = list.find((s) => s.id === sel) ?? list[0];
  // The queue is what follows in the ADDON's order, as SourceList hands it.
  const play = (s: StreamSource) => onPick(s, list.slice(list.indexOf(s) + 1));
  const cols: ClassicCol<StreamSource>[] = [
    { key: "name", label: "Name", width: "minmax(0,1fr)", cell: (s) => <span title={s.lines.join("\n")}>{nameOf(s)}</span>, sort: nameOf },
    { key: "quality", label: "Quality", width: "100px", cell: (s) => s.quality, sort: (s) => qualityRank(s.quality) },
    { key: "cached", label: "Cached", width: "90px", cell: cachedLabel, sort: (s) => (s.cache === "cached" ? 0 : s.cache === "unknown" ? 1 : 2) },
  ];
  const facts: [string, string][] = [
    ["Year", item.year ? String(item.year) : ""],
    ["Runtime", item.runtimeMin ? runtime(item.runtimeMin) : ""],
    ["Rating", item.rating ? `★ ${item.rating.toFixed(1)} / 10` : ""],
    ["Genres", item.genres.join(", ")],
    ["Watched", watched ? watched.replace(/^Watched ?/, "") || "Yes" : ""],
  ];
  return (
    <div className="clt clt-film">
      <div className="clt-props">
        <div className="clt-tabs">
          <span>General</span>
        </div>
        <div className="clt-tbody">
          <div className="clt-top">
            {item.poster ? <img className="clt-art" src={item.poster} alt="" /> : <div className="clt-art" aria-hidden />}
            <dl className="clt-kv">
              <h2>{item.title}</h2>
              {episodeLabel && <p className="clt-ep">{episodeLabel}</p>}
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="clt-kvrow">
                    <dt>{k}:</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
          {item.synopsis && (
            <fieldset className="clt-gb">
              <legend>Synopsis</legend>
              <p>{item.synopsis}</p>
            </fieldset>
          )}
          {item.cast.length > 0 && (
            <fieldset className="clt-gb clt-grow">
              <legend>Cast</legend>
              <ul className="clt-cast">
                {item.cast.slice(0, 12).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </fieldset>
          )}
        </div>
      </div>
      <div className="clt-srcs">
        <div className="clt-lbl">
          Sources for {item.title}
          {item.year ? ` (${item.year})` : ""}
          {episodeLabel ? `, ${episodeLabel}` : ""}:
        </div>
        {sources === null && (
          <div className="clt-state" role="status">
            Finding Sources…
          </div>
        )}
        {sources === "failed" && (
          <div className="clt-state" role="alert">
            Couldn’t Load Sources
            <button type="button" className="clt-b" onClick={onRetry}>
              Try Again
            </button>
          </div>
        )}
        {Array.isArray(sources) && sources.length === 0 && (
          <div className="clt-state">
            No Sources Available
            {notices.map((n) => (
              <span key={n}>AIOStreams: {n}</span>
            ))}
          </div>
        )}
        {list.length > 0 && (
          <ClassicList
            label="Sources"
            cols={cols}
            rows={list}
            rowId={(s) => s.id}
            selected={picked?.id ?? null}
            onSelect={setSel}
            onOpen={play}
          />
        )}
        <div className="clt-btns">
          <button type="button" className="clt-b clt-def" disabled={!picked} onClick={() => picked && play(picked)}>
            Play
          </button>
          <SaveButton key={item.id} item={item} />
        </div>
      </div>
    </div>
  );
}
