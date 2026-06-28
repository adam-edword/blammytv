import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  setFocus,
  useFocusable,
  type FocusableComponentLayout,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem } from "@blammytv/shared";
import { formatMeta, gradientFor } from "../lib/vod";
import { PlayIcon, InfoIcon } from "./icons";

// Focus keys for the two-level model.
const CAROUSEL_KEY = "hero-carousel";
const WATCH_KEY = "hero-watch";
const INFO_KEY = "hero-info";

/** How long each featured title shows before auto-advancing (when idle). */
const ROTATE_MS = 7000;

/**
 * The TV/remote hero: a peek slider (active slide centered, neighbours peeking)
 * with a deliberate two-level focus model — no auto-advance.
 *
 * - Browse mode: the whole carousel is one focus stop. ◀/▶ change the featured
 *   title; ▲/▼ leave the hero (to the tabs / the rows); ● enters the slide.
 * - Entered: focus is on Watch Now. ◀/▶ move between Watch Now / More Info, and
 *   overshooting either end pops back to browse. ▲ also pops to browse; ▼ drops
 *   to the rows; ● plays.
 *
 * Desktop keeps the classic FeaturedHero — this is rendered only on Android.
 */
export function HeroSlider({
  items,
  onOpen,
}: {
  items: VodItem[];
  onOpen?: (item: VodItem) => void;
}) {
  const [index, setIndex] = useState(0);
  const [entered, setEntered] = useState(false);
  const count = items.length;
  const safeIndex = count ? ((index % count) + count) % count : 0;

  const prev = () => {
    if (count) setIndex((i) => (i - 1 + count) % count);
  };
  const next = () => {
    if (count) setIndex((i) => (i + 1) % count);
  };
  const exitToCarousel = () => {
    setEntered(false);
    setFocus(CAROUSEL_KEY);
  };

  // The carousel is always focusable (so Down from the tabs lands here); the
  // action buttons are only focusable once entered, so they're skipped in the
  // vertical flow.
  const { ref, focused } = useFocusable<HTMLDivElement>({
    focusKey: CAROUSEL_KEY,
    onEnterPress: () => setEntered(true),
    // Focusing the hero (e.g. coming back up from a row) scrolls the page to the
    // top so the whole hero is shown.
    onFocus: (layout: FocusableComponentLayout) =>
      layout.node?.scrollIntoView({ block: "start", behavior: "smooth" }),
    onArrowPress: (dir) => {
      if (dir === "left") {
        prev();
        return false;
      }
      if (dir === "right") {
        next();
        return false;
      }
      return true; // up/down → let norigin leave the hero
    },
  });

  // Move focus onto Watch Now once the buttons become focusable on enter.
  useEffect(() => {
    if (entered) setFocus(WATCH_KEY);
  }, [entered]);

  // Auto-advance — but only while the carousel isn't engaged (not focused in
  // browse mode and not entered), so a slide never moves under you.
  useEffect(() => {
    if (focused || entered || count <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % count),
      ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [focused, entered, count]);

  const item = items[safeIndex];
  if (!item) return null;

  const watchArrow = (dir: string): boolean => {
    if (dir === "left" || dir === "up") {
      exitToCarousel();
      return false;
    }
    if (dir === "down") {
      setEntered(false);
      return true; // norigin → rows
    }
    return true; // right → More Info
  };
  const infoArrow = (dir: string): boolean => {
    if (dir === "right" || dir === "up") {
      exitToCarousel();
      return false;
    }
    if (dir === "down") {
      setEntered(false);
      return true; // norigin → rows
    }
    return true; // left → Watch Now
  };

  return (
    <div
      className={"hero-slider" + (focused && !entered ? " is-focused" : "")}
      ref={ref}
    >
      {/* Focus glow — outside the clipped viewport so it isn't cut off; sits over
          the centred active card with a transparent centre. */}
      <div className="hero-slider__glow" aria-hidden="true" />
      <div className="hero-slider__viewport">
        <div
          className="hero-slider__track"
          style={{ "--hero-i": safeIndex } as CSSProperties}
        >
          {items.map((it, i) => {
            const active = i === safeIndex;
            const backdrop = it.backdrop ?? it.poster;
            const artStyle: CSSProperties = backdrop
              ? { backgroundImage: `url(${backdrop})` }
              : { background: gradientFor(it.id) };
            return (
              <article
                key={it.id}
                className={"hero-slide" + (active ? " is-active" : "")}
                style={artStyle}
              >
                <div className="hero-slide__fade" />
                {active && (
                  <div className="hero-slide__content">
                    {it.logo ? (
                      <img
                        className="hero-slide__logo"
                        src={it.logo}
                        alt={it.title}
                      />
                    ) : (
                      <h1 className="hero-slide__title">{it.title}</h1>
                    )}
                    {it.synopsis && (
                      <p className="hero-slide__synopsis">{it.synopsis}</p>
                    )}
                    <p className="hero-slide__meta">{heroMeta(it)}</p>
                    <div className="hero-slide__actions">
                      <HeroAction
                        focusKey={WATCH_KEY}
                        focusable={entered}
                        className="btn btn--primary hero__btn"
                        ariaLabel="Watch now"
                        onPress={() => onOpen?.(it)}
                        onArrow={watchArrow}
                      >
                        <PlayIcon size={14} />
                        Watch Now
                      </HeroAction>
                      <HeroAction
                        focusKey={INFO_KEY}
                        focusable={entered}
                        className="btn hero__btn"
                        ariaLabel="More info"
                        onPress={() => onOpen?.(it)}
                        onArrow={infoArrow}
                      >
                        <InfoIcon size={14} />
                        More Info
                      </HeroAction>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A hero action button wired into the two-level focus model. */
function HeroAction({
  focusKey,
  focusable,
  className,
  ariaLabel,
  onPress,
  onArrow,
  children,
}: {
  focusKey: string;
  focusable: boolean;
  className: string;
  ariaLabel: string;
  onPress: () => void;
  onArrow: (dir: string) => boolean;
  children: ReactNode;
}) {
  const { ref, focused } = useFocusable<HTMLButtonElement>({
    focusKey,
    focusable,
    onEnterPress: onPress,
    onArrowPress: (dir) => onArrow(dir),
  });
  useEffect(() => {
    if (focused) ref.current?.focus({ preventScroll: true });
  }, [focused, ref]);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      className={className + (focused ? " is-focused" : "")}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

function heroMeta(item: VodItem): string {
  return (
    [
      item.year,
      item.runtimeMin ? `${item.runtimeMin} min` : null,
      item.kind === "series" ? "Series" : "Movie",
      item.rating != null ? `★ ${item.rating.toFixed(1)}` : null,
    ]
      .filter(Boolean)
      .join("  ·  ") || formatMeta(item)
  );
}
