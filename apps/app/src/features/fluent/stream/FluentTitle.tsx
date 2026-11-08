import { useMemo } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../ui/Card";
import { PlayIcon, WarnIcon } from "../../../ui/icons";
import { RowScroller } from "../../../ui/RowScroller";
import { StateCard } from "../../../ui/StateCard";
import type { CardMetaField } from "../../settings/cardMeta";
import type { StreamSource, VodItem } from "../../stream/model";
import { SaveButton } from "../../stream/SaveButton";
import { FluentHeader } from "./FluentHeader";
import { SourceListView } from "./SourceListView";
import { viewSources } from "./sourceView";

const NO_FIELDS: CardMetaField[] = [];

/**
 * A film's page, and an episode's sources page (plan 035, "Fluent to tier
 * 3"): the shared header, then the title's sources as a ListView. Detail owns
 * the data (the resolve, its states, the More Like This pool) and hands it
 * here as it is, so what opens, plays and retries is Detail's own.
 *
 * Play is the first row of Best Match, with the queue after it in the
 * addon's order: the same pick a click on that row makes. Add to Library is
 * SaveButton as it is (its chevron is the lists menu, which is the one
 * extra action this page has, so there is no "More" button).
 */
export function FluentTitle({
  item,
  meta,
  episodeLabel,
  sources,
  notices,
  onRetry,
  onBack,
  onPlaySource,
  more,
  onOpenItem,
}: {
  item: VodItem;
  meta: string;
  episodeLabel?: string;
  sources: StreamSource[] | null | "failed";
  notices: string[];
  onRetry: () => void;
  onBack: () => void;
  onPlaySource: (s: StreamSource, queue: StreamSource[]) => void;
  more: VodItem[];
  onOpenItem?: (i: VodItem) => void;
}) {
  const first = useMemo(
    () => (Array.isArray(sources) ? viewSources(sources, "all", "best")[0] : undefined),
    [sources],
  );
  return (
    <div className="fls-title">
      <FluentHeader
        item={item}
        meta={meta}
        episodeLabel={episodeLabel}
        onBack={onBack}
        actions={
          <>
            <button
              type="button"
              className="fls-btn fls-btn--accent"
              disabled={!first}
              onClick={() =>
                first && Array.isArray(sources) && onPlaySource(first, sources.slice(sources.indexOf(first) + 1))
              }
            >
              <PlayIcon size={14} /> Play
            </button>
            {/* key: More Like This opens Detail over Detail in one instance. */}
            <SaveButton key={item.id} item={item} />
          </>
        }
      />
      {sources === null && <StateCard size="tile" role="status" busy title="Finding Sources…" />}
      {sources === "failed" && (
        <StateCard
          size="tile"
          role="alert"
          icon={<WarnIcon size={22} />}
          title="Couldn’t Load Sources"
          actions={
            <Button variant="default" type="button" onClick={onRetry}>
              Try Again
            </Button>
          }
        />
      )}
      {Array.isArray(sources) && sources.length === 0 && (
        <StateCard
          size="tile"
          icon={<PlayIcon size={22} />}
          title="No Sources Available"
          sub={
            <>
              Your addons came back with nothing playable for this one.
              {notices.map((n) => (
                <span key={n} className="state__note">
                  AIOStreams: {n}
                </span>
              ))}
            </>
          }
        />
      )}
      {Array.isArray(sources) && sources.length > 0 && <SourceListView sources={sources} onPick={onPlaySource} />}
      {more.length > 0 && (
        <div className="stream__rows fls-more">
          <section className="media-row">
            <h3 className="media-row__title">More Like This</h3>
            <RowScroller>
              {more.map((v) => (
                <Card key={v.id} item={v} metaFields={NO_FIELDS} onOpen={(i) => onOpenItem?.(i)} />
              ))}
            </RowScroller>
          </section>
        </div>
      )}
    </div>
  );
}
