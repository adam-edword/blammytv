// E2E: first-run onboarding — gate behavior, full walk with REAL
// verification (fake-aio :8084 + fake-panel :8081), blocked-instance
// verdict, saves, finale hand-off, reduced-motion, skip.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const FAST = process.env.FAST === "1"; // FAST=1: core walk only (iteration); full suite = pre-push gate
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const newPage = async (init = {}, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, init);
  return page;
};

// 1. Gate: a true first run (nothing stored) shows onboarding unforced.
if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/");
  const shown = await page.waitForSelector(".onb", { timeout: 8000 }).then(() => true).catch(() => false);
  check("first run: onboarding appears without the force flag", shown);
  await page.close();
}

// 2. Showcase (v0.4.25): an existing user WITHOUT the flag sees it once,
//    with their saved data pre-filled and their playlists acknowledged.
if (!FAST) {
  const page = await newPage({
    "blammytv.aiostreams": JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }),
    "blammytv.playlists": JSON.stringify({ v: 1, data: [{ id: "p1", kind: "xtream", name: "TV", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] }),
  });
  await page.goto("http://localhost:4173/");
  const shown = await page.waitForSelector(".onb", { timeout: 8000 }).then(() => true).catch(() => false);
  check("existing user without the flag: showcase runs", shown);
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  const prefilled = await page.locator(".onb-input").inputValue();
  check("manifest pre-filled from saved settings",
    prefilled === "http://localhost:8084/manifest.json", prefilled);
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  const note = await page.$eval(".onb-hint--ok", (el) => el.textContent).catch(() => "");
  check("TV step acknowledges existing playlists",
    /1 playlist is already connected/.test(note ?? ""), String(note));
  const plAfter = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem("blammytv.playlists") ?? "{}").data ?? []).length);
  check("existing playlist untouched", plAfter === 1);
  await page.close();
}

// 3. Gate: completed flag wins.
if (!FAST) {
  const page = await newPage({ "btv:onboarded": "1" });
  await page.goto("http://localhost:4173/");
  await page.waitForTimeout(1200);
  check("completed flag: no onboarding", !(await page.$(".onb")));
  await page.close();
}

