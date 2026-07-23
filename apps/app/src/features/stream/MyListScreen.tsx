import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "./StreamScreen";
import { loadMyList, type ListEntry } from "./myList";
import { requestOpenInStream } from "./openRequest";
import type { VodItem } from "./model";
import {
  loadCardMeta,
  onCardMetaChange,
  type CardMetaField,
} from "../settings/cardMeta";

/**
 * My List: Discover's grid — JUST the grid — fed by saved titles
 * (newest first). Same Card component, same layout classes, same
 * hand-off into the Stream tab; backing out returns here (the mailbox
 * carries origin "mylist"). Deliberately minimal for now — expansion
 * (rows, sorting, cross-device) comes later.
 */

/** A stored snapshot re-shaped for the shared Card. Opening resolves
 * fresh full meta exactly like a Discover pick. */
const toItem = (e: ListEntry): VodItem => ({
  id: e.id,
  title: e.title,
  kind: e.kind,
  ...(e.poster ? { poster: e.poster } : {}),
  ...(e.backdrop ? { backdrop: e.backdrop } : {}),
  ...(e.logo ? { logo: e.logo } : {}),
  ...(e.year != null ? { year: e.year } : {}),
  ...(e.rating != null ? { rating: e.rating } : {}),
  ...(e.runtimeMin != null ? { runtimeMin: e.runtimeMin } : {}),
  genres: [],
  cast: [],
  seasons: [],
});

export function MyListScreen() {
  // Re-read per mount — saves land between visits (detail's button).
  const [entries] = useState<ListEntry[]>(loadMyList);
  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  useEffect(() => onCardMetaChange(setMetaFields), []);
  // Movies and series mix in one grid — always say which is which
  // (same rule as Discover's All Content).
  const gridMetaFields = useMemo(
    () =>
      metaFields.includes("kind")
        ? metaFields
        : [...metaFields, "kind" as const],
    [metaFields],
  );
  // Stable per-entry items — Card is memoized and toItem builds objects.
  const items = useMemo(() => entries.map(toItem), [entries]);

  const open = useCallback(
    (item: VodItem) => requestOpenInStream(item, "mylist"),
    [],
  );

  if (entries.length === 0) {
    return (
      <div className="discover discover--empty">
        <h2>Nothing saved yet.</h2>
        <p className="discover__note">
          Open a title and hit &ldquo;+ My List&rdquo; to keep it here.
        </p>
      </div>
    );
  }

  return (
    <div className="discover">
      <section className="discover__gridwrap">
        <div className="disc-grid">
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              metaFields={gridMetaFields}
              onOpen={open}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
