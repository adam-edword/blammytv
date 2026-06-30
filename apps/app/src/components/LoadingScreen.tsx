import { useEffect, useRef } from "react";
import { slotText, chromatic } from "slot-text";
import "slot-text/style.css";
import { isTv } from "../lib/tv";

const WORD = "BlammyTV";

/**
 * Full-screen branded splash shown while the app boots / pulls config.
 *
 * Desktop: the word rolls in with slot-text's chromatic slot-machine animation.
 * Android: slot-text ghosts on that WebView (its glyph clipping + GPU layers
 * misbehave), so the word is a single gradient-filled glyph run that shimmers.
 * The gradient reuses the EPG 4K quality-badge palette (peach → gold → green →
 * blue → violet) so the brand colour reads as intentional, and because nothing
 * is created/destroyed and no glyphs are transformed, it can't strand letters.
 */
export function LoadingScreen() {
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isTv) return; // Android renders the CSS gradient word below instead.
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
        <span className="loading-screen__word loading-badge">
          <span className="loading-gradient">{WORD}</span>
        </span>
      ) : (
        <span ref={wordRef} className="loading-screen__word" />
      )}
      <p className="loading-screen__sub">Tuning in…</p>
    </div>
  );
}