// 4. Full walk: verification on both source steps, all saves, finale.
{
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  check("app shell is covered", await page.$eval(".onb", (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= innerWidth && r.height >= innerHeight;
  }));
  check("app shell is inert behind the overlay",
    await page.$eval(".header", (el) => el.hasAttribute("inert")));

  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });

  // Validation: garbage URL disables Continue + hints on submit attempt.
  await page.locator(".onb-input").fill("not a url");
  check("bad manifest disables Continue",
    await page.getByRole("button", { name: "Continue", exact: true }).isDisabled());
  await page.waitForTimeout(150);
  await page.locator(".onb-input").press("Enter");
  check("submit attempt on a bad URL shows the hint",
    !!(await page.waitForSelector(".onb-hint", { timeout: 8000 }).catch(() => null)));

  // Real verification: fake-aio answers, success message, AUTO-advance.
  await page.locator(".onb-input").fill("http://localhost:8084/manifest.json");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const okMsg = await page.waitForSelector(".onb-hint--ok", { timeout: 10000 }).then((el) => el.textContent()).catch(() => null);
  check("streams verification succeeds with catalog count",
    !!okMsg && /Connected — 5 catalogs/.test(okMsg), String(okMsg));

  // Auto-advance lands on Live TV.
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  const aioSaved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.aiostreams") ?? "{}").data);
  check("manifest saved on successful verify",
    aioSaved === "http://localhost:8084/manifest.json", String(aioSaved));

  // Live TV: partial creds hint, then real auth against fake-panel.
  const fields = page.locator(".onb-fields .onb-input");
  await fields.nth(0).fill("http://localhost:8081");
  await fields.nth(0).press("Enter");
  check("partial TV creds show the fill-all hint",
    !!(await page.waitForSelector(".onb-hint", { timeout: 8000 }).catch(() => null)));
  await fields.nth(1).fill("u");
  await fields.nth(2).fill("p");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const tvOk = await page.waitForSelector(".onb-hint--ok", { timeout: 10000 }).then(() => true).catch(() => false);
  check("TV verification succeeds", tvOk);

  await page.waitForSelector(".onb-swatches", { timeout: 8000 });
  const pl = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.playlists") ?? "{}").data ?? []);
  check("xtream playlist saved on successful verify",
    pl.length === 1 && pl[0].kind === "xtream" && pl[0].server === "http://localhost:8081"
      && pl[0].username === "u" && pl[0].enabled === true,
    JSON.stringify(pl));

  // Accent + clock.
  await page.locator(".onb-swatch").nth(2).click(); // green #2cad57
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  check("swatch applies accent live", accent === "#2cad57", accent);
  await page.getByRole("button", { name: "24h", exact: true }).click();
  const clock = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.clockFormat") ?? "{}").data);
  check("clock chip saves", clock === "24h", String(clock));
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Startup tab.
  await page.waitForSelector(".onb-chips:not(.onb-chips--labeled)", { timeout: 8000 });
  await page.getByRole("button", { name: "Stream · Home" }).click();
  const startup = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.startupTab") ?? "{}").data);
  check("startup pill saves the choice", startup === "stream", String(startup));
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Done: nav map + settings nudge, then the hand-off.
  await page.waitForSelector(".onb-map", { timeout: 8000 });
  const mapText = await page.$eval(".onb-map", (el) => el.textContent);
  const nudge = await page.$$eval(".onb-sub", (els) => els.map((e) => e.textContent).join(" "));
  check("finale shows the nav map + Settings nudge",
    /Live TV/.test(mapText) && /Discover/.test(mapText) && /Settings holds a lot more/.test(nudge));
  // The ONE-PIECE finale (v0.4.39, Figma 272:1000): the steps backdrop
  // is frame zero of the boot timeline; the finale plays it forward on
  // the same persistent nodes. Sample the screen EVERY FRAME from here:
  // the blur-safety contract says its geometry may only ever change on
  // frames where the filter is already none.
  await page.evaluate(() => {
    const w = window;
    w.__bootSamples = [];
    const probe = () => {
      const scr = document.querySelector(".boot-screen");
      if (scr) {
        const cs = getComputedStyle(scr);
        w.__bootSamples.push({
          f: cs.filter,
          t: cs.transform,
          w: scr.getBoundingClientRect().width,
        });
      }
      if (w.__bootSamples.length < 400 && document.querySelector(".onb")) {
        requestAnimationFrame(probe);
      }
    };
    requestAnimationFrame(probe);
  });
  const stepsBlur = await page.$eval(".boot-screen", (el) => {
    const cs = getComputedStyle(el);
    return { filter: cs.filter, willChange: cs.willChange };
  });
  check("steps: the screen is blur-softened, no will-change:filter",
    /blur\(/.test(stepsBlur.filter) && !/filter/.test(stepsBlur.willChange),
    JSON.stringify(stepsBlur));
  await page.getByRole("button", { name: "Enter BlammyTV" }).click();
  const landed = await page
    .waitForSelector(".boot-scene.is-landed, .boot-scene.is-shrink", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("finale lands the one-piece timeline", landed);
  check("the cold-boot overlay never mounts", !(await page.$(".boot-overlay")));
  const afterLand = await page.evaluate(() => {
    const scr = document.querySelector(".boot-screen");
    const frame = document.querySelector(".boot-frame");
    return {
      filter: scr ? getComputedStyle(scr).filter : null,
      frameAnim: frame ? getComputedStyle(frame).animationName : null,
    };
  });
  await page.waitForSelector(".boot-scene.is-shrink", { timeout: 3000 }).catch(() => null);
  const shrinkAnim = await page.$eval(".boot-frame", (el) => getComputedStyle(el).animationName).catch(() => "");
  check("landed: filter torn down to none, shrink keyframes attach",
    afterLand.filter === "none" && /btv-boot-frame/.test(shrinkAnim ?? ""),
    JSON.stringify({ ...afterLand, shrinkAnim }));
  // Blur-safety contract: geometry never changed on any frame that
  // still had a live filter.
  const samples = await page.evaluate(() => window.__bootSamples ?? []);
  const baseline = samples.find((s) => /blur\(/.test(s.f));
  const violation = samples.find(
    (s) => /blur\(/.test(s.f) && baseline &&
      (s.t !== baseline.t || Math.abs(s.w - baseline.w) > 0.5),
  );
  check("blur safety: geometry frozen on every blurred frame",
    samples.length > 10 && !violation,
    `samples=${samples.length}${violation ? " VIOLATION " + JSON.stringify(violation) : ""}`);
  // The steps garnish (dither) unmounts at the sweep.
  const sweptOk = await page
    .waitForFunction(() => !document.querySelector(".onb-dither"), null, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check("steps garnish swept after the landing", sweptOk);
  // The overlay releases itself once the lockup holds (~2330ms after
  // the content swap) and the fade completes.
  const released = await page
    .waitForFunction(() => !document.querySelector(".onb"), null, { timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  const state = await page.evaluate(() => ({
    onboarded: localStorage.getItem("btv:onboarded"),
    welcomeUp: !!document.querySelector(".boot-overlay"),
  }));
  check("completion persisted, overlay released, no cold boot after the finale",
    state.onboarded === "1" && released && !state.welcomeUp,
    JSON.stringify({ ...state, released }));
  await page.close();
}

// 5. Blocked instance: the Cloudflare verdict surfaces IN onboarding,
//    and "Continue anyway" saves + advances.
if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  await page.locator(".onb-input").fill("http://localhost:8084/cf/manifest.json");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const verdict = await page.waitForSelector(".onb-hint:not(.onb-hint--ok)", { timeout: 12000 }).then((el) => el.textContent()).catch(() => null);
  check("blocked instance: verdict names bot protection",
    !!verdict && /bot protection/.test(verdict), String(verdict).slice(0, 90));
  const anyway = page.getByRole("button", { name: "Continue anyway" });
  check("ghost relabels to Continue anyway", await anyway.count() === 1);
  await anyway.click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.aiostreams") ?? "{}").data);
  check("continue-anyway saves the URL and advances",
    saved === "http://localhost:8084/cf/manifest.json", String(saved));
  await page.close();
}

// 5b. Kind rail: M3U path verifies against fake-m3u; switching kinds
//     must NOT restart the step's entrance animations.
if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.waitForTimeout(2100); // past the settle point
  const settledAnims = await page.$eval(".onb-title", (el) => el.getAnimations().length);
  check("step settles: entrance animations are REMOVED (nothing to replay)",
    settledAnims === 0, `animations=${settledAnims}`);
  await page.getByRole("button", { name: "M3U", exact: true }).click();
  await page.waitForTimeout(250);
  const afterSwitch = await page.$eval(".onb-title", (el) =>
    ({ anims: el.getAnimations().length, opacity: getComputedStyle(el).opacity }));
  check("kind switch cannot restart entrances",
    afterSwitch.anims === 0 && afterSwitch.opacity === "1", JSON.stringify(afterSwitch));
  const pmAttrs = await page.$eval(".onb-fields .onb-input", (el) =>
    el.hasAttribute("data-1p-ignore") && el.getAttribute("data-lpignore") === "true"
      && el.getAttribute("data-protonpass-ignore") === "true");
  check("inputs carry password-manager ignore attributes", pmAttrs);
  await page.locator(".onb-fields .onb-input").fill("http://localhost:8082/playlist.m3u");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const m3uOk = await page.waitForSelector(".onb-hint--ok", { timeout: 10000 }).then(() => true).catch(() => false);
  check("M3U verification succeeds", m3uOk);
  await page.waitForSelector(".onb-swatches", { timeout: 8000 });
  const m3uSaved = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem("blammytv.playlists") ?? "{}").data ?? [])[0]);
  check("m3u playlist saved",
    m3uSaved?.kind === "m3u" && m3uSaved?.url === "http://localhost:8082/playlist.m3u",
    JSON.stringify(m3uSaved));
  await page.close();
}

// 5c. Back navigation: button + Escape walk backwards; hidden on step 0.
if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  check("no Back on the logo step", !(await page.$(".onb-back")));
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.getByRole("button", { name: "← Back" }).click();
  const backToStreams = await page.waitForSelector(".onb-input", { timeout: 8000 }).then(() => true).catch(() => false);
  check("Back returns from Live TV to streams", backToStreams);
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  const backToLogo = await page.waitForSelector(".onb-lockup", { timeout: 8000 }).then(() => true).catch(() => false);
  check("Escape steps back to the logo", backToLogo);
  await page.close();
}

