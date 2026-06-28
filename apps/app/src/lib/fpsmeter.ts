// TEMP perf overlay (remove once row-nav perf is dialed in): a tiny FPS + long-
// frame counter so we can measure jank objectively while tuning, instead of
// guessing from "feels choppy". A "long" frame is one over ~32ms (a missed
// 30fps budget). Hold ◀/▶ on a row and read the numbers off a screenshot.
const ON = true;

if (ON && typeof requestAnimationFrame === "function") {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:99999;padding:6px 9px;" +
    "background:rgba(0,0,0,0.8);color:#0f0;font:12px/1.3 monospace;" +
    "border-radius:6px;pointer-events:none";
  const attach = () => {
    if (document.body) document.body.appendChild(el);
    else requestAnimationFrame(attach);
  };
  attach();

  let frames = 0;
  let long = 0;
  let worst = 0;
  let last = performance.now();
  let windowStart = last;
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    frames++;
    if (dt > 32) long++;
    if (dt > worst) worst = dt;
    if (now - windowStart >= 1000) {
      el.textContent = `${frames} fps · ${long} long · worst ${worst.toFixed(0)}ms`;
      frames = 0;
      long = 0;
      worst = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
