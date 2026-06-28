import { useMemo } from "react";
import type { ConfigBlob, VodItem } from "@blammytv/shared";
import { FeaturedHero } from "../components/FeaturedHero";
import { HeroSlider } from "../components/HeroSlider";
import { MediaRow } from "../components/MediaRow";
import { SourceError } from "../components/SourceError";
import { vodCatalog } from "../lib/vod";

/** TV build (Android): the remote-driven peek-slider hero. Desktop keeps the
 * classic auto-advancing FeaturedHero (until the Windows port lands). */
const isTv =
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("is-android");

/** The Stream home: a featured hero carousel over a stack of horizontally
 * scrolling rows. Rows and the featured list come straight from the config
 * blob (the backend owns the grouping); we just resolve ids → catalog items.
 * Opening a title is handled by the app's navigation stack. */
export function StreamScreen({
  config,
  error,
  onRetry,
  onOpen,
}: {
  config: ConfigBlob;
  /** Set when the AIOStreams catalog failed to load (independent of Live TV). */
  error?: string;
  onRetry: () => void;
  onOpen: (item: VodItem) => void;
}) {
  const { stream, movies, series } = config;

  const catalog = useMemo(() => vodCatalog(movies, series), [movies, series]);

  const resolve = (ids: string[]): VodItem[] =>
    ids.map((id) => catalog.get(id)).filter((i): i is VodItem => Boolean(i));

  const featured = resolve(stream.featured);

  if (error) {
    return <SourceError message={error} onRetry={onRetry} />;
  }

  // No focus container around the whole screen: it's full-bleed (the hero sits
  // behind the header), so its box would overlap the tabs and break Down nav
  // out of the header. The hero buttons + MediaRow containers register at the
  // root and sit genuinely below the tabs.
  return (
    <div className="stream">
      {isTv ? (
        <HeroSlider items={featured} onOpen={onOpen} />
      ) : (
        <FeaturedHero items={featured} onOpen={onOpen} />
      )}
      <div className="stream__rows">
        {stream.rows.map((row) => (
          <MediaRow
            key={row.id}
            rowId={row.id}
            title={row.title}
            layout={row.layout}
            items={resolve(row.itemIds)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
