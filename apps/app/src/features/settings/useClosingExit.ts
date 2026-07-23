import { useEffect, useRef, useState } from "react";

/** The modal exit beat: closes are user-initiated but still SYSTEM
 * responses, so the exit is quick (150ms fade + slight scale-down in
 * CSS via .settings--closing) — the card stays mounted just long enough
 * to play it, then the real onClose unmounts. Idempotent while closing;
 * the timer dies with the component. */
export function useClosingExit(onClose: () => void, ms = 160) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(0);
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(() => cb.current(), ms);
  };
  return { closing, requestClose };
}
