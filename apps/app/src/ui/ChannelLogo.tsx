import { useEffect, useState } from "react";

/**
 * A channel's logo on a white tile, or its first letter on the same tile
 * when there is none or it broke (plan 019, K6). Multi-view's MvLogo, made
 * the app's: the Guide drew logos free-floating in a 44 by 64 box and its
 * initials bare, and plan 016 4.3 asked for exactly this.
 *
 * White, because provider logos are drawn for either ground and most of
 * them read on white.
 *
 * SIZED WITHOUT THE STYLESHEET. Provider logos come at their own size, and
 * Cartoon Network's is several hundred pixels: on Adam's first run of
 * v0.9.107 the page came back from a mid-pull reload with the new markup
 * and the old CSS, and each caption drew one at full size across the grid.
 * The box and the image carry their size themselves, so a stylesheet that
 * is late, stale or missing cannot do that again.
 */
export function ChannelLogo({
  name,
  logo,
  size,
  lazy = false,
  className,
}: {
  name: string;
  logo?: string;
  size: number;
  /** For a long list (the Guide), where most rows are off screen. */
  lazy?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [logo]);
  return (
    <span
      className={"chlogo" + (className ? ` ${className}` : "")}
      style={{
        display: "inline-grid",
        overflow: "hidden",
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
      }}
      aria-hidden
    >
      {logo && !broken ? (
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          loading={lazy ? "lazy" : undefined}
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        name.trim()[0]
      )}
    </span>
  );
}
