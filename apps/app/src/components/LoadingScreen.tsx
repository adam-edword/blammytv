import { useEffect, useRef } from "react";
import { slotText, chromatic } from "slot-text";
import "slot-text/style.css";
import { isTv } from "../lib/tv";

const WORD = "BlammyTV";

/**
 * The EPG 4K quality-badge gradient stops (peach → gold → green → blue →
 * violet). Reusing this palette ties the splash to the same accent the guide
 * uses to mark the best feeds, so the brand colour reads as intentional.
 */
const BADGE_STOPS = [
  [0xff, 0x9e, 0x7d],
  [0xff, 0xd4, 0x79],
  [0x7e, 0xe7, 0x87],
  [0x6b, 0xb6, 0xff],
  [0xc0, 0x8c, 0xff],
] as const;

/** Sample the 4K badge gradient at position t (0..1) → an `rgb()` string. */
const colorAt = (i: number) => {
  const t = i / Math.max(1, WORD.length - 1);
  const span = BADGE_STOPS.length - 1;
  const seg = Math.min(span - 1, Math.floor(t * span));
  const f = t * span - seg;
  const [r0, g0, b0] = BADGE_STOPS[seg];
  const [r1, g1, b1] = BADGE_STOPS[seg + 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(r0, r1)} ${mix(g0, g1)} ${mix(b0, b1)})`;
};

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
                color: colorAt(i),
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
