// E2E: the Guide's pinned cells fade the right titles, and a row step
// costs one layout pass, not three (week of 2026-09-28, the Live auditor's
// "61 layouts a step", plan 016 5.6).
//
// Each lane pins its airing cell at the left edge and shrinks it as the
// scroll eats it. A pinned title fades when its text is wider than the
// pin's room (the cell less its 28px of padding); every other title fades
// when it overflows its own box. syncPins used to read each title right
// after writing its cell, a forced layout per lane, and the layout effect
// after every render did it three times over. It now writes every lane,
// reads once, and writes the fades.
//
// Against the fake panel's "pins" line: forty channels, programme lengths
// staggered so lanes hand off at different scrolls, titles from "News" to
// far wider than any cell.
//
//   node scripts/fake-panel.mjs     # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-guide-pins.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [{ kind: "xtream", id: "p", name: "Pins", enabled: true, server: "http://localhost:8081", username: "pins", password: "p" }],
    }),
  );
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.locator(".guide__cell-title").first().waitFor({ timeout: 30_000 });
await page.evaluate(() => document.fonts.ready);

/** Every title's fade against what it should be. A pinned title's text
 * width comes from a Range (the text itself, not its box); within a pixel
 * of the room is too close to call and is left out. */
const audit = () =>
  page.evaluate(() => {
    const out = { pinned: 0, pinFaded: 0, pinClear: 0, free: 0, freeFaded: 0, freeClear: 0, wrong: [] };
    for (const t of document.querySelectorAll(".guide__cell-title, .guide__card-name")) {
      const faded = t.classList.contains("is-clipped");
      const cell = t.closest(".guide__cell");
      if (cell?.classList.contains("guide__cell--pinned")) {
        const r = document.createRange();
        r.selectNodeContents(t);
        const text = r.getBoundingClientRect().width;
        const room = parseFloat(cell.style.width) - 28;
        if (Math.abs(text - room) <= 1) continue;
        out.pinned++;
        faded ? out.pinFaded++ : out.pinClear++;
        if (faded !== text > room)
          out.wrong.push(`pinned "${t.textContent}" ${faded ? "faded" : "clear"}, text ${text.toFixed(1)} room ${room.toFixed(1)}`);
      } else {
        if (t.clientWidth === 0) continue;
        out.free++;
        const over = t.scrollWidth > t.clientWidth + 1;
        over ? out.freeFaded++ : out.freeClear++;
        if (faded !== over)
          out.wrong.push(`"${t.textContent}" ${faded ? "faded" : "clear"}, ${t.scrollWidth} in ${t.clientWidth}`);
      }
    }
    return out;
  });
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const scrollTo = async (x, y) => {
  await page.evaluate(
    ([x, y]) => {
      const g = document.querySelector(".guide");
      if (x != null) g.scrollLeft = x;
      if (y != null) g.scrollTop = y;
    },
    [x, y],
  );
  await settle();
  await page.waitForTimeout(60);
};

// Across: scroll right through the handoffs and back, so cells pin, shrink,
// hand off and come back unpinned.
const sum = { pinned: 0, pinFaded: 0, pinClear: 0, free: 0, freeFaded: 0, freeClear: 0, wrong: [] };
const add = (a) => {
  for (const k of Object.keys(sum)) sum[k] = k === "wrong" ? sum.wrong.concat(a.wrong) : sum[k] + a[k];
};
for (const x of [0, 120, 260, 410, 555, 700, 860, 1010, 1180, 900, 640, 330, 90]) {
  await scrollTo(x, null);
  add(await audit());
}
check(
  "scrolling across pins cells on every lane, faded and clear",
  sum.pinFaded > 20 && sum.pinClear > 20,
  `${sum.pinFaded} faded, ${sum.pinClear} clear`,
);
check(
  "a pinned title fades exactly when its text is wider than the pin",
  sum.wrong.filter((w) => w.startsWith("pinned")).length === 0,
  sum.wrong.find((w) => w.startsWith("pinned")) ?? `${sum.pinned} pinned titles`,
);
check(
  "every other title fades exactly when it overflows its cell",
  sum.freeFaded > 20 && sum.freeClear > 20 && sum.wrong.every((w) => w.startsWith("pinned")),
  sum.wrong.find((w) => !w.startsWith("pinned")) ?? `${sum.freeFaded} faded, ${sum.freeClear} clear`,
);

// Down: a three-row step moves the row window, which renders the Guide and
// re-pins every lane from scratch. Counted with Chrome's own layout
// counter, per lane on screen: the lanes are separate layout roots, so one
// forced pass counts about one per lane.
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
const layouts = async () =>
  (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "LayoutCount").value;
await scrollTo(640, 0);
const steps = [];
const down = { pinned: 0, pinFaded: 0, pinClear: 0, free: 0, freeFaded: 0, freeClear: 0, wrong: [] };
for (let i = 1; i <= 6; i++) {
  const before = await layouts();
  await scrollTo(null, i * 68 * 3);
  await page.waitForTimeout(150);
  const lanes = await page.evaluate(() => document.querySelectorAll(".guide__cell--pinned").length);
  steps.push({ layouts: (await layouts()) - before, lanes });
  const a = await audit();
  for (const k of Object.keys(down)) down[k] = k === "wrong" ? down.wrong.concat(a.wrong) : down[k] + a[k];
}
check(
  "after a row step every fade is still right",
  down.wrong.length === 0 && down.pinned > 20,
  down.wrong[0] ?? `${down.pinned} pinned, ${down.free} others`,
);
const worst = steps.reduce((m, s) => Math.max(m, s.layouts / s.lanes), 0);
check(
  "a row step costs one layout pass, not one per lane per read",
  steps.every((s) => s.lanes >= 10) && worst < 2,
  steps.map((s) => `${s.layouts}/${s.lanes}`).join(" "),
);

await browser.close();
process.exit(fail ? 1 : 0);
