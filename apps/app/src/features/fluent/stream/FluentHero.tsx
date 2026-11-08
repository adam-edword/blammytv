import { useEffect, useState } from "react";
import { REDUCED_MOTION } from "../../../lib/reducedMotion";
import { PlayIcon } from "../../../ui/icons";
import type { VodItem } from "../../stream/model";

/**
 * Home's hero in Fluent (plan 035, "Fluent to tier 3"): one 8px banner, the
 * title, its meta line, an accent Watch Now and a standard More Info, and a
 * row of pips to move between the featured titles. The same two actions the
 * large hero has (Watch Now plays, More Info opens the page) on the same
 * `items`, which the screen picks as it always did.
 *
 * It advances on its own every eight seconds, as the other heroes do, and
 * stops under the pointer, with focus inside it and under reduced motion.
 */
export function FluentHero({
  items,
  onOpen,
  onWatchNow,
}: {
  items: VodItem[];
  onOpen: (i: VodItem) => void;
  onWatchNow: (i: VodItem) => void;
}) {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const count = items.length;
  useEffect(() => {
    if (held || REDUCED_MOTION || count < 2) return;
    const id = window.setInterval(() => setAt((x) => (x + 1) % count), 8000);
    return () => window.clearInterval(id);
  }, [held, count]);
  const item = items[Math.min(at, count - 1)];
  if (!item) return null;
  const art = item.backdrop ?? item.poster;
  const meta = [item.year, item.runtimeMin ? `${item.runtimeMin} min` : null, item.kind === "series" ? "Series" : "Movie"]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      className="fls-banner"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      {art && <img key={art} className="fls-banner__art" src={art} alt="" />}
      <div className="fls-banner__scrim" aria-hidden />
      <div className="fls-banner__text">
        <h2 className="fls-banner__title">{item.title}</h2>
        <p className="fls-banner__meta">
          {meta}
          {item.rating ? ` · ★ ${item.rating.toFixed(1)}/10` : ""}
        </p>
        <div className="fls-banner__actions">
          <button type="button" className="fls-btn fls-btn--accent" onClick={() => onWatchNow(item)}>
            <PlayIcon size={14} /> Watch Now
          </button>
          <button type="button" className="fls-btn" onClick={() => onOpen(item)}>
            More Info
          </button>
        </div>
      </div>
      {count > 1 && (
        <div className="fls-banner__pips" role="group" aria-label="Featured Titles">
          {items.map((it, n) => (
            <button
              key={it.id}
              type="button"
              className="fls-pip"
              aria-label={`${it.title}, ${n + 1} of ${count}`}
              aria-pressed={n === at}
              onClick={() => setAt(n)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
