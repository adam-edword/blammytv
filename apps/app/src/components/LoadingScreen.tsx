import { useEffect, useRef } from "react";
import { slotText, chromatic } from "slot-text";
import "slot-text/style.css";

/**
 * Full-screen branded splash shown while the app boots / pulls config. The
 * word rolls in as "BlammyTV" with a chromatic sweep (slot-text) and keeps
 * re-rolling on a loop until loading finishes (the whole splash unmounts).
 * Sits on the same near-black as the Electron window so there's no flash of
 * background underneath.
 */
export function LoadingScreen() {
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
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
    // Re-roll only after a roll has fully finished + cleaned up (~1.7s) plus a
    // beat. A shorter interval interrupts the in-flight roll every cycle, which
    // the Android WebView renders as stranded "ghost" glyphs (Windows tolerates
    // the interrupt; Android doesn't).
    const first = window.setTimeout(() => {
      label.set("BlammyTV", roll);
      loop = window.setInterval(() => label.set("BlammyTV", roll), 2800);
    }, 120);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
      label.destroy();
    };
  }, []);

  return (
    <div className="loading-screen">
      <span ref={wordRef} className="loading-screen__word" />
      <p className="loading-screen__sub">Tuning in…</p>
    </div>
  );
}
