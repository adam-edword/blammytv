// Headless verify: THE TAB SWAP ANIMATION.
//
// Three of these checks exist because of scars, not symmetry.
//
// "nothing dims during the settle window" guards a deletion. This started
// out dimming the outgoing screen too, which looked free and was not:
// starting an opacity animation promotes .app-main to its own compositor
// layer, and promoting a screenful of guide grid is a texture upload.
// Measured over three runs it took the worst frame gap INSIDE the 190ms
// window the capsule needs from 17ms to 26-29ms. If a leave animation ever
// comes back, this is the check that should stop it.
//
// "clip hole cut" guards the inverted player. It carves a hole through
// .app-shell and parks the native video behind it, and an opacity layer
// over that region is the shape of this project's worst rendering bugs --
// and the one thing here that cannot be checked from a Linux box. So the
// animation stands down entirely whenever a hole is cut.
//
// "compositor-only properties" is the whole point of using WAAPI here:
// opacity and transform survive a busy main thread, which is exactly the
// condition this animation exists to sit through.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-tab-swap.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM);
const { chromium } = req("playwright-core");
const PLAYLIST = { v:1, data:[{ kind:"m3u", id:"m1", name:"Test M3U", enabled:true, url:"http://localhost:8082/playlist.m3u" }] };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fail = 0;
const check = (n, ok, d = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` ${d}` : ""}`); };
const boot = async (reduced) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 },
    reducedMotion: reduced ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  await p.addInitScript((pl) => {
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
    sessionStorage.setItem("btv:welcome-played", "1");
  }, PLAYLIST);
  await p.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".navcap", { timeout: 20000 });
  await p.waitForTimeout(2500);
  return { p, ctx };
};
const sample = async (p, dest) => {
  await p.evaluate(() => {
    window.__o = []; const t0 = performance.now();
    const tick = () => {
      const m = document.querySelector(".app-main");
      window.__o.push([Math.round(performance.now() - t0), +getComputedStyle(m).opacity]);
      if (performance.now() - t0 < 620) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await p.locator(`[data-dest="${dest}"]`).click();
  await p.waitForTimeout(1400);
  return p.evaluate(() => window.__o);
};

{
  const { p, ctx } = await boot(false);
  const s = await sample(p, "sports");
  const lo = Math.min(...s.map((x) => x[1]));
  check("the incoming screen fades UP from 0", lo < 0.2, `min opacity ${lo.toFixed(2)}`);
  // Nothing may fade before the swap: the leave dim was cut because
  // promoting a screenful of grid cost frames inside the settle window.
  const early = s.filter((x) => x[0] < 170 && x[1] < 0.99).length;
  check("nothing dims during the settle window", early === 0, `${early} early frames`);
  const rest = await p.evaluate(() => getComputedStyle(document.querySelector(".app-main")).opacity);
  check("and lands back on exactly 1", rest === "1", `opacity ${rest}`);
  // A frame COUNT depends on how many the page managed to schedule, which
  // is not what this is trying to assert. The claim is "not a blink": a
  // 180ms fade should be visible across several frames, and one or two is
  // a snap. 5 sits well clear of both.
  const mid = s.filter((x) => x[1] < 0.99).length;
  check("over many frames, not a blink", mid >= 5, `${mid} frames under full opacity`);

  // Every property in flight must be one the compositor can own alone.
  const props = await p.evaluate(async () => {
    const m = document.querySelector(".app-main");
    document.querySelector('[data-dest="discover"]').click();
    // The entrance only starts after the settle window, so sample INSIDE
    // it -- an empty list here would prove nothing at all.
    await new Promise((r) => setTimeout(r, 250));
    const running = m.getAnimations();
    return { n: running.length, keys: [...new Set(running.flatMap((a) =>
      a.effect.getKeyframes().flatMap((k) => Object.keys(k)))
      .filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k)))] };
  });
  check("the entrance is actually running when sampled", props.n > 0, `${props.n} animations`);
  check("compositor-only properties",
    props.keys.length > 0 && props.keys.every((k) => k === "opacity" || k === "transform"),
    JSON.stringify(props.keys));
  await p.waitForTimeout(1200);
  await ctx.close();
}
{
  // A cut clip hole means the inverted player has the native video parked
  // behind .app-shell. No opacity layer goes over that.
  const { p, ctx } = await boot(false);
  await p.evaluate(() => {
    document.querySelector(".app-shell").style.clipPath =
      "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
  });
  await p.locator('[data-dest="sports"]').click();
  await p.waitForTimeout(70);
  const n = await p.evaluate(() => document.querySelector(".app-main").getAnimations().length);
  const op = await p.evaluate(() => getComputedStyle(document.querySelector(".app-main")).opacity);
  check("clip hole cut: no animation, no dim", n === 0 && op === "1", `anims ${n}, opacity ${op}`);
  await p.waitForTimeout(1400);
  const op2 = await p.evaluate(() => getComputedStyle(document.querySelector(".app-main")).opacity);
  check("clip hole cut: screen still fully opaque after the swap", op2 === "1", `opacity ${op2}`);
  await ctx.close();
}
{
  const { p, ctx } = await boot(true);
  await p.locator('[data-dest="sports"]').click();
  await p.waitForTimeout(70);
  const n = await p.evaluate(() => document.querySelector(".app-main").getAnimations().length);
  check("reduced motion: no animation", n === 0, `anims ${n}`);
  await p.waitForTimeout(1200);
  const op = await p.evaluate(() => getComputedStyle(document.querySelector(".app-main")).opacity);
  check("reduced motion: fully opaque", op === "1", `opacity ${op}`);
  await ctx.close();
}
await b.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
