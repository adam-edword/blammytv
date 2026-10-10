// E2E: the Guide scrolls 24 hours ahead, with Earlier, Now and Later in the
// ruler's corner (v0.11.24, Adam's call, 2026-10-10).
//
// The Guide showed a fixed 4 hours from the last half hour while memory held
// 44 hours of schedule. It now runs 24, and the ruler's corner (the empty,
// sticky space over the channel column) has three buttons:
// - Earlier and Later scroll by the visible lane width; Earlier is disabled
//   at the start and Later at the end;
// - Now goes back to the start, where the now-line is, and is disabled there;
// - the tick at local midnight names the day ("Sun 12:00 AM", "Sun 00:00");
// - when the window rolls on every half hour, a viewer who has scrolled
//   ahead keeps the programme they were looking at (the cells all move 285px
//   left under them, so scrollLeft moves with them); at the start it is left
//   alone;
// - scrubbing sideways renders nothing: the buttons' disabled state is
//   written to the DOM from the scroll handler, not through React.
//
// Against the fake panel's default line: Fake ESPN 4K runs hourly programmes
// from -1h to +26h, which is what puts one 10 hours out.
//
//   node scripts/fake-panel.mjs     # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-guide-window.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

/** epg.ts: PX_PER_MIN and GUIDE_HOURS. */
const PX_PER_MIN = 9.5;
const GUIDE_HOURS = 24;
const WEEKDAY = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) /;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// Reduced motion makes a click's scroll instant, so a position can be read
// the moment it settles. The smooth path is the same call with another
// `behavior`.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.clock.install();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }],
    }),
  );
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
  // React commits, through a devtools hook installed before React loads
  // (verify-overlay-renders does the same).
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onCommitFiberRoot() {
      window.__commits++;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    isDisabled: false,
  };
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.locator('.guide__cell[data-hint^="ESPN Hour"]').first().waitFor({ timeout: 30_000 });
await page.evaluate(() => document.fonts.ready);

const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const scrollTo = async (x) => {
  await page.evaluate((x) => {
    document.querySelector(".guide").scrollLeft = x;
  }, x);
  await settle();
  await page.waitForTimeout(80);
};
const btn = (name) => page.locator(`.guide__corner button[aria-label="${name}"]`);
const press = async (name) => {
  await btn(name).click();
  await settle();
  await page.waitForTimeout(80);
};
/** The three buttons' disabled state and where the guide is scrolled to. */
const jump = () =>
  page.evaluate(() => {
    const b = (n) => document.querySelector(`.guide__corner button[aria-label="${n}"]`);
    return {
      earlier: b("Earlier")?.disabled,
      now: b("Back to now")?.disabled,
      later: b("Later")?.disabled,
      x: document.querySelector(".guide").scrollLeft,
    };
  });
const geometry = () =>
  page.evaluate(() => {
    const g = document.querySelector(".guide");
    const wrap = document.querySelector(".guide-wrap");
    const cardW = parseFloat(getComputedStyle(wrap).getPropertyValue("--guide-card-w"));
    return {
      laneX: cardW + 8,
      view: g.clientWidth,
      canvas: parseFloat(document.querySelector(".guide__canvas").style.width),
      scrollW: g.scrollWidth,
    };
  });
/** One programme on the first row (Fake ESPN 4K), by its title. */
const programme = (title) =>
  page.evaluate((title) => {
    const row = document.querySelector(".guide__row");
    const lane = row.querySelector(".guide__lane");
    const el = [...row.querySelectorAll(".guide__cell[data-key]")].find((c) => c.dataset.hint === title);
    if (!el) return null;
    return {
      key: el.dataset.key,
      left: Number(el.dataset.left),
      width: Number(el.dataset.width),
      // Where it really is: its rect in the page, and in its lane.
      screenX: el.getBoundingClientRect().left,
      inLane: el.getBoundingClientRect().left - lane.getBoundingClientRect().left,
      pinned: el.classList.contains("guide__cell--pinned"),
    };
  }, title);

