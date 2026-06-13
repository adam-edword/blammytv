import type { VodItem } from "@blammytv/shared";

export function MediaCard({
  item,
  favorite,
}: {
  item: VodItem;
  favorite: boolean;
}) {
  const initials = item.title
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <button className="poster-card" type="button">
      <div className="poster-card__art">
        {item.poster ? (
          <img src={item.poster} alt="" loading="lazy" />
        ) : (
          <span className="poster-card__placeholder">{initials}</span>
        )}
        {favorite && (
          <span className="poster-card__fav" aria-label="Favorite">
            ★
          </span>
        )}
      </div>
      <span className="poster-card__title">{item.title}</span>
      {item.year && <span className="poster-card__sub">{item.year}</span>}
    </button>
  );
}
