import { useMemo, useState } from "react";
import type { ConfigBlob, VodItem } from "@blammytv/shared";
import { FeaturedHero } from "../components/FeaturedHero";
import { MediaRow } from "../components/MediaRow";
import { TitleDetail } from "./TitleDetail";
import { vodCatalog } from "../lib/vod";

/** The Stream tab: a featured hero carousel over a stack of horizontally
 * scrolling rows. Rows and the featured list come straight from the config
 * blob (the backend owns the grouping); we just resolve ids → catalog items.
 * Opening a title swaps in its detail / source-selection page. */
export function StreamScreen({ config }: { config: ConfigBlob }) {
  const { stream, movies, series } = config;
  const [openItem, setOpenItem] = useState<VodItem | null>(null);

  const catalog = useMemo(
    () => vodCatalog(movies, series),
    [movies, series],
  );

  const resolve = (ids: string[]): VodItem[] =>
    ids.map((id) => catalog.get(id)).filter((i): i is VodItem => Boolean(i));

  if (openItem) {
    return <TitleDetail item={openItem} onBack={() => setOpenItem(null)} />;
  }

  const featured = resolve(stream.featured);

  return (
    <div className="stream">
      <FeaturedHero items={featured} onOpen={setOpenItem} />
      <div className="stream__rows">
        {stream.rows.map((row) => (
          <MediaRow
            key={row.id}
            title={row.title}
            layout={row.layout}
            items={resolve(row.itemIds)}
            onOpen={setOpenItem}
          />
        ))}
      </div>
    </div>
  );
}
