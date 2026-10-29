import { useEffect, useMemo, useState } from "react";
import type { CardMetaField } from "../settings/cardMeta";
import type { VodItem } from "../stream/model";
import type { UpNextCard } from "../aiojf/rules";
import { Card } from "../../ui/Card";
import { RowScroller } from "../../ui/RowScroller";
import { JF_SYNCED, loadJf } from "./store";

/**
 * Next Up, under Continue Watching on the Stream home (plan 027, D5): the
 * episodes your Jellyfin says are next for the shows you follow. Read from what
 * the last sync stored, and again after each one. A card opens that show's
 * page, as a Continue Watching card for a show outside the catalog does. An
 * empty row does not render.
 *
 * `shared`: AIOStreams is signed in as well, and has a row of the same name, so
 * this one says whose it is. `title` is Home's name for it (plan 033), which the
 * person may have changed; it replaces both.
 */
export function JfUpNextRow({
  catalog,
  metaFields,
  onOpen,
  shared,
  title,
}: {
  /** The loaded library's items: a show in it opens as itself. */
  catalog: ReadonlyMap<string, VodItem>;
  metaFields: CardMetaField[];
  onOpen: (i: VodItem) => void;
  shared: boolean;
  title?: string;
}) {
  const [stored, setStored] = useState(loadJf);
  useEffect(() => {
    const reread = () => setStored(loadJf());
    window.addEventListener(JF_SYNCED, reread);
    return () => window.removeEventListener(JF_SYNCED, reread);
  }, []);

  const cards = useMemo(() => {
    const base = stored.signedIn?.base;
    const itemOf = (c: UpNextCard): VodItem =>
      catalog.get(c.seriesId) ?? {
        id: c.seriesId,
        title: c.seriesTitle,
        kind: "series",
        from: "jf",
        ...(base && c.imagePath ? { poster: base + c.imagePath } : {}),
        genres: [],
        cast: [],
        seasons: [],
      };
    return (stored.nextUp ?? []).map((c) => ({ key: c.episodeId, item: itemOf(c), meta: c.label }));
  }, [stored, catalog]);

  if (cards.length === 0) return null;
  return (
    <section className="media-row">
      <h3 className="media-row__title">{title ?? (shared ? "Next Up on Jellyfin" : "Next Up")}</h3>
      <RowScroller>
        {cards.map((c) => (
          <Card key={c.key} item={c.item} metaFields={metaFields} meta={c.meta} onOpen={onOpen} />
        ))}
      </RowScroller>
    </section>
  );
}
