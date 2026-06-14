import { useEffect, useState, type CSSProperties } from "react";
import type { VodItem } from "@blammytv/shared";
import { formatMeta } from "../lib/vod";
import { PlayIcon, InfoIcon } from "./icons";

/** How long each featured title is shown before auto-advancing. */
const ROTATE_MS = 7000;

/** The Stream page's spotlight: a full-bleed, auto-advancing carousel of
 * featured titles with Watch Now / More Info and a dot pager. When artwork is
 * missing it falls back to a per-title gradient so each slide still feels
 * distinct. */
export function FeaturedHero({ items }: { items: VodItem[] }) {
  const [index, setIndex] = useState(0);

  // Clamp if the list shrinks (e.g. a new config arrives).
  const safeIndex = items.length ? index % items.length : 0;

  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [items.length]);

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
    <section className="hero" aria-roledescription="carousel">
      {/* key forces a fresh fade-in each time the slide changes */}
      <div key={item.id} className="hero__backdrop" style={backdropStyle} />
      <div className="hero__scrim" />

      <div className="hero__content">
        <h1 className="hero__title">{item.title}</h1>
        {item.synopsis && <p className="hero__synopsis">{item.synopsis}</p>}
        <p className="hero__meta">{meta || formatMeta(item)}</p>

        <div className="hero__actions">
          <button className="btn btn--primary hero__btn" type="button">
            <PlayIcon size={20} />
            Watch Now
          </button>
          <button className="btn hero__btn" type="button">
            <InfoIcon size={20} />
            More Info
          </button>
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

/** Deterministic placeholder gradient from an item id (stable across reloads). */
function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(120deg, hsl(${hue} 38% 28%), hsl(${(hue + 40) % 360} 32% 14%))`;
}