// ---- the lane is 24 hours wide, and a programme 10+ hours out is in it ----
const geo = await geometry();
check(
  "the lane spans 24 hours",
  Math.abs(geo.canvas - (geo.laneX + GUIDE_HOURS * 60 * PX_PER_MIN)) < 0.5,
  `canvas ${geo.canvas}px, expected ${geo.laneX + GUIDE_HOURS * 60 * PX_PER_MIN}px`,
);
// "ESPN Hour 2" starts at the window's own start (the panel floors to the
// half hour, as the Guide does), so a cell N hours later sits N * 60
// minutes further along, whatever the clock says.
const ref = await programme("ESPN Hour 2");
const far = await programme("ESPN Hour 14");
const farWant = ref ? ref.left + 12 * 60 * PX_PER_MIN : NaN;
check(
  "a programme 12 hours ahead is in the DOM at the right left",
  !!far && far.left >= 10 * 60 * PX_PER_MIN && Math.abs(far.left - farWant) < 1.5 && Math.abs(far.inLane - far.left) < 1.5,
  far ? `left ${far.left}, expected ${farWant}, in its lane ${far.inLane}` : "ESPN Hour 14 is not in the DOM",
);

// ---- at rest, the buttons say where you are ----
const rest = await jump();
check(
  "at rest: Now and Earlier are disabled, Later is not",
  rest.now === true && rest.earlier === true && rest.later === false,
  JSON.stringify(rest),
);

// ---- Later and Earlier move by the visible lane width ----
const step = geo.view - geo.laneX;
await press("Later");
const afterLater = await jump();
check(
  "Later scrolls by the visible lane width",
  Math.abs(afterLater.x - step) <= 2,
  `scrollLeft ${afterLater.x}, expected ${step} (${geo.view}px view less ${geo.laneX}px of channels)`,
);
check(
  "  and now Now and Earlier are enabled",
  afterLater.now === false && afterLater.earlier === false,
  JSON.stringify(afterLater),
);
await press("Earlier");
const afterEarlier = await jump();
check(
  "Earlier scrolls back the same distance, to the start",
  Math.abs(afterEarlier.x) <= 2 && afterEarlier.earlier === true && afterEarlier.now === true,
  JSON.stringify(afterEarlier),
);
await press("Later");
await press("Later");
await press("Back to now");
const afterNow = await jump();
check(
  "Now returns to the start from anywhere, and then disables itself",
  Math.abs(afterNow.x) <= 2 && afterNow.now === true,
  JSON.stringify(afterNow),
);

// ---- the far end ----
let presses = 0;
for (; presses < 30; presses++) {
  if ((await jump()).later) break;
  await press("Later");
}
const end = await jump();
const geoEnd = await geometry();
check(
  "at the far end Later is disabled, and it is the end of the 24 hours",
  end.later === true && end.earlier === false && Math.abs(end.x - (geoEnd.scrollW - geoEnd.view)) <= 2 && presses > 5,
  `${JSON.stringify(end)} after ${presses} presses, scrollWidth ${geoEnd.scrollW}, view ${geoEnd.view}`,
);
await press("Back to now");

// ---- the midnight tick names the day ----
const ticks = await page.evaluate(() =>
  [...document.querySelectorAll(".guide__tick")].map((t) => ({ text: t.textContent, left: parseFloat(t.style.left) })),
);
const named = ticks.filter((t) => WEEKDAY.test(t.text));
// Which instant that tick is: the window starts where "ESPN Hour 2" does.
const refStart = ref ? Number(ref.key.split(":")[0]) : NaN;
const winStart = refStart - (ref ? ref.left / PX_PER_MIN : 0) * 60_000;
const at = named[0] ? new Date(winStart + ((named[0].left - geo.laneX) / PX_PER_MIN) * 60_000) : null;
check(
  "the tick at midnight carries the weekday, and no other does",
  ticks.length === GUIDE_HOURS * 2 &&
    named.length === 1 &&
    !!at &&
    at.getHours() === 0 &&
    at.getMinutes() === 0 &&
    named[0].text === `${at.toLocaleDateString("en-US", { weekday: "short" })} 12:00 AM`,
  `${ticks.length} ticks, named: ${JSON.stringify(named)}, that instant is ${at?.toString()}`,
);
// The 24-hour clock: "Sun 00:00".
await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:clock-format", { detail: "24h" })));
await settle();
await page.waitForTimeout(100);
const named24 = await page.evaluate(() =>
  [...document.querySelectorAll(".guide__tick")].map((t) => t.textContent).filter((t) => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) /.test(t)),
);
check(
  "  and in the 24 hour clock it reads Sun 00:00",
  named24.length === 1 && /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) 00:00$/.test(named24[0]),
  JSON.stringify(named24),
);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:clock-format", { detail: "12h" })));
await settle();

