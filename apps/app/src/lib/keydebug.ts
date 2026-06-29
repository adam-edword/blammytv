// TEMP diagnostic: log raw keydown/keyup events (key, repeat flag, time gap) in
// a fixed overlay so we can see exactly what a held OK/center button emits on
// the emulator. Remove once hold-to-clear detection is settled.
const ON = true;

if (ON && typeof window !== "undefined") {
  const el = document.createElement("pre");
  el.style.cssText =
    "position:fixed;left:8px;top:8px;z-index:99999;margin:0;padding:8px 10px;" +
    "background:rgba(0,0,0,0.85);color:#0ff;font:11px/1.4 monospace;" +
    "white-space:pre;pointer-events:none;border-radius:6px;max-width:70vw";
  const attach = () => {
    if (document.body) document.body.appendChild(el);
    else requestAnimationFrame(attach);
  };
  attach();

  const lines: string[] = [];
  let last = 0;
  const log = (type: string, e: KeyboardEvent) => {
    const now = performance.now();
    const dt = last ? Math.round(now - last) : 0;
    last = now;
    lines.push(`${type} key=${e.key} repeat=${e.repeat} +${dt}ms`);
    while (lines.length > 9) lines.shift();
    el.textContent = lines.join("\n");
  };
  window.addEventListener("keydown", (e) => log("DOWN", e), true);
  window.addEventListener("keyup", (e) => log("UP  ", e), true);
}
