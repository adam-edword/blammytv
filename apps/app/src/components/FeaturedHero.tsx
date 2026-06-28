import { useEffect, useState, type CSSProperties } from "react";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, gradientFor } from "../lib/vod";
import { PlayIcon, InfoIcon } from "./icons";
import { FocusButton } from "./FocusButton";

/** How long each featured title is shown before auto-advancing. */
const ROTATE_MS = 7000;

/** The Stream page's spotlight: a full-bleed, auto-advancing carousel of
 * featured titles with Watch Now / More Info and a dot pager. When artwork is
 * missing it falls back to a per-title gradient so each slide still feels
 * distinct. */
export function FeaturedHero({
  items,
  onOpen,
}: {
  items: VodItem[];
  onOpen?: (item: VodItem) => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Clamp if the list shrinks (e.g. a new config arrives).
  const safeIndex = items.length ? index % items.length : 0;

  useEffect(() => {
    if (items.length <= 1 || paused) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [items.length, paused]);

  const item = items[safeIndex];
  if (!item) return null;

  const backdrop = item.backdrop ?? item.poster;
  const backdropStyle: CSSProperties = backdrop
    ? { backgroundImage: `url(${backdrop})` }
    : { background: gradientFor(item.id) };

  const meta = [
    item.year,
    item.runtimeMin ? `${item.runtimeMin} min` : null,
    item.kind === "series" ? "Series" : "Movie",
    item.rating != null ? `★ ${item.rating.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* key forces a fresh fade-in each time the slide changes */}
      <div key={item.id} className="hero__backdrop" style={backdropStyle} />
      <div className="hero__scrim" />

      <div className="hero__content">
        {item.logo ? (
          <img className="hero__logo" src={item.logo} alt={item.title} />
        ) : (
          <h1 className="hero__title">{item.title}</h1>
        )}
        {item.synopsis && <p className="hero__synopsis">{item.synopsis}</p>}
        <p className="hero__meta">{meta || formatMeta(item)}</p>

        <div className="hero__actions">
          <FocusButton
            className="btn btn--primary hero__btn"
            ariaLabel="Watch now"
            onPress={() => onOpen?.(item)}
          >
            <PlayIcon size={20} />
            Watch Now
          </FocusButton>
          <FocusButton
            className="btn hero__btn"
            ariaLabel="More info"
            onPress={() => onOpen?.(item)}
          >
            <InfoIcon size={20} />
            More Info
          </FocusButton>
        </div>
      </div>

      <div className="hero__dots" role="tablist" aria-label="Featured titles">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={i === safeIndex}
            aria-label={it.title}
            className={"hero__dot" + (i === safeIndex ? " hero__dot--active" : "")}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  );
}
