import type { Quality } from "../features/live/model";

/** The design's tiny quality tags: gradient fills with per-tier borders
 * (4K rainbow, FHD gold, HD plain, HDR silver).
 *
 * Hidden from screen readers: the quality is read out of the channel's own
 * name (extractQuality), which sits beside it everywhere it is drawn, so a
 * row was read "Fake Sky Sports FHD FHD" (plan 018, U13). */
export function QualityBadge({ quality }: { quality: Quality }) {
  return (
    <span className={`badge badge--${quality.toLowerCase()}`} aria-hidden>
      {quality}
    </span>
  );
}