// 6. Skip setup: straight to the one-piece finale, nothing saved, marked
//    done — and the finale is NOT input-skippable (unlike a cold boot).
if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Skip setup" }).click();
  const landing = await page.waitForSelector(".boot-scene.is-landing", { timeout: 10000 }).then(() => true).catch(() => false);
  // Input during the finale must not dismiss the overlay.
  await page.keyboard.press("Enter");
  await page.mouse.click(800, 450);
  await page.waitForTimeout(250);
  const stillUp = await page.evaluate(() => !!document.querySelector(".onb"));
  const state = await page.evaluate(() => ({
    onboarded: localStorage.getItem("btv:onboarded"),
    aio: localStorage.getItem("blammytv.aiostreams"),
    welcomeUp: !!document.querySelector(".boot-overlay"),
  }));
  check("skip: marked done, nothing saved, finale plays and is not skippable",
    landing && stillUp && state.onboarded === "1" && state.aio === null && !state.welcomeUp,
    JSON.stringify({ ...state, landing, stillUp }));
  await page.close();
}

// 7. Reduced motion: full skip-through works, no boot phase, quick release.
if (!FAST) {
  const page = await newPage({}, { reducedMotion: "reduce" });
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.getByRole("button", { name: /later/ }).click(); // streams
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click(); // live tv
  await page.waitForSelector(".onb-swatches", { timeout: 8000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-chips:not(.onb-chips--labeled)", { timeout: 8000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Enter BlammyTV" }).click();
  // No timeline for reduced motion: the finale is a quick fade to the app.
  await page.waitForTimeout(300);
  const landingClass = await page.evaluate(() =>
    !!document.querySelector(".boot-scene.is-landing"));
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    onbGone: !document.querySelector(".onb"),
    welcomeUp: !!document.querySelector(".boot-overlay"),
    onboarded: localStorage.getItem("btv:onboarded"),
  }));
  check("reduced motion: completes instantly, timeline never starts",
    state.onbGone && !state.welcomeUp && !landingClass && state.onboarded === "1",
    JSON.stringify({ ...state, landingClass }));
  await page.close();
}

