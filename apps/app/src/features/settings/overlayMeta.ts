import { load, save } from "../../lib/storage";

/**
 * Which pieces the VOD playback overlay shows in its bottom-left block —
 * fully granular per Adam: the art and each text fragment toggle
 * independently. Live TV chrome is untouched. Same live-update pattern
 * as cardMeta.
 */

export type OverlayMetaField =
  | "logo"
  | "season"
  | "episode"
  | "title"
  | "description";

export const OVERLAY_META_FIELDS: ReadonlyArray<{
  key: OverlayMetaField;
  label: string;
}> = [
  { key: "logo", label: "Logo Art" },
  { key: "season", label: "Season Number" },
  { key: "episode", label: "Episode Number" },
  { key: "title", label: "Episode Title" },
  { key: "description", label: "Description" },
];

const KEY = "overlayMeta";
// v2: the two-field version (title/description) became five granular ones.
const VERSION = 2;
const EVENT = "blammytv:overlay-meta";
const DEFAULT: OverlayMetaField[] = [
  "logo",
  "season",
  "episode",
  "title",
  "description",
];

function normalize(fields: OverlayMetaField[]): OverlayMetaField[] {
  const on = new Set(fields);
  return OVERLAY_META_FIELDS.filter((f) => on.has(f.key)).map((f) => f.key);
}

export function loadOverlayMeta(): OverlayMetaField[] {
  return normalize(load<OverlayMetaField[]>(KEY, VERSION, DEFAULT));
}

export function saveOverlayMeta(
  fields: OverlayMetaField[],
): OverlayMetaField[] {
  const next = normalize(fields);
  save(KEY, VERSION, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function onOverlayMetaChange(
  cb: (fields: OverlayMetaField[]) => void,
): () => void {
  const handler = (e: Event) =>
    cb((e as CustomEvent<OverlayMetaField[]>).detail ?? []);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Compose the overlay's one-line heading from the enabled fragments:
 * "S23 · E2 — Nami in a Fix!" with every piece independently removable.
 * Movies have no vod info — `fallbackTitle` (the movie name) rides the
 * title toggle. Returns "" when nothing's enabled/available. */
export function overlayHeading(
  fields: OverlayMetaField[],
  vod: { season?: number; episode?: number; title?: string } | undefined,
  fallbackTitle: string | undefined,
): string {
  const on = new Set(fields);
  const se = [
    on.has("season") && vod?.season != null ? `S${vod.season}` : null,
    on.has("episode") && vod?.episode != null ? `E${vod.episode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = on.has("title") ? ((vod ? vod.title : fallbackTitle) ?? "") : "";
  return [se, title].filter(Boolean).join(" — ");
}
