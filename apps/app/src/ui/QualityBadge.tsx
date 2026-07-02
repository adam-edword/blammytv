import type { Quality } from "../features/live/mock";

/** The design's tiny quality tags: gradient fills with per-tier borders
 * (4K rainbow, FHD gold, HD plain, HDR silver). */
export function QualityBadge({ quality }: { quality: Quality }) {
  return (
    <span className={`badge badge--${quality.toLowerCase()}`}>{quality}</span>
  );
}
