import { useEffect } from "react";
import {
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { Episode } from "@blammytv/shared";
import { smoothCenterIntoView } from "../lib/scroll";
import { isTv } from "../lib/tv";

/** One episode in the grid: a 16:9 still with the episode number/title and air
 * date. Focusable button so it works under a TV remote.
 *
 * Pass `focusKey` to join spatial navigation (the episode browser); omit it
 * (e.g. the in-player panel) to render as a plain click/tap button. */
export function EpisodeCard({
  episode,
  onClick,
  focusKey,
}: {
  episode: Episode;
  onClick: () => void;
  focusKey?: string;
}) {
  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey,
    focusable: focusKey != null,
    onEnterPress: () => onClick(),
    onFocus: (layout: FocusableComponentLayout) => {
      if (layout.node) smoothCenterIntoView(layout.node, 200);
    },
  });
  // Mirror onto native DOM focus for a11y — desktop only (see lib/tv).
  useEffect(() => {
    if (focused && !isTv) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  return (
    <button
      ref={ref}
      className={"episode-card" + (focused ? " is-focused" : "")}
      type="button"
      title={episode.title}
      onClick={onClick}
    >
      <span className="episode-card__thumb">
        {episode.still && <img src={episode.still} alt="" loading="lazy" />}
      </span>
      <span className="episode-card__text">
        <span className="episode-card__title">
          {episode.number}. {episode.title}
        </span>
        {episode.airDate && (
          <span className="episode-card__date">{episode.airDate}</span>
        )}
      </span>
    </button>
  );
}
