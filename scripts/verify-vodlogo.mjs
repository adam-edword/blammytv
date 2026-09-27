// Headless verify: a show's logo in the player (v0.10.20).
//
// Adam, on a Demon Slayer episode: "can you left justify the logo over the
// episode title?", and for the black loading screen, "scale a new show logo
// over the black vod, super blurred, to give it a sorta glowing effect".
// Show logos often arrive as wide transparent PNGs with the mark in the
// middle, so the file's edge sat flush with the title and the mark did not.
// What this proves, on the `?overlay=1` seam with a mocked overlayApi (as
// verify-overlay-tracks) and a logo drawn here with lopsided padding:
// - loading, a blurred copy of the logo sits behind it, bigger, on the same
//   centre, and it paints in the logo's own colour outside the logo's box;
// - played, the title logo is cropped to its ink across the width, and the
//   ink starts where the title starts, at the logo's own height;
// - a logo whose pixels can't be read (no CORS here, as a host that sends
//   none) shows exactly as before rather than not at all.
//
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-vodlogo.mjs
//   (vite on :4173; pnpm verify runs it with everything else)
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = "http://localhost:4173/?overlay=1";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// The logo: 600x200, transparent, a red disc with a white centre whose ink
// runs from 30% to 50% of the width. Lopsided on purpose, so a crop with its
// sides swapped would show nothing at all rather than pass.
const scratch = await browser.newPage();
const png = await scratch.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 200;
  const g = c.getContext("2d");
  g.fillStyle = "#d42020";
  g.beginPath();
  g.arc(240, 100, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f4f4f4";
  g.beginPath();
  g.arc(240, 100, 40, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL("image/png").split(",")[1];
});
await scratch.close();
const body = Buffer.from(png, "base64");

// Reduced motion: the pair's breathing stops at a steady 0.85, so the glow's
// colour can be read at a known strength rather than wherever the cycle is.
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  screen: { width: 1920, height: 1080 },
  reducedMotion: "reduce",
});
// Offline: the two logos are answered here, everything else off this
// machine is refused.
await ctx.route(
  (u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname),
  (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== "logos.test") return r.abort();
    // Playwright adds an allow-origin of its own to a fulfilled CORS request
    // that names none, so the unreadable one names somebody else's origin.
    const cors = { "access-control-allow-origin": u.pathname === "/cors.png" ? "*" : "http://elsewhere.test" };
    return r.fulfill({ status: 200, contentType: "image/png", headers: cors, body });
  },
);

const mockBridge = (logo) => {
  let loading = true;
  let loadingCbs = [];
  window.__setLoading = (v) => {
    loading = v;
    loadingCbs.slice().forEach((cb) => cb(v));
  };
  const unsub = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {},
    seekTo() {}, setSpeed() {}, expand() {}, collapse() {}, fullscreen() {},
    exitFullscreen() {}, popout() {}, panel() {}, toggleFavorite() {},
    goLive() {}, setMouseIgnore() {}, selectAudio() {}, selectSub() {},
    getMeta() {
      return Promise.resolve({
        channelName: "Demon Slayer",
        live: false,
        logo,
        title: "I Even Ate Demons...",
        description: "It is the Taisho Period in Japan.",
        vod: { season: 5, episode: 5, title: "I Even Ate Demons..." },
      });
    },
    onMeta: unsub, onKey: unsub, onTime: unsub,
    onLoading(cb) {
      loadingCbs.push(cb);
      return () => { loadingCbs = loadingCbs.filter((x) => x !== cb); };
    },
    getLoading() { return loading; },
    getTime() { return null; },
    getTracks() { return null; },
    onTracks: unsub,
  };
};

const open = async (logo) => {
  const page = await ctx.newPage();
  await page.addInitScript(mockBridge, logo);
  await page.addInitScript(() => { window.__overlayProps = { vod: true }; });
  await page.goto(APP);
  await page.waitForSelector(".theater-overlay");
  return page;
};

/** Read screen pixels: a screenshot of the page, decoded in the page. */
const pixels = async (page, points) => {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ({ shot, points }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + shot;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return points.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3));
    },
    { shot, points },
  );
};
const red = ([r, g, b]) => r >= 40 && r > g * 1.6 && r > b * 1.6;

/** Keep the player chrome awake: it fades out when the pointer rests. */
const wake = async (page) => {
  await page.mouse.move(800, 400);
  await page.mouse.move(810, 410);
};

