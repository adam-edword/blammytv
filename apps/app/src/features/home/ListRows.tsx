import { Card } from "../../ui/Card";
import { RowScroller } from "../../ui/RowScroller";
import type { CardMetaField } from "../settings/cardMeta";
import type { VodItem } from "../stream/model";

/**
 * Home's list rows (plan 033, phase 3): Saved, Trakt, and Needs a Source.
 * A row of titles is the Library's own card in a Stream row (Library draws a
 * list's titles with the same Card), and a click opens the title's page. A row
 * with nothing in it draws nothing.
 */

export function TitlesRow({
  kind,
  title,
  items,
  metaFields,
  onOpen,
}: {
  /** `data-row`: which kind of row this is. */
  kind: "saved" | "trakt";
  title: string;
  items: readonly VodItem[];
  metaFields: CardMetaField[];
  onOpen: (i: VodItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="media-row" data-row={kind}>
      <h3 className="media-row__title">{title}</h3>
      <RowScroller>
        {items.map((item) => (
          <Card key={item.id} item={item} metaFields={metaFields} onOpen={onOpen} />
        ))}
      </RowScroller>
    </section>
  );
}

/** An imported row there is nothing to fill yet: its name and one quiet line.
 * No click, since there is nothing behind it. */
export function NeedsRow({ title }: { title: string }) {
  return (
    <section className="media-row home-needs" data-row="needs">
      <h3 className="media-row__title">{title}</h3>
      <p className="home-needs__note">This row needs a source.</p>
    </section>
  );
}
