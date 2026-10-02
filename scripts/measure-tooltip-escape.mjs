// Why did one Escape sometimes leave Settings up after a Tab walk? (v0.10.43)
//
// Opens Settings on Customize (where the hinted controls are: the accent
// swatches, the row size), presses Tab 40 times, then Escape at once, and
// says whether Settings shut. Just before the Escape it lists every tooltip
// still in the DOM: its words, data-state, opacity and the animation on it.
// A mounted Radix TooltipContent is a DismissableLayer, and only the newest
// layer listens for Escape, open or not.
//
// DUMP=1 also prints the last 250ms before each Escape: tooltips mounting,
// closing and unmounting, their animation events, the keys, and Radix's
// Escape listeners coming and going (esc+ / esc-, numbered per listener;
// the dialog's is the one that comes back after each tooltip goes).
//
// Offline, as the harnesses are: every host but localhost is aborted.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173, or APP_URL=<url>)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/measure-tooltip-escape.mjs
//   RUNS=8 SETTLE_MS=1000 DUMP=1 ...   # runs, a pause before the Escape
//
// Measured 2026-09-27, headless Edge on Windows, vite dev:
//
// BEFORE (tooltips faded and zoomed out over 150ms): 10 of 10 Escapes lost.
//   At the Escape, one to six of the tooltips the walk passed were still
//   mounted, data-state closed, mid-exit ("exit running 42ms", opacity
//   0.53, the row size's; swatches at 138ms, opacity 0.004), and the newest
//   took the Escape. Not stuck: with SETTLE_MS=1000 all had unmounted and
//   the Escape closed Settings, 3 of 3.
// AFTER (closed is `animate-none`): each tooltip unmounts in the same
//   millisecond it closes and none is mounted at the Escape. 36 of 40
//   closed Settings. The 4 misses were each a fresh browser's first run,
//   with nothing mounted and nothing preventing the Escape: Radix re-arms
//   the dialog's listener from a React effect once a layer above it goes,
//   and here that effect came 41ms late, after the Escape, behind eight
//   Tabs 4ms apart. No one types that fast; verify-kit's check leaves 80ms
//   before its Escape for it.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const RUNS = Number(process.env.RUNS ?? 3);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 0);
const TABS = 40;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** The app as the harnesses see it, plus a log of every tooltip content
 * and every Escape listener Radix adds or drops. */
const instrument = () => {
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: (cmd, args) => (cmd === "http_get" ? fetch(args.url).then((r) => r.arrayBuffer()) : Promise.resolve(undefined)),
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.settingsTab", JSON.stringify({ v: 1, data: "customize" }));
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({ v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] }),
  );

  const log = (window.__tt = []);
  const at = () => Math.round(performance.now());

  // Radix's layers hear Escape on the document, capture phase, and only
  // the highest layer has a listener at all.
  const fns = new WeakMap();
  let fnNext = 0;
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  const capture = (o) => o === true || o?.capture === true;
  document.addEventListener = (type, fn, o) => {
    if (type === "keydown" && capture(o) && fn) {
      if (!fns.has(fn)) fns.set(fn, ++fnNext);
      log.push({ t: at(), ev: "esc+", what: `listener ${fns.get(fn)}` });
    }
    return add(type, fn, o);
  };
  document.removeEventListener = (type, fn, o) => {
    if (type === "keydown" && capture(o) && fns.has(fn)) log.push({ t: at(), ev: "esc-", what: `listener ${fns.get(fn)}` });
    return remove(type, fn, o);
  };
  // Keys as they arrive, and whether anything had prevented an Escape by
  // the time it bubbled back to the window.
  window.addEventListener("keydown", (e) => log.push({ t: at(), ev: "key", what: e.key }), true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") log.push({ t: at(), ev: "handled", what: String(e.defaultPrevented) });
  });

  const SEL = "[data-slot=tooltip-content]";
  const ids = new WeakMap();
  let next = 0;
  const tag = (el) => {
    if (!ids.has(el)) ids.set(el, ++next);
    return `#${ids.get(el)}`;
  };
  for (const type of ["animationstart", "animationend", "animationcancel"])
    document.addEventListener(
      type,
      (e) => {
        if (e.target instanceof Element && e.target.matches(SEL)) log.push({ t: at(), ev: type.slice(9), what: `${tag(e.target)} ${e.animationName}` });
      },
      true,
    );
  const each = (n, f) => {
    if (n.nodeType === 1) for (const el of [n, ...n.querySelectorAll(SEL)]) if (el.matches(SEL)) f(el);
  };
  // On the document, not <html>: an init script runs before there is one.
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "attributes") {
        if (m.target.matches?.(SEL)) log.push({ t: at(), ev: "state", what: `${tag(m.target)} ${m.target.dataset.state}` });
        continue;
      }
      for (const n of m.addedNodes) each(n, (el) => log.push({ t: at(), ev: "mount", what: `${tag(el)} ${el.dataset.state} "${el.textContent}"` }));
      for (const n of m.removedNodes) each(n, (el) => log.push({ t: at(), ev: "unmount", what: tag(el) }));
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
};

const gear = ".header__action[aria-label='Settings']";
let lost = 0;
for (let run = 1; run <= RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  await page.addInitScript(instrument);
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-dest="guide"]', { timeout: 60_000 });
  await goTo(page, "guide");
  await page.waitForTimeout(800);
  await page.locator(gear).click();
  await page.locator(".settings").waitFor();
  await page.waitForTimeout(700);
  // verify-kit's cadence: a key, then a read.
  for (let i = 0; i < TABS; i++) {
    await page.keyboard.press("Tab");
    await page.evaluate(() => document.activeElement?.tagName);
  }
  if (SETTLE_MS) await page.waitForTimeout(SETTLE_MS);
  const left = await page.evaluate(() =>
    [...document.querySelectorAll("[data-slot=tooltip-content]")].map((el) => ({
      words: el.textContent,
      state: el.dataset.state,
      opacity: getComputedStyle(el).opacity,
      animations: el.getAnimations().map((a) => `${a.animationName} ${a.playState} ${Math.round(a.currentTime ?? -1)}ms`),
    })),
  );
  const focus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 40));
  await page.keyboard.press("Escape");
  const shut = await page.locator(".settings").waitFor({ state: "detached", timeout: 2000 }).then(() => true, () => false);
  if (!shut) lost++;
  const log = await page.evaluate(() => window.__tt);
  const opened = log.filter((e) => e.ev === "mount").length;
  const handled = log.findLast((e) => e.ev === "handled")?.what;
  console.log(`\nrun ${run}: ${opened} tooltips opened on the walk, ${left.length} still mounted at the Escape; focus on ${JSON.stringify(focus)}`);
  for (const l of left) console.log(`  ${JSON.stringify(l)}`);
  console.log(`  Escape ${shut ? "closed Settings" : "LEFT SETTINGS UP"} (prevented by a layer: ${handled})`);
  if (process.env.DUMP) {
    const esc = log.findLast((e) => e.ev === "key" && e.what === "Escape")?.t ?? 0;
    for (const e of log.filter((e) => e.t >= esc - 250 && e.t <= esc + 5)) console.log(`  ${String(e.t - esc).padStart(5)}ms  ${e.ev.padEnd(8)} ${e.what}`);
  }
  await ctx.close();
}
console.log(`\n${lost} of ${RUNS} Escapes lost`);
await browser.close();
