// Headless verify: a title's loading screen and its logo in the player
// (v0.10.20, v0.10.21).
//
// Adam, on a Demon Slayer episode: "can you left justify the logo over the
// episode title?". Show logos often arrive as wide transparent PNGs with the
// mark in the middle, so the file's edge sat flush with the title and the
// mark did not. Then, for the black loading screen, pointing at another
// app's: the backdrop blurred into a wash, and "a similar loading bar like
// they did? that way when loading there aren't 2 visible logos".
// What this proves, on the `?overlay=1` seam with a mocked overlayApi (as
// verify-overlay-tracks), a logo drawn here with lopsided padding and a warm
// backdrop:
// - loading, one logo on screen, over the backdrop blurred and darkened to
//   a wash that is warm in the middle and black in the corners;
// - the bar reads Opening the stream, then Buffering once mpv reports the
//   file's position and duration, and moves forward when it does;
// - played, the loading screen is gone and the title logo is cropped to its
//   ink across the width, the ink starting where the title starts;
// - a logo whose pixels can't be read (its host sends no CORS) shows
//   exactly as before rather than not at all.
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
// The backdrop: 1280x720, warm on the left and grey on the right, the way a
// show's key art tends to be. Only its tone matters here.
const wide = await scratch.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 720;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 1280, 0);
  grad.addColorStop(0, "#c46a2e");
  grad.addColorStop(0.5, "#8a5a44");
  grad.addColorStop(1, "#6e6a6a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1280, 720);
  return c.toDataURL("image/png").split(",")[1];
});
await scratch.close();
const body = Buffer.from(png, "base64");
const backdrop = Buffer.from(wide, "base64");

// Reduced motion: the logo stops breathing and the bar stops easing, so both
// can be read at once rather than wherever a cycle or a transition is.
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
    const cors = { "access-control-allow-origin": u.pathname === "/nocors.png" ? "http://elsewhere.test" : "*" };
    const img = u.pathname === "/backdrop.png" ? backdrop : body;
    return r.fulfill({ status: 200, contentType: "image/png", headers: cors, body: img });
  },
);

const mockBridge = (logo) => {
  let loading = true;
  let loadingCbs = [];
  let timeCbs = [];
  window.__setLoading = (v) => {
    loading = v;
    loadingCbs.slice().forEach((cb) => cb(v));
  };
  // What the status poll pushes once mpv has opened the file.
  window.__pushTime = (t) => timeCbs.slice().forEach((cb) => cb(t));
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
        backdrop: "http://logos.test/backdrop.png",
        title: "I Even Ate Demons...",
        description: "It is the Taisho Period in Japan.",
        vod: { season: 5, episode: 5, title: "I Even Ate Demons..." },
      });
    },
    onMeta: unsub, onKey: unsub,
    onTime(cb) {
      timeCbs.push(cb);
      return () => { timeCbs = timeCbs.filter((x) => x !== cb); };
    },
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
  await page.locator(".vodload__bg img[data-loaded]").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const screen = await page.evaluate(() => {
    const bg = document.querySelector(".vodload__bg img");
    const r = bg?.getBoundingClientRect();
    const visibleLogos = [...document.querySelectorAll("img.tune__vodlogo, img.theater-bar__logo")].filter(
      (i) => i.getBoundingClientRect().width > 0,
    );
    return {
      bg: bg && { src: bg.getAttribute("src"), filter: getComputedStyle(bg).filter, box: [r.left, r.top, r.width, r.height] },
      logos: visibleLogos.map((i) => i.className),
      playerBar: !!document.querySelector(".theater-bar"),
    };
  });
  check(
    "loading: one logo on screen, over the backdrop blurred and darkened across the whole window",
    !!screen.bg &&
      screen.bg.src === "http://logos.test/backdrop.png" &&
      /blur\(64px\)/.test(screen.bg.filter) &&
      /brightness\(0\.42\)/.test(screen.bg.filter) &&
      JSON.stringify(screen.bg.box) === JSON.stringify([0, 0, 1600, 900]) &&
      JSON.stringify(screen.logos) === JSON.stringify(["tune__vodlogo"]) &&
      !screen.playerBar,
    JSON.stringify(screen),
  );
  // Warm and dark in the middle band (the reference measured about rgb 45
  // there), black by the corners.
  const [mid, corner] = await pixels(page, [
    [400, 450],
    [12, 12],
  ]);
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  check(
    "  a wash in the backdrop's colours, warm and dark in the middle and black in the corners",
    lum(mid) > 15 && lum(mid) < 90 && mid[0] > mid[2] + 8 && Math.max(...corner) < 10,
    JSON.stringify({ mid, corner }),
  );
  await page.screenshot({ path: (process.env.SHOT_DIR ?? "/tmp") + "/vodlogo-loading.png" });

  const readBar = () =>
    page.evaluate(() => {
      const t = document.querySelector(".vodload__track")?.getBoundingClientRect();
      const f = document.querySelector(".vodload__fill")?.getBoundingClientRect();
      return {
        label: document.querySelector(".vodload__label")?.textContent,
        fill: t && f ? +(f.width / t.width).toFixed(2) : null,
      };
    });
  const opening = await readBar();
  await page.evaluate(() => window.__pushTime({ pos: 0, dur: 1420 }));
  await page.waitForTimeout(300);
  const buffering = await readBar();
  check(
    "  the bar reads Opening the stream, then Buffering once mpv has the file, and moves forward",
    opening.label === "Opening the stream…" &&
      buffering.label === "Buffering…" &&
      opening.fill === 0.55 &&
      buffering.fill === 0.85,
    JSON.stringify({ opening, buffering }),
  );

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
      tune: !!document.querySelector(".tune, .vodload"),
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
