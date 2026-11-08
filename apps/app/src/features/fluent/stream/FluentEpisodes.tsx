import { Button } from "../../../components/ui/button";
import { dayLabel } from "../../../lib/time";
import { CheckIcon, PlayIcon, WarnIcon } from "../../../ui/icons";
import { Segmented } from "../../../ui/Segmented";
import { StateCard } from "../../../ui/StateCard";
import { isOut } from "../../stream/mapper";
import type { Episode, Season, VodItem } from "../../stream/model";
import type { WatchEntry } from "../../stream/watching";
import { SaveButton } from "../../stream/SaveButton";
import { FluentHeader } from "./FluentHeader";

/**
 * A series' page in Fluent (plan 035, "Fluent to tier 3"): the shared header,
 * a SelectorBar of seasons and the episodes as card rows. Episodes owns the
 * data (the watched ledger, where you are, the season pick) and hands it here
 * as it is; this only draws it.
 *
 * Watched is a check on the row, and the one you are part-way through has its
 * progress as a bar under the picture. The episode up next wears the accent
 * pill. One not aired yet is dimmed and a disabled button, so it takes no
 * click and no Tab, as it always has.
 *
 * An episode has no synopsis or runtime in the data (Episode is a number, a
 * title, a day and a still), so the row says no more than those.
 */
export function FluentEpisodes({
  item,
  meta,
  metaState,
  onRetryMeta,
  onBack,
  seasonIdx,
  onSeason,
  season,
  watched,
  entry,
  nextUp,
  now,
  onPick,
}: {
  item: VodItem;
  meta: string;
  metaState: "pending" | "failed" | "ready";
  onRetryMeta?: () => void;
  onBack: () => void;
  seasonIdx: number;
  onSeason: (i: number) => void;
  season: Season | undefined;
  watched: ReadonlySet<string>;
  entry: WatchEntry | undefined;
  nextUp: string | null | undefined;
  now: number;
  onPick: (season: Season, episode: Episode) => void;
}) {
  const up = nextUp
    ? item.seasons.flatMap((s) => s.episodes.map((e) => ({ s, e }))).find((x) => x.e.id === nextUp)
    : undefined;
  // Progress at all: something watched, or a part-played one on file.
  const resume = up && (watched.size > 0 || !!entry) ? up : undefined;
  return (
    <div className="fls-title fls-eps-page">
      <FluentHeader
        item={item}
        meta={meta}
        onBack={onBack}
        actions={
          <>
            {resume && (
              <button
                type="button"
                className="fls-btn fls-btn--accent"
                onClick={() => onPick(resume.s, resume.e)}
              >
                <PlayIcon size={14} /> Resume S{resume.s.number} E{resume.e.number}
              </button>
            )}
            <SaveButton key={item.id} item={item} />
          </>
        }
      />
      {item.seasons.length === 0 ? (
        metaState === "failed" ? (
          <StateCard
            size="tile"
            role="alert"
            icon={<WarnIcon size={22} />}
            title="Couldn’t Load Episodes"
            actions={
              <Button variant="default" type="button" onClick={onRetryMeta}>
                Try Again
              </Button>
            }
          />
        ) : metaState === "ready" ? (
          <StateCard size="tile" icon={<PlayIcon size={22} />} title="No Episodes Listed" />
        ) : (
          <StateCard size="tile" role="status" busy title="Loading Episodes…" />
        )
      ) : (
        <>
          <Segmented
            className="season-bar fls-selector"
            label="Season"
            options={item.seasons.map((s, i) => ({ key: String(i), label: s.name }))}
            value={String(seasonIdx)}
            onChange={(k) => onSeason(Number(k))}
          />
          <div className="fls-eps" role="list" aria-label={season?.name ?? "Episodes"}>
            {season?.episodes.map((e) => {
              const seen = watched.has(e.id);
              const out = isOut(e, now);
              const airs = !out && e.airsAt != null ? dayLabel(new Date(e.airsAt)) : null;
              const at =
                entry?.episodeId === e.id && entry.posSec && entry.durSec
                  ? Math.min(100, (entry.posSec / entry.durSec) * 100)
                  : null;
              return (
                <div key={e.id} role="listitem" className="fls-ep-wrap">
                  <button
                    type="button"
                    className={"fls-ep" + (out ? "" : " is-unaired") + (e.id === nextUp ? " is-next" : "")}
                    disabled={!out}
                    onClick={() => onPick(season!, e)}
                  >
                    <span className="fls-ep__pic">
                      {e.still ? (
                        <img src={e.still} alt="" loading="lazy" />
                      ) : (
                        <span className="fls-ep__mono" aria-hidden>
                          {e.number}
                        </span>
                      )}
                      {at != null && !seen && (
                        <span className="fls-ep__bar" aria-hidden>
                          <i style={{ width: `${at}%` }} />
                        </span>
                      )}
                    </span>
                    <span className="fls-ep__text">
                      <span className="fls-ep__title">
                        {e.number}. {e.title}
                      </span>
                      {(airs ? `Airs ${airs}` : e.airDate) && (
                        <span className="fls-ep__sub">{airs ? `Airs ${airs}` : e.airDate}</span>
                      )}
                    </span>
                    {seen && (
                      <span className="fls-ep__seen" role="img" aria-label="Watched">
                        <CheckIcon size={12} />
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
