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
  // Offline, as the dev container always is: the Sports tab this swaps to
  // loads ESPN's live API and ~90 logos from it, and on CI that load lands
  // in the middle of the fade being timed.
  await ctx.route(/\.espn(cdn)?\.com\//, (r) => r.abort());
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
  //
  // And it failed on CI's slower runner exactly that way: 4 frames, over a
  // fade that had run its full length. So the assertion is the TIME the
  // screen spends below full opacity, first dimmed frame to last. A snap is
  // one or two frames, 0 to ~17ms; the 180ms fade spans well past 90ms
  // however few frames the machine managed to paint inside it.
  const under = s.filter((x) => x[1] < 0.99);
  const span = under.length ? under[under.length - 1][0] - under[0][0] : 0;
  check(
    "a visible fade, not a blink",
    span >= 90,
    `${span}ms below full opacity over ${under.length} frames`,
  );

  // Every property in flight must be one the compositor can own alone.
  //
  // WHEN to look is the hard part. The entrance starts after the settle
  // window AND the transition's render, and the render is what moves under
  // load. This used to take one sample at 250ms and failed 2 of 4 runs at
  // v0.10.28 with "0 animations": the entrance had not started yet. Logged
  // every frame, it starts 213-220ms after the click unthrottled, 345-391ms
  // at 4x CPU throttling and 590-720ms at 6x, and it was there every time.
  // So watch every frame from the click and read the first entrance that
  // appears. An empty list still proves nothing, so no entrance by the
  // deadline is a failure, not a pass.
  const props = await p.evaluate(() => new Promise((resolve) => {
    const m = document.querySelector(".app-main");
    // Anything already running is not this click's entrance.
    const before = new Set(m.getAnimations());
    const t0 = performance.now();
    document.querySelector('[data-dest="discover"]').click();
    const tick = () => {
      const t = Math.round(performance.now() - t0);
      const running = m.getAnimations().filter((a) => !before.has(a));
      if (!running.length && t < 1500) return requestAnimationFrame(tick);
      resolve({ n: running.length, t, keys: [...new Set(running.flatMap((a) =>
        a.effect.getKeyframes().flatMap((k) => Object.keys(k)))
        .filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k)))] });
    };
    requestAnimationFrame(tick);
  }));
  check("the entrance runs after the click", props.n > 0,
    props.n ? `${props.n} animations, first seen ${props.t}ms after the click` : `none by ${props.t}ms`);
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