// 8. Enter key drives the flow.
if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  // Retry-press: on an overloaded box the first frame can lag well past
  // the effect that attaches the listener — a human would tap again.
  // Success = the LOGO STEP was left.
  let advanced = false;
  for (let i = 0; i < 5 && !advanced; i++) {
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    advanced = await page
      .waitForFunction(() => !document.querySelector(".onb-lockup"), null, { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
  }
  check("Enter advances from the logo step", advanced);
  await page.close();
}

// 9. Cold boot: the same one-piece scene plays inside .boot-overlay
//    (mini steps-state entrance → full timeline). Assert the frame's
//    rule actually APPLIES (the v0.4.32 star-slash lesson: a dead rule
//    must never ship green), the shrink really lands on the tile, the
//    paint carries no infinite animation (the hue spin is dead), and
//    skip-on-input works.
if (!FAST) {
  const page = await newPage({ "btv:onboarded": "1" });
  await page.goto("http://localhost:4173/?welcome=1");
  await page.waitForSelector(".boot-overlay", { timeout: 8000 });
  const applied = await page.$eval(".boot-frame", (el) => ({
    h: el.getBoundingClientRect().height,
    screenBlur: getComputedStyle(document.querySelector(".boot-screen")).filter,
  }));
  check("cold boot: scene styles apply (frame full-size, screen blurred)",
    applied.h > 100 && /blur\(/.test(applied.screenBlur),
    JSON.stringify(applied));
  const spins = await page.evaluate(() =>
    document.getAnimations().some((a) =>
      a.effect?.getTiming?.().iterations === Infinity));
  check("cold boot: no infinite paint animation (hue spin is dead)", !spins);
  // Entrance (900ms) + landing (830ms) + shrink lands 660ms later: the
  // frame must have left fullscreen for the tile.
  await page.waitForTimeout(3000);
  const shrunk = await page.$eval(".boot-frame", (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check("cold boot: the frame shrinks into the lockup tile",
    shrunk.w < 300 && shrunk.h < 300, JSON.stringify(shrunk));
  await page.close();
}

// 10. Cold boot skip: any input dismisses it immediately.
if (!FAST) {
  const page = await newPage({ "btv:onboarded": "1" });
  await page.goto("http://localhost:4173/?welcome=1");
  await page.waitForSelector(".boot-overlay", { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  const gone = await page
    .waitForFunction(() => !document.querySelector(".boot-overlay"), null, { timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  check("cold boot: input skips it immediately", gone);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
