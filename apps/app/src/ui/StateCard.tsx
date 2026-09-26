import type { HTMLAttributes, ReactNode } from "react";

/**
 * Nothing here, drawn one way (plan 019, K8): multi-view's tile state. An
 * icon, what happened, why, and a way on. It replaces the app's other
 * empty, error and loading layouts (plan 016 3.3 counted nine): a 14px
 * line at 0.6 opacity in the Guide, a heading and a paragraph on Stream,
 * a 64px faded mark on Sports, a bare sentence in the source column.
 *
 * Not shadcn's Empty, on purpose. Empty is presentational only (divs and
 * utility classes, no behaviour), and utilities outrank the app layer
 * here, so the one thing this needs from CSS, resizing to the tile it sits
 * in by container query (player.css, multi-view's small tiles), could not
 * reach it. Every rule is ui.css's `.state`.
 *
 * `busy` swaps the icon for the player's buffering pulse, so a loading
 * state speaks the same language as a tuning tile. `size` is "tile" for a
 * state inside a picture or a narrow column, "page" for one that takes a
 * screen. `onImage` is for a state drawn over artwork, where the page pins
 * a light foreground whatever the theme.
 */
export function StateCard({
  icon,
  busy,
  title,
  sub,
  actions,
  size = "page",
  onImage,
  className,
  ...rest
}: {
  icon?: ReactNode;
  busy?: boolean;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  size?: "tile" | "page";
  onImage?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div
      className={
        `state state--${size}` +
        (onImage ? " state--on-image" : "") +
        (className ? ` ${className}` : "")
      }
      {...rest}
    >
      {busy ? (
        <span className="state__icon is-busy" aria-hidden>
          <span className="buffering__dot" />
        </span>
      ) : icon ? (
        <span className="state__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <b className="state__title">{title}</b>
      {sub && <span className="state__sub">{sub}</span>}
      {actions && <span className="state__acts">{actions}</span>}
    </div>
  );
}
