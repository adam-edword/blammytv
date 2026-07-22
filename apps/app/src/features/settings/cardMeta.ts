import { load, save } from "../../lib/storage";

/**
 * Which details show under a Stream card's title (the `.stream-card__meta`
 * line). Stored as the set of enabled fields; the line always renders in
 * canonical order regardless of toggle order, so it reads the same on
 * every card. Saving notifies listeners (the Stream home) so cards update
 * live while Settings is open.
 */

export type CardMetaField = "rating" | "year" | "runtime" | "genre" | "kind";

/** Canonical order + labels — the picker and the line both follow this. */
export const CARD_META_FIELDS: ReadonlyArray<{
  key: CardMetaField;
  label: string;
}> = [
  { key: "rating", label: "Rating" },
  { key: "year", label: "Year" },
  { key: "runtime", label: "Runtime" },
  { key: "genre", label: "Genre" },
  { key: "kind", label: "Type" },
];

const KEY = "cardMeta";
const VERSION = 1;
const EVENT = "blammytv:card-meta";
const DEFAULT: CardMetaField[] = ["rating", "year", "runtime"];

/** Drop unknown keys and impose canonical order. */
function normalize(fields: CardMetaField[]): CardMetaField[] {
  const on = new Set(fields);
  return CARD_META_FIELDS.filter((f) => on.has(f.key)).map((f) => f.key);
}

export function loadCardMeta(): CardMetaField[] {
  return normalize(load<CardMetaField[]>(KEY, VERSION, DEFAULT));
}

export function saveCardMeta(fields: CardMetaField[]): CardMetaField[] {
  const next = normalize(fields);
  save(KEY, VERSION, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function onCardMetaChange(
  cb: (fields: CardMetaField[]) => void,
): () => void {
  const handler = (e: Event) =>
    cb((e as CustomEvent<CardMetaField[]>).detail ?? []);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Build the " · "-joined line for one card from whatever parts it has —
 * enabled fields with no value just don't appear. */
export function cardMetaLine(
  fields: CardMetaField[],
  parts: {
    rating?: number;
    year?: number;
    runtimeMin?: number;
    genre?: string;
    kind?: "movie" | "series";
  },
): string {
  const text: Record<CardMetaField, string | null> = {
    rating: parts.rating ? parts.rating.toFixed(1) : null,
    year: parts.year ? String(parts.year) : null,
    runtime: parts.runtimeMin ? `${parts.runtimeMin} min` : null,
    genre: parts.genre ?? null,
    kind: parts.kind ? (parts.kind === "series" ? "Series" : "Movie") : null,
  };
  return fields
    .map((f) => text[f])
    .filter(Boolean)
    .join(" · ");
}
