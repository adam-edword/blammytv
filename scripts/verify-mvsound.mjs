// E2E: multi-view's sound and keys (plan 017, P4a).
//
// What this proves, under the IPC stub the other multi-view harnesses use:
// - in Focus the sound tile is the big one: choosing a small tile SWAPS it
//   in (the big one takes its old place, nothing else moves), and switching
//   to Focus brings the sound tile up (decision M2); in Grid only the sound
//   moves;
// - the bar's volume and mute drive the sound tile's <video>, the others
//   stay muted, the badge says Muted, and both are remembered;
// - the keyboard table: 1 to 4, ← →, A, M, ↑ ↓, G, F, R and Delete, none
//   of them while typing, and not the arrows when the volume slider has
//   focus;
// - the Sound badge's bars follow the tile's real level: a tone moves them,
//   silence leaves them flat;
// - (v0.9.120) a tile's buttons have the app's tooltips, the sound tile's
//   naming R and Delete; the wheel over the sound tile is its volume, and
//   over any other tile does nothing.
//
// Nothing decodes in the test Chromium, so the level comes from a stub of
// captureStream() that plays a real oscillator (or silence) through Web
// Audio: the analyser, the bands and the bars are the app's own.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvsound.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const W = 1600;
const H = 900;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const proxy = http.createServer((rq, rs) => {
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => clearInterval(t));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;

// Web Audio runs without a click, as it does in the app once anything has
// been clicked.
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const ESPN = "Fake ESPN 4K";
const SKY = "Fake Sky Sports FHD";
const NEWS = "Fake News Channel";
const GRID = [
  { channelId: "t:101", label: ESPN },
  { channelId: "t:102", label: SKY },
  { channelId: "t:103", label: NEWS },
];

async function open({ silent = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid, silent }) => {
      MediaSource.isTypeSupported = () => true;
      // The tile's copy of its sound: a 300 Hz tone, or nothing.
      window.__captured = new Set();
      // The app's own AudioContext (mvLevel's), told apart from the tone's.
      window.__appCtx = [];
      let inStub = false;
      const Ctx = window.AudioContext;
      window.AudioContext = class extends Ctx {
        constructor(...a) {
          super(...a);
          if (!inStub) window.__appCtx.push(this);
        }
      };
      HTMLMediaElement.prototype.captureStream = function () {
        window.__captured.add(this);
        inStub = true;
        const ac = new AudioContext();
        inStub = false;
        const osc = ac.createOscillator();
        osc.frequency.value = 300;
        const gain = ac.createGain();
        gain.gain.value = silent ? 0 : 0.8;
        const dest = ac.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        return dest.stream;
      };
      window.__calls = [];
      let cb = 0;
      let n = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => {
          const id = ++cb;
          window["_" + id] = f;
          return id;
        },
        convertFileSrc: (p) => p,
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main", windowLabel: "main" },
        },
        invoke: (cmd, args) => {
          window.__calls.push(cmd);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      // Seeded once: a reload must find what the page itself saved.
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(
          "blammytv.multiviewGrid",
          JSON.stringify({ v: 1, data: { picks: grid, sound: "t:101" } }),
        );
      }
      localStorage.setItem(
        "blammytv.playlists",
        JSON.stringify({
          v: 1,
          data: [
            {
              kind: "xtream",
              id: "t",
              name: "Test",
              enabled: true,
              server: "http://localhost:8081",
              username: "u",
              password: "p",
            },
          ],
        }),
      );
    },
    { port: PORT, grid: GRID, silent },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  // CI once timed out here on the fourth page of a run (v0.9.117) and nothing
  // said why. Say what the page showed instead.
  const ready = await page
    .waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 3, null, {
      timeout: 15_000,
    })
    .then(() => true, () => false);
  if (!ready) {
    const seen = await page.evaluate(() => ({
      url: location.href,
      current: document.querySelector("[data-dest][aria-current='page'], [data-dest].is-active")?.getAttribute("data-dest"),
      tab: !!document.querySelector(".mvtab"),
      grid: !!document.querySelector(".mvgrid"),
      tiles: document.querySelectorAll(".mvtile").length,
      blocked: document.querySelector(".mvtab__blocked")?.textContent ?? null,
      dialog: document.querySelector("[role=dialog]")?.getAttribute("aria-label") ?? !!document.querySelector("[role=dialog]"),
      stored: localStorage.getItem("blammytv.multiviewGrid"),
      body: document.body.innerText.slice(0, 300),
    }));
    throw new Error(`multi-view never showed its 3 tiles: ${JSON.stringify({ ...seen, errors })}`);
  }
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);
const rect = async (page, name) => {
  const b = await tile(page, name).boundingBox();
  return b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}` : "none";
};
/** Every tile's name, widest first. */
const bySize = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) =>
    els
      .map((e) => [e.getAttribute("aria-label").split(",")[0], e.getBoundingClientRect().width])
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => n),
  );
/** Each tile's <video>: [volume, muted]. */
const audio = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => {
        const v = e.querySelector("video");
        return [e.getAttribute("aria-label").split(",")[0], [v.volume, v.muted]];
      }),
    ),
  );
const soundOn = async (page) =>
  Object.entries(await audio(page))
    .filter(([, [, muted]]) => !muted)
    .map(([n]) => n);
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
};
const rest = (page) => page.mouse.move(W - 200, H - 10);

// ---------------------------------------------------------------- Focus
{
  const { page, ctx, errors } = await open();
  await rest(page);
  check("three tiles open in Focus with the sound tile big", (await bySize(page))[0] === ESPN, JSON.stringify(await bySize(page)));

  // The LAST tile, so a swap and a move to the front come out differently.
  const skyWas = await rect(page, SKY);
  const newsWas = await rect(page, NEWS);
  await tile(page, NEWS).click();
  await page.waitForTimeout(300);
  check(
    "choosing a small tile swaps it into the big spot, and nothing else moves",
    (await bySize(page))[0] === NEWS && (await rect(page, ESPN)) === newsWas && (await rect(page, SKY)) === skyWas,
    JSON.stringify({ big: (await bySize(page))[0], espn: await rect(page, ESPN), newsWas, sky: await rect(page, SKY), skyWas }),
  );

  // G flips to Grid, where choosing a tile moves only the sound.
  await rest(page);
  await press(page, "g");
  const gridRects = [await rect(page, ESPN), await rect(page, SKY), await rect(page, NEWS)];
  const widths = gridRects.map((r) => r.split(",")[2]);
  await press(page, "3");
  const third = (await page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) =>
    els.map((e) => [e.getAttribute("aria-label").split(",")[0], e.getBoundingClientRect().x + e.getBoundingClientRect().y * 10000]),
  )).sort((a, b) => a[1] - b[1])[2][0];
  check(
    "G switches to Grid, and there 3 moves the sound to the third tile without moving any",
    new Set(widths).size === 1 &&
      JSON.stringify(await soundOn(page)) === JSON.stringify([third]) &&
      JSON.stringify([await rect(page, ESPN), await rect(page, SKY), await rect(page, NEWS)]) === JSON.stringify(gridRects),
    JSON.stringify({ widths, sound: await soundOn(page), third }),
  );
  await press(page, "g");
  check("and switching back to Focus brings the sound tile up", (await bySize(page))[0] === third, JSON.stringify(await bySize(page)));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// --------------------------------------------------------------- volume
{
  const { page, ctx, errors } = await open();
  await page.locator(".mvvol__slider").fill("0.4");
  await page.waitForTimeout(150);
  const a = await audio(page);
  check(
    "the bar's volume sets the sound tile's, and the others stay muted",
    Math.abs(a[ESPN][0] - 0.4) < 0.001 && a[ESPN][1] === false && a[SKY][1] && a[NEWS][1],
    JSON.stringify(a),
  );
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await page.waitForTimeout(150);
  const badge = await tile(page, ESPN).locator(".mvtile__badge").textContent();
  check(
    "Mute silences it, and its badge says so",
    (await audio(page))[ESPN][1] === true && badge.includes("Muted") && (await soundOn(page)).length === 0,
    JSON.stringify({ a: await audio(page), badge }),
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 3, null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);
  const back = await audio(page);
  check(
    "both are remembered after a reload",
    Math.abs(back[ESPN][0] - 0.4) < 0.001 && back[ESPN][1] === true,
    JSON.stringify(back),
  );

  // ------------------------------------------------------------- keys
  await rest(page);
  await press(page, "m");
  check("M unmutes", (await audio(page))[ESPN][1] === false, JSON.stringify(await audio(page)));
  await press(page, "ArrowUp");
  const up = (await audio(page))[ESPN][0];
  await press(page, "ArrowDown");
  await press(page, "ArrowDown");
  const down = (await audio(page))[ESPN][0];
  check("↑ and ↓ step the volume", Math.abs(up - 0.45) < 0.001 && Math.abs(down - 0.35) < 0.001, `${up} then ${down}`);

  // A focused slider keeps its arrows: → steps the volume, not the sound.
  await page.locator(".mvvol__slider").focus();
  await press(page, "ArrowRight");
  const once = (await audio(page))[ESPN][0];
  const stayed = await soundOn(page);
  await page.locator(".mvtile").first().focus();
  check(
    "with the slider focused, → moves the volume and leaves the sound where it is",
    Math.abs(once - 0.4) < 0.001 && JSON.stringify(stayed) === JSON.stringify([ESPN]),
    JSON.stringify({ once, stayed }),
  );

  const before = await soundOn(page);
  await press(page, "ArrowRight");
  const after = await soundOn(page);
  check("→ moves the sound to the next tile", after.length === 1 && after[0] !== before[0], `${before} -> ${after}`);

  // The fake line is 3 of 3, so with three tiles open there is no room for
  // A to add one. R opens the picker here instead; A gets its turn below,
  // once Delete has made room.
  await press(page, "a");
  const atCap = await page.locator(".mvpick__input").count();
  const current = (await soundOn(page))[0];
  await press(page, "r");
  const target = await page.locator(".mvpick__target").textContent({ timeout: 3000 }).catch(() => "");
  check(
    "R opens Replace for the current tile (and A, with the line full, did not open Add)",
    target === `Replaces ${current}` && atCap === 0,
    JSON.stringify({ target, atCap }),
  );
  await page.keyboard.type("mg3");
  await page.waitForTimeout(150);
  const typed = await audio(page);
  const query = await page.locator(".mvpick__input").inputValue();
  const kindThen = await page.locator(".mvseg [aria-pressed='true']").getAttribute("aria-label").catch(() => "");
  await press(page, "Escape");
  await page.locator(".mvpick__input").waitFor({ state: "detached" });
  check(
    "typing in the picker is typing: M, G and 3 go into the search and do nothing else",
    query === "mg3" &&
      JSON.stringify(await soundOn(page)) === JSON.stringify(after) &&
      typed[after[0]][1] === false &&
      kindThen === (await page.locator(".mvseg [aria-pressed='true']").getAttribute("aria-label").catch(() => "")),
    JSON.stringify({ query, typed, kindThen }),
  );

  const calls0 = (await page.evaluate(() => window.__calls)).length;
  await press(page, "f");
  const fs = (await page.evaluate(() => window.__calls)).slice(calls0);
  check("F asks for full screen", fs.includes("plugin:window|set_fullscreen"), JSON.stringify(fs));

  await press(page, "Delete");
  const left = await page
    .locator(".mvtile:not(.mvtile--empty)")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(",")[0]));
  check("Delete closes the current tile", left.length === 2 && !left.includes(current), JSON.stringify(left));

  await rest(page);
  await press(page, "a");
  const added = await page.locator(".mvpick__input").waitFor({ timeout: 3000 }).then(() => true, () => false);
  const addTarget = added ? await page.locator(".mvpick__target").textContent() : null;
  check("with room on the line, A opens Add", added && addTarget === "", JSON.stringify({ added, addTarget }));
  await press(page, "Escape");
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------ tooltips and the wheel
/**
 * Every tooltip open once the pointer rests on one of a tile's buttons.
 *
 * Moved as a hand moves, never in one jump. Radix keeps a tooltip open
 * while the pointer heads for it, and only rechecks on the NEXT move: a
 * pointer that jumps and stops leaves the last one open, and the button it
 * landed on never hears of it. So a second move after leaving, and two
 * small ones on the button.
 */
async function hint(page, name, button) {
  await page.mouse.move(W - 200, H - 10);
  await page.mouse.move(W - 201, H - 10);
  await page.waitForTimeout(400);
  const t = tile(page, name);
  await t.hover({ position: { x: 60, y: 60 } });
  const b = await t.getByRole("button", { name: new RegExp(`^${button} `) }).boundingBox();
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.move(x + 1, y);
  await page.mouse.move(x, y);
  const open = page.locator("[data-slot='tooltip-content'][data-state$='open']");
  await open.first().waitFor({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(100);
  return (await open.allTextContents()).join(" + ");
}
/** One notch of the wheel over a tile; whether anything took it, so the
 * page could not also scroll. */
async function wheel(page, name, dy) {
  await page.evaluate(() => (window.__took = []));
  await tile(page, name).hover({ position: { x: 60, y: 60 } });
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(150);
  return page.evaluate(() => window.__took);
}
{
  const { page, ctx, errors } = await open();
  const mine = [await hint(page, ESPN, "Watch"), await hint(page, ESPN, "Replace"), await hint(page, ESPN, "Close")];
  check(
    "the sound tile's buttons have the app's tooltips, naming their keys",
    JSON.stringify(mine) === JSON.stringify(["Watch in player", "Replace (R)", "Close (Delete)"]),
    JSON.stringify(mine),
  );
  const theirs = [await hint(page, SKY, "Replace"), await hint(page, SKY, "Close")];
  check(
    "another tile's name no keys, since R and Delete act on the sound tile",
    JSON.stringify(theirs) === JSON.stringify(["Replace", "Close"]),
    JSON.stringify(theirs),
  );
  check("and no tile button still has the browser's", (await page.locator(".mvtile button[title]").count()) === 0);

  await page.evaluate(() => window.addEventListener("wheel", (e) => window.__took.push(e.defaultPrevented)));
  await page.locator(".mvvol__slider").fill("0.5");
  await rest(page);
  await press(page, "m");
  const down = await wheel(page, ESPN, 100);
  const a = (await audio(page))[ESPN];
  check(
    "the wheel down over the sound tile turns it down a step, leaves the mute alone, and the page does not scroll",
    Math.abs(a[0] - 0.45) < 0.001 && a[1] === true && JSON.stringify(down) === "[true]",
    JSON.stringify({ a, down }),
  );
  const up = await wheel(page, ESPN, -100);
  const b = (await audio(page))[ESPN];
  const slider = await page.locator(".mvvol__slider").inputValue();
  check(
    "and up turns it up a step and unmutes, as ↑ does, the bar's slider with it",
    Math.abs(b[0] - 0.5) < 0.001 && b[1] === false && slider === "0.5" && JSON.stringify(up) === "[true]",
    JSON.stringify({ b, slider, up }),
  );
  const other = [...(await wheel(page, SKY, -100)), ...(await wheel(page, NEWS, 100))];
  const c = await audio(page);
  check(
    "over any other tile the wheel does nothing, and is left to the page",
    Math.abs(c[ESPN][0] - 0.5) < 0.001 &&
      JSON.stringify(await soundOn(page)) === JSON.stringify([ESPN]) &&
      JSON.stringify(other) === "[false,false]",
    JSON.stringify({ c, other }),
  );

  // The sound moves, and the wheel goes with it.
  await tile(page, SKY).click({ position: { x: 60, y: 60 } });
  await page.waitForTimeout(400);
  await wheel(page, SKY, 100);
  const onSky = (await audio(page))[SKY][0];
  await wheel(page, ESPN, 100);
  const d = await audio(page);
  check(
    "when the sound moves the wheel follows it: over Sky it turns, over ESPN no longer",
    JSON.stringify(await soundOn(page)) === JSON.stringify([SKY]) &&
      Math.abs(onSky - 0.45) < 0.001 &&
      Math.abs(d[SKY][0] - 0.45) < 0.001,
    JSON.stringify({ onSky, d }),
  );

  // The bar has dimmed by the time a hand reaches for the wheel; turning it
  // brings the bar back, so the slider shows what it did.
  await page.waitForTimeout(2400);
  const dimmed = await page.evaluate(() => document.documentElement.dataset.mvIdle === "1");
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(150);
  const woke = await page.evaluate(() => document.documentElement.dataset.mvIdle !== "1");
  check("the wheel wakes the bar", dimmed && woke, JSON.stringify({ dimmed, woke }));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------- level
const bars = (page, name) =>
  tile(page, name)
    .locator(".mvbars")
    .evaluate((el) => ["--b1", "--b2", "--b3"].map((v) => Number(el.style.getPropertyValue(v) || "NaN")));

for (const silent of [false, true]) {
  const { page, ctx, errors } = await open({ silent });
  await page.evaluate(() =>
    document.querySelectorAll("video.mvtile__video").forEach((v) => v.dispatchEvent(new Event("playing"))),
  );
  // The bars move only while the badge shows: under the pointer, here.
  await tile(page, ESPN).hover();
  await page.waitForTimeout(800);
  const [b1, b2, b3] = await bars(page, ESPN);
  if (!silent) {
    check("a tone moves the sound tile's bars (300 Hz: the low one most)", b1 > 0.3 && b1 > b3, JSON.stringify([b1, b2, b3]));
  } else {
    check("silence leaves them flat", [b1, b2, b3].every((b) => b < 0.05), JSON.stringify([b1, b2, b3]));
  }
  // Every tile got its playing event; only the sound tile may listen.
  const listened = await page.evaluate(() => window.__captured.size);
  if (!silent) check("and only the sound tile is measured", listened === 1, `${listened} tiles listened to`);
  if (!silent) {
    // Measured only while the badge can be seen (plan 018, P1), and the
    // audio context rests while nothing measures (P6). Pointer off the
    // tiles, past the sound's 3s flash: no writes to the bars, no frame
    // loop, the context suspended. Back over the sound tile: all three on.
    const writes = () =>
      page.evaluate(
        () =>
          new Promise((done) => {
            const el = document.querySelector(".mvtile.is-on .mvbars");
            let n = 0;
            const mo = new MutationObserver((m) => (n += m.length));
            mo.observe(el, { attributes: true, attributeFilter: ["style"] });
            setTimeout(() => {
              mo.disconnect();
              done(n);
            }, 1200);
          }),
      );
    const ctxState = () => page.evaluate(() => window.__appCtx.map((c) => c.state).join(","));
    await page.mouse.move(W / 2, 20);
    await page.waitForTimeout(3500);
    const hiddenWrites = await writes();
    const hiddenCtx = await ctxState();
    await tile(page, ESPN).hover();
    await page.waitForTimeout(300);
    const shownWrites = await writes();
    const shownCtx = await ctxState();
    check(
      "the bars are measured only while the badge shows, and the context rests otherwise",
      hiddenWrites === 0 && shownWrites > 10 && hiddenCtx === "suspended" && shownCtx === "running",
      JSON.stringify({ hiddenWrites, shownWrites, hiddenCtx, shownCtx }),
    );
    await goTo(page, "guide");
    await page.waitForTimeout(500);
    const left = await ctxState();
    check("leaving the tab rests the context", left === "suspended", left);
  }
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