// ---------------------------------------------------------------- loading
{
  const page = await open("http://logos.test/cors.png");
  await page.locator(".tune__vodglow").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(
    () => [...document.querySelectorAll(".tune__vodart img")].every((i) => i.complete && i.naturalWidth > 0),
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  const art = await page.evaluate(() => {
    const glow = document.querySelector(".tune__vodglow");
    const logo = document.querySelector(".tune__vodlogo");
    if (!glow || !logo) return null;
    const r = (e) => e.getBoundingClientRect();
    const g = r(glow);
    const l = r(logo);
    return {
      same: glow.getAttribute("src") === logo.getAttribute("src"),
      behind: glow.compareDocumentPosition(logo) === Node.DOCUMENT_POSITION_FOLLOWING,
      filter: getComputedStyle(glow).filter,
      glow: { w: g.width, h: g.height, cx: g.left + g.width / 2, cy: g.top + g.height / 2 },
      logo: { x: l.left, y: l.top, w: l.width, h: l.height, cx: l.left + l.width / 2, cy: l.top + l.height / 2 },
    };
  });
  check(
    "loading: the logo has a blurred copy of itself behind it, four times the size and on the same centre",
    !!art &&
      art.same &&
      art.behind &&
      /blur\(24px\)/.test(art.filter) &&
      art.glow.w > art.logo.w * 3.9 &&
      Math.abs(art.glow.cx - art.logo.cx) < 1 &&
      Math.abs(art.glow.cy - art.logo.cy) < 1,
    JSON.stringify(art),
  );

  // The disc is drawn at 30-50% of the file, centred at 40%, so in the
  // logo's 3:1 box its centre sits at 40% of the box's width. Read above the
  // logo's box on that line, clear of the logo itself: only the glow can put
  // anything there. And a corner of the window, which nothing should reach.
  const x = art.logo.x + art.logo.w * 0.4;
  const [above, corner] = await pixels(page, [
    [x, art.logo.y - 24],
    [20, 20],
  ]);
  check(
    "  and it glows in the logo's own colour outside the logo, and nowhere near the corners",
    red(above) && Math.max(...corner) < 8,
    JSON.stringify({ above, corner }),
  );
  await page.screenshot({ path: (process.env.SHOT_DIR ?? "/tmp") + "/vodlogo-loading.png" });

  // ------------------------------------------------------------- played
  await page.evaluate(() => window.__setLoading(false));
  await wake(page);
  await page.locator(".theater-bar__logo[data-ready]").waitFor({ timeout: 5000 }).catch(() => {});
  await wake(page);
  await page.waitForTimeout(400);
  const bar = await page.evaluate(() => {
    const logo = document.querySelector(".theater-bar__logo");
    const title = document.querySelector(".theater-bar__title");
    if (!logo || !title) return null;
    const l = logo.getBoundingClientRect();
    return {
      trim: logo.hasAttribute("data-trim"),
      view: getComputedStyle(logo).objectViewBox,
      opacity: getComputedStyle(logo).opacity,
      logo: { x: l.left, y: l.top, w: l.width, h: l.height },
      titleX: title.getBoundingClientRect().left,
      tune: !!document.querySelector(".tune"),
    };
  });
  // The ink is 20% of a 600x200 file at 112px tall: 120 x 112/200 = 67px,
  // and a pixel or two either way for the 256px read.
  check(
    "played: the title logo is cropped to its ink across the width, at its full height",
    !!bar && bar.trim && !bar.tune && bar.opacity === "1" && Math.abs(bar.logo.h - 112) < 1 && bar.logo.w > 62 && bar.logo.w < 74,
    JSON.stringify(bar),
  );
  // Now by the pixels: along the logo's middle row, the first red is at the
  // title's left edge, not 30% of a file's width to the right of it.
  const row = bar ? bar.logo.y + bar.logo.h / 2 : 0;
  const xs = Array.from({ length: 40 }, (_, i) => (bar ? bar.titleX - 6 : 0) + i);
  const line = await pixels(page, xs.map((x) => [x, row]));
  const first = xs[line.findIndex(red)];
  check(
    "  and the mark starts where the episode title starts",
    !!bar && first != null && Math.abs(first - bar.titleX) <= 3 && Math.abs(bar.logo.x - bar.titleX) < 1,
    JSON.stringify({ titleX: bar?.titleX, logoX: bar?.logo.x, firstRed: first }),
  );
  await page.screenshot({ path: (process.env.SHOT_DIR ?? "/tmp") + "/vodlogo-played.png" });
  await page.close();
}

// ------------------------------------------------------ unreadable pixels
// The same file from a host that sends no CORS headers: the <img> shows it,
// the page can't read it. It must show, untrimmed, not stay hidden.
{
  const page = await open("http://logos.test/nocors.png");
  await page.evaluate(() => window.__setLoading(false));
  await wake(page);
  await page.locator(".theater-bar__logo[data-ready]").waitFor({ timeout: 5000 }).catch(() => {});
  await wake(page);
  await page.waitForTimeout(400);
  const bar = await page.evaluate(() => {
    const logo = document.querySelector(".theater-bar__logo");
    if (!logo) return null;
    const l = logo.getBoundingClientRect();
    return { ready: logo.hasAttribute("data-ready"), trim: logo.hasAttribute("data-trim"), opacity: getComputedStyle(logo).opacity, w: l.width, h: l.height, loaded: logo.naturalWidth };
  });
  // Untrimmed, the 3:1 file at 112px tall wants 336px and max-width holds it at 320.
  check(
    "a logo whose pixels can't be read shows as it always did: whole, and not hidden",
    !!bar && bar.ready && !bar.trim && bar.opacity === "1" && bar.loaded === 600 && Math.abs(bar.w - 320) < 1,
    JSON.stringify(bar),
  );
  await page.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
