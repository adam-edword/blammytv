import { useEffect, useRef } from "react";
import { slotText, chromatic } from "slot-text";
import "slot-text/style.css";

/**
 * Full-screen branded splash shown while the app boots / pulls config. The
 * word rolls from "Shipping" to "BlammyTV" with a chromatic sweep (slot-text),
 * then rests. Sits on the same near-black as the Electron window so there's no
 * flash of background underneath.
 */
export function LoadingScreen() {
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = wordRef.current;
    if (!el) return;

    const label = slotText(el, "Shipping");
    const t = window.setTimeout(() => {
      label.set("BlammyTV", {
        stagger: 105,
        duration: 460,
        bounce: 0.2,
        color: chromatic({ from: 315 }),
        skipUnchanged: false,
      });
    }, 460);

    return () => {
      window.clearTimeout(t);
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
