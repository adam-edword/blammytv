import type { Episode } from "@blammytv/shared";

/** One episode in the grid: a 16:9 still with the episode number/title and air
 * date. Focusable button so it works under a TV remote. */
export function EpisodeCard({
  episode,
  onClick,
}: {
  episode: Episode;
  onClick: () => void;
}) {
  return (
    <button
      className="episode-card"
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
