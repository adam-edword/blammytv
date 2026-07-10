import { load, save } from "../../lib/storage";

/**
 * Which text the VOD playback overlay shows beside the title art (the
 * bottom-left block while a movie/episode plays). The art always shows;
 * these gate the text under it. Live TV chrome is untouched. Same
 * live-update pattern as cardMeta.
 */

export type OverlayMetaField = "title" | "description";

export const OVERLAY_META_FIELDS: ReadonlyArray<{
  key: OverlayMetaField;
  label: string;
}> = [
  { key: "title", label: "Episode Title" },
  { key: "description", label: "Description" },
];

const KEY = "overlayMeta";
const VERSION = 1;
const EVENT = "blammytv:overlay-meta";
const DEFAULT: OverlayMetaField[] = ["title", "description"];

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
