import { useEffect, useRef } from "react";
import { slotText, chromatic } from "slot-text";
import "slot-text/style.css";

/**
 * Full-screen branded splash shown while the app boots / pulls config. The
 * word rolls from "Shipping" to "BlammyTV" with a chromatic sweep (slot-text),
 * then keeps re-rolling "BlammyTV" on a loop until loading finishes (the whole
 * splash unmounts). Sits on the same near-black as the Electron window so
 * there's no flash of background underneath.
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
      color: chromatic({ from: 315 }),
      skipUnchanged: false,
    };

    const label = slotText(el, "Shipping");
    let loop = 0;
    // Roll Shipping → BlammyTV, then keep re-rolling BlammyTV forever.
    const first = window.setTimeout(() => {
      label.set("BlammyTV", roll);
      loop = window.setInterval(() => label.set("BlammyTV", roll), 1600);
    }, 460);

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
