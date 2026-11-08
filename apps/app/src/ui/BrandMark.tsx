import type { CSSProperties } from "react";

/**
 * The BlammyTV mark, drawn the way the capsule draws it (base.css,
 * `.navcap__mark b` and `i`): a 1143px conic plate clipped to the logo's path
 * and scaled down to `size`. Plan 035's rule: the logo never changes in any
 * theme, so every theme's chrome uses this and only the size may differ.
 * Classic's radius reset leaves it alone (classic-chrome.css).
 */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  return (
    <b
      className={"brand-mark" + (className ? ` ${className}` : "")}
      style={{ "--bm": `${size}px`, "--bm-scale": size / 1143 } as CSSProperties}
      aria-hidden
    >
      <i />
    </b>
  );
}
