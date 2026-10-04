import { useEffect, useMemo, useState } from "react";
import type { CardMetaField } from "../settings/cardMeta";
import type { VodItem } from "../stream/model";
import { calendarDay } from "../../lib/time";
import { Card } from "../../ui/Card";
import { RowScroller } from "../../ui/RowScroller";
import { AIOJF_SYNCED, loadAiojf } from "./store";
import type { UpNextCard } from "./rules";

/** "Oct 7", with the year when it is not this year's. A day, not a moment
 * (calendarDay): AIOStreams passes the meta's `released` on, and an addon's
 * `T00:00:00Z` read in Chicago is the day before. */
function airDate(ms: number): string {
  const d = calendarDay(new Date(ms).toISOString());
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/**
 * Next Up and Upcoming, under Continue Watching on the Stream home (plan 023,
 * A5): the episodes AIOStreams says are next for the shows you follow, and the
 * ones about to air. Read from what the last sync stored, and again after each
 * one. A card opens that show's episode page, as a Continue Watching card for
 * a show outside the catalog does. An empty row does not render.
 */
export function UpNextRows({
  catalog,
  metaFields,
  onOpen,
}: {
  /** The loaded catalog's items: a show in it opens as itself. */
  catalog: ReadonlyMap<string, VodItem>;
  metaFields: CardMetaField[];
  onOpen: (i: VodItem) => void;
}) {
  const [stored, setStored] = useState(loadAiojf);
  useEffect(() => {
    const reread = () => setStored(loadAiojf());
    window.addEventListener(AIOJF_SYNCED, reread);
    return () => window.removeEventListener(AIOJF_SYNCED, reread);
  }, []);

  const rows = useMemo(() => {
    const itemOf = (c: UpNextCard): VodItem =>
      catalog.get(c.seriesId) ?? {
        id: c.seriesId,
        title: c.seriesTitle,
        kind: "series",
        ...(stored.base && c.imagePath ? { poster: stored.base + c.imagePath } : {}),
        genres: [],
        cast: [],
        seasons: [],
      };
    const rowOf = (title: string, cards: UpNextCard[] | undefined, said: (c: UpNextCard) => string) => ({
      title,
      cards: (cards ?? []).map((c) => ({ key: c.episodeId, item: itemOf(c), meta: said(c) })),
    });
    return [
      rowOf("Next Up", stored.nextUp, (c) => c.label),
      rowOf("Upcoming", stored.upcoming, (c) => (c.airsAt != null ? `${airDate(c.airsAt)} · ${c.label}` : c.label)),
    ].filter((r) => r.cards.length > 0);
  }, [stored, catalog]);

  return (
    <>
      {rows.map((row) => (
        <section key={row.title} className="media-row">
          <h3 className="media-row__title">{row.title}</h3>
          <RowScroller>
            {row.cards.map((c) => (
              <Card key={c.key} item={c.item} metaFields={metaFields} meta={c.meta} onOpen={onOpen} />
            ))}
          </RowScroller>
        </section>
      ))}
    </>
  );
}