// ---- scrubbing sideways renders nothing ----
// The control first: a render the harness causes itself does count, so a
// hook that counted nothing could not pass for "renders nothing".
const c0 = await page.evaluate(() => window.__commits);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:clock-format", { detail: "24h" })));
await settle();
await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:clock-format", { detail: "12h" })));
await settle();
await page.waitForTimeout(100);
const c1 = await page.evaluate(() => window.__commits);
for (let i = 1; i <= 30; i++) {
  await page.evaluate((x) => {
    document.querySelector(".guide").scrollLeft = x;
  }, i * 40);
  await settle();
}
await page.waitForTimeout(150);
const c2 = await page.evaluate(() => window.__commits);
const mid = await jump();
check(
  "the hook counts the commits that happen (a clock-format change is some)",
  c1 - c0 > 0,
  `${c1 - c0} commits`,
);
check(
  "scrubbing 1,200px sideways renders nothing, and the buttons still follow it",
  c2 === c1 && Math.abs(mid.x - 1200) <= 2 && mid.now === false && mid.earlier === false,
  `${c2 - c1} commits, ${JSON.stringify(mid)}`,
);
await scrollTo(0);

// ---- the half-hour roll keeps your place ----
// Scrolled ahead, the same programme must stay under the viewer when the
// window moves 30 minutes on and every cell moves 285px left.
await scrollTo(2500);
const rowCells = await page.evaluate(() => {
  const row = document.querySelector(".guide__row");
  return [...row.querySelectorAll(".guide__cell[data-key]")].map((c) => ({ title: c.dataset.hint, left: Number(c.dataset.left), width: Number(c.dataset.width) }));
});
// A cell well inside the view (not the one pinned at the edge).
const watched = rowCells.find((c) => c.left > 2500 + 300 && c.left + c.width < 2500 + 1000);
const was = watched ? await programme(watched.title) : null;
const scrollBefore = (await jump()).x;
await page.clock.fastForward("31:00");
// The roll lands with the Guide's 30 second tick.
await page.waitForFunction(
  ([title, left]) => {
    const row = document.querySelector(".guide__row");
    const el = [...row.querySelectorAll(".guide__cell[data-key]")].find((c) => c.dataset.hint === title);
    return !!el && Number(el.dataset.left) !== left;
  },
  [watched?.title, was?.left],
  { timeout: 10_000 },
).catch(() => {});
await settle();
await page.waitForTimeout(150);
const now = await programme(watched?.title);
const scrollAfter = (await jump()).x;
check(
  "the window rolled on (the cells moved left) and so did scrollLeft",
  !!was && !!now && now.left < was.left - 200 && scrollAfter < scrollBefore - 200,
  `cell left ${was?.left} -> ${now?.left}, scrollLeft ${scrollBefore} -> ${scrollAfter}`,
);
check(
  "the programme that was under the viewer is still there, to the pixel",
  !!was && !!now && Math.abs(now.screenX - was.screenX) <= 2,
  `${watched?.title} at x ${was?.screenX} -> ${now?.screenX}`,
);
// Following now (at the start) is left alone.
await press("Back to now");
await page.clock.fastForward("31:00");
await page.waitForTimeout(500);
const following = await jump();
check(
  "at the start the roll leaves scrollLeft alone",
  following.x === 0 && following.now === true,
  JSON.stringify(following),
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
