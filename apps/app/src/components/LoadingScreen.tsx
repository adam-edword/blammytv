import { useEffect, useRef } from "react";
import { slotText, chromatic } from "slot-text";
import "slot-text/style.css";
import { isTv } from "../lib/tv";

const WORD = "BlammyTV";

/** Per-letter chromatic hue (matches slot-text's chromatic sweep). */
const hueAt = (i: number) =>
  Math.round((i / Math.max(1, WORD.length - 1)) * 320);

/**
 * Full-screen branded splash shown while the app boots / pulls config.
 *
 * Desktop: the word rolls in with slot-text's chromatic slot-machine animation.
 * Android: slot-text ghosts on that WebView (its glyph clipping + GPU layers
 * misbehave), so use a CSS-only wave — the same 8 chromatic letters bob in
 * sequence forever. Nothing is created/destroyed, so it can't strand glyphs.
 */
export function LoadingScreen() {
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isTv) return; // Android renders the CSS wave below instead.
    const el = wordRef.current;
    if (!el) return;

    const roll = {
      stagger: 105,
      duration: 460,
      bounce: 0.2,
      color: chromatic({ from: 0 }),
      skipUnchanged: false,
    };

    // Start blank so the very first roll spells out BlammyTV (never "Shipping").
    const label = slotText(el, "");
    let loop = 0;
    const first = window.setTimeout(() => {
      label.set("BlammyTV", roll);
      loop = window.setInterval(() => label.set("BlammyTV", roll), 1600);
    }, 120);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
      label.destroy();
    };
  }, []);

  return (
    <div className="loading-screen">
      {isTv ? (
        <span className="loading-screen__word loading-wave" aria-label={WORD}>
          {WORD.split("").map((ch, i) => (
            <span
              key={i}
              className="loading-wave__letter"
              style={{
                color: `hsl(${hueAt(i)} 92% 62%)`,
                animationDelay: `${i * 95}ms`,
              }}
            >
              {ch}
            </span>
          ))}
        </span>
      ) : (
        <span ref={wordRef} className="loading-screen__word" />
      )}
      <p className="loading-screen__sub">Tuning in…</p>
    </div>
  );
}
