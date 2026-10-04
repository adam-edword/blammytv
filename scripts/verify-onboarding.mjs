// E2E: first-run onboarding — gate behavior, full walk with REAL
// verification (fake-aio :8084 + fake-panel :8081), blocked-instance
// verdict, saves, finale hand-off, reduced-motion, skip.
//
// The walk runs in a plain browser, which is a build that cannot sign in, so
// step 1 is the manifest step it always was. The AIOStreams sign-in (plan 024),
// the follow step and the tour are walked in a page with the native side
// stubbed (section 11 on): a code and its approval, the manifest fallback
// verifying for real, the follow step shown with configured stubs and skipped
// both ways with none, Back across the skipped step.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const FAST = process.env.FAST === "1"; // FAST=1: core walk only (iteration); full suite = pre-push gate
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

/** The tour's three things, as the step says them. */
const TOUR = [
  ["Multi-view", "Up to four channels at once. Right-click a channel in the Guide to add it."],
  ["Discover", "Search your catalogs, or browse them by genre."],
  ["Sports", "Today\u2019s games, with the channels showing them."],
];

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
    !!okMsg && /Connected, 5 catalogs found/.test(okMsg), String(okMsg));

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

  await page.waitForSelector(".onb-prefs", { timeout: 8000 });
  const pl = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.playlists") ?? "{}").data ?? []);
  check("xtream playlist saved on successful verify",
    pl.length === 1 && pl[0].kind === "xtream" && pl[0].server === "http://localhost:8081"
      && pl[0].username === "u" && pl[0].enabled === true,
    JSON.stringify(pl));

  // Accent (v0.9.97): Settings' own picker, back on this step.
  const accentGroup = page.getByRole("group", { name: "Accent color" });
  check("step 3 carries the accent picker", (await accentGroup.count()) === 1);
  await accentGroup.getByRole("button", { name: "Blue", exact: true }).click();
  const picked = await page.evaluate(() => ({
    inline: document.documentElement.style.getPropertyValue("--accent"),
    stored: JSON.parse(localStorage.getItem("blammytv.accent") ?? "{}"),
  }));
  check("a swatch applies the accent and saves it on envelope v2",
    picked.inline === "#3730ff" && picked.stored.v === 2 && picked.stored.data === "#3730ff",
    JSON.stringify(picked));

  // Clock.
  await page.getByRole("button", { name: "24h", exact: true }).click();
  const clock = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.clockFormat") ?? "{}").data);
  check("clock chip saves", clock === "24h", String(clock));
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Startup tab.
  await page.waitForSelector(".onb-stage > .onb-chips", { timeout: 8000 });
  // Scoped: the header's own tabs are in the DOM behind the overlay. Stream
  // first, then Live TV: each click saves, and the app has to open on the
  // last one (checked once the overlay lets go).
  await page.locator(".onb").getByRole("button", { name: "Stream", exact: true }).click();
  const startup = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.startupTab") ?? "{}").data);
  check("startup pill saves the choice", startup === "stream", String(startup));
  await page.locator(".onb").getByRole("button", { name: "Live TV", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // The tour (plan 024): a few things to find, a line each, before the finale.
  await page.waitForSelector(".onb-tour", { timeout: 8000 });
  const tourTitle = await page.$eval(".onb-title", (el) => el.textContent);
  const tour = await page.$$eval(".onb-tour li", (lis) =>
    lis.map((li) => [li.querySelector(".onb-tour__name")?.textContent, li.querySelector(".onb-tour__line")?.textContent]));
  check("the tour is titled and has exactly three things to find, a line each",
    tourTitle === "A few things to find" && JSON.stringify(tour) === JSON.stringify(TOUR),
    JSON.stringify({ tourTitle, tour }));
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Done: the Settings nudge, then the hand-off.
  await page.getByRole("button", { name: "Enter BlammyTV" }).waitFor({ timeout: 8000 });
  const nudge = await page.$$eval(".onb-sub", (els) => els.map((e) => e.textContent).join(" "));
  check("finale shows the Settings nudge", /Settings holds a lot more/.test(nudge), nudge);
  // Until v0.9.98 this step drew a map of the 0.9.0 nav as two filled
  // pills that were not buttons (Adam: "those look like buttons you can
  // click but they don't do anything"). The rule, not the old class name:
  // anything filled and pill-round on this step has to be a real button.
  const fakes = await page.$$eval(".onb-stage *", (els) =>
    els
      .filter((el) => {
        if (el.closest("button")) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const pill = r.height > 16 && parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 1;
        const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0;
        return pill && filled;
      })
      .map((el) => el.textContent.trim()));
  check("finale: nothing looks like a button that is not one", fakes.length === 0, JSON.stringify(fakes));
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
  const kept = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--accent"));
  check("the accent picked on step 3 is still on once the app is up", kept === "#3730ff", kept);
  // Where it opens: the Guide, as picked, now that a playlist is set up.
  // The section was decided at mount, before either, and a first run came
  // out on Stream.
  const openedOn = await page.evaluate(() =>
    document.querySelector("[data-dest][aria-current='page']")?.getAttribute("data-dest") ?? "nowhere");
  check("and it opens where the startup step said, the Guide", openedOn === "guide", openedOn);
  await page.close();
}

// 4b. Back, then Continue again (v0.11.3, audit S2). Back keeps the form
//     filled, and the second Continue used to ADD the playlist again as
//     "Xtream Playlist 2", so the Guide showed every channel twice. And a
//     check still running when Back is pressed used to land, arm the
//     auto-advance and push the step forward again.
const toTvStep = async (page) => {
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
};
const fillXtream = async (page) => {
  const fields = page.locator(".onb-fields .onb-input");
  await fields.nth(0).fill("http://localhost:8081");
  await fields.nth(1).fill("u");
  await fields.nth(2).fill("p");
};
const savedPlaylists = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.playlists") ?? "{}").data ?? []);
if (!FAST) {
  const page = await newPage();
  await toTvStep(page);
  await fillXtream(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 10000 });
  const first = await savedPlaylists(page);
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  const kept = await page.locator(".onb-fields .onb-input").nth(0).inputValue();
  check("Back keeps the form filled", kept === "http://localhost:8081", kept);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 10000 });
  const again = await savedPlaylists(page);
  check("Continue again on the same form saves one playlist, not two",
    first.length === 1 && again.length === 1 && again[0].id === first[0].id
      && again[0].name === "Xtream Playlist 1",
    JSON.stringify({ first: first.map((p) => p.name), again: again.map((p) => p.name) }));

  // Changing the form between the two replaces that one playlist's fields.
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.locator(".onb-fields .onb-input").nth(1).fill("u2");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 10000 });
  const edited = await savedPlaylists(page);
  check("and an edited form replaces that playlist's fields",
    edited.length === 1 && edited[0].id === first[0].id && edited[0].username === "u2",
    JSON.stringify(edited.map((p) => [p.id === first[0].id, p.username])));
  await page.close();
}

// The replay for an existing user: Continue on the TV step must add beside
// what they have and leave it alone, even on a second Continue.
if (!FAST) {
  const page = await newPage({
    "blammytv.playlists": JSON.stringify({ v: 1, data: [{ id: "mine", kind: "m3u", name: "Mine", enabled: true, url: "http://localhost:8082/playlist.m3u" }] }),
  });
  await toTvStep(page);
  await fillXtream(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 10000 });
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 10000 });
  const list = await savedPlaylists(page);
  check("a replay adds beside the existing playlist and never replaces it",
    list.length === 2 && list[0].id === "mine" && list[0].name === "Mine" && list[1].kind === "xtream",
    JSON.stringify(list.map((p) => [p.id.slice(0, 4), p.name])));
  await page.close();
}

// Back while a check is still running: it lands, and the step stays put.
if (!FAST) {
  const page = await newPage();
  await toTvStep(page);
  await fillXtream(page);
  let release;
  const gate = new Promise((r) => (release = r));
  let held = 0;
  await page.route("http://localhost:8081/player_api.php*", async (route) => {
    held++;
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Connecting…" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-input:not(.onb-fields .onb-input)", { timeout: 8000 });
  release();
  // The dwell (750ms) plus the swap (400ms) is the longest the old code
  // needed to be on the next step; wait well past it.
  await page.waitForTimeout(2500);
  const saved = await savedPlaylists(page);
  const where = await page.evaluate(() => ({
    streams: !!document.querySelector(".onb-input") && !document.querySelector(".onb-fields"),
    tv: !!document.querySelector(".onb-fields"),
    prefs: !!document.querySelector(".onb-prefs"),
  }));
  check("the held check really landed (its playlist is saved)",
    held > 0 && saved.length === 1, JSON.stringify({ held, saved: saved.length }));
  check("Back during a Live TV check: the step stays on streams once it lands",
    where.streams && !where.tv && !where.prefs, JSON.stringify(where));
  await page.close();
}

if (!FAST) {
  const page = await newPage();
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  let release;
  const gate = new Promise((r) => (release = r));
  let held = 0;
  await page.route("http://localhost:8084/**", async (route) => {
    held++;
    await gate;
    await route.continue();
  });
  await page.locator(".onb-input").fill("http://localhost:8084/manifest.json");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Connecting…" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-lockup", { timeout: 8000 });
  release();
  await page.waitForTimeout(2500);
  const aio = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blammytv.aiostreams") ?? "{}").data);
  const where = await page.evaluate(() => ({
    logo: !!document.querySelector(".onb-lockup"),
    streams: !!document.querySelector(".onb-input"),
    tv: !!document.querySelector(".onb-fields"),
  }));
  check("the held streams check really landed (the manifest is saved)",
    held > 0 && aio === "http://localhost:8084/manifest.json", JSON.stringify({ held, aio }));
  check("Back during a streams check: the step stays on the logo once it lands",
    where.logo && !where.streams && !where.tv, JSON.stringify(where));
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
  await page.getByRole("tab", { name: "M3U", exact: true }).click();
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
  await page.waitForSelector(".onb-prefs", { timeout: 8000 });
  const m3uSaved = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem("blammytv.playlists") ?? "{}").data ?? [])[0]);
  check("m3u playlist saved",
    m3uSaved?.kind === "m3u" && m3uSaved?.url === "http://localhost:8082/playlist.m3u",
    JSON.stringify(m3uSaved));
  await page.close();
}

// 5d. The accent picker's Custom popover. The overlay counter-zooms the UI
//     scale, so the popover portals INTO it: on <body> at scale 1.2 it
//     opened 190px right of its chip and 101px low. The scale-1 run cannot
//     see that, so the 1.2 check is the one that guards it.
//     It never painted BEHIND the overlay, despite the overlay's z-index
//     1000: .app-shell isolates, so that 1000 only counts inside the shell
//     and a body popover's 70 beats it. The hit-test keeps it that way.
//     Both keys also belong to the popover while it is open: Escape closes
//     it without stepping back, Enter on the colour square does not advance.
const toAccentStep = async (page) => {
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.waitForSelector(".onb-input", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 8000 });
  // Settled, so the entrance is not still moving the chip.
  await page.waitForTimeout(1800);
};
const openCustom = async (page) => {
  await page
    .getByRole("group", { name: "Accent color" })
    .getByRole("button", { name: /Custom/ })
    .click();
  await page.locator("[data-slot='popover-content']").waitFor({ timeout: 5000 });
  return page.evaluate(async () => {
    const el = document.querySelector("[data-slot='popover-content']");
    await Promise.all(el.getAnimations().map((a) => a.finished));
    const p = el.getBoundingClientRect();
    const t = document
      .querySelector("[aria-label='Accent color'] [data-slot='popover-trigger']")
      .getBoundingClientRect();
    const hit = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2);
    return {
      onTop: !!hit && el.contains(hit),
      dx: Math.round(p.left - t.left),
      gap: Math.round(p.top - t.bottom),
    };
  });
};
const underChip = (at) => Math.abs(at.dx) <= 1 && at.gap >= 2 && at.gap <= 6;
if (!FAST) {
  const page = await newPage();
  await toAccentStep(page);
  const at = await openCustom(page);
  check("custom popover paints above the onboarding overlay", at.onTop, JSON.stringify(at));
  check("custom popover opens under its chip", underChip(at), JSON.stringify(at));

  await page.locator("[data-slot='popover-content'] [role='slider']").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const afterEnter = await page.evaluate(() => ({
    pop: !!document.querySelector("[data-slot='popover-content']"),
    step3: !!document.querySelector(".onb-prefs"),
  }));
  check("Enter on the colour square does not advance the step",
    afterEnter.pop && afterEnter.step3, JSON.stringify(afterEnter));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const afterEsc = await page.evaluate(() => ({
    pop: !!document.querySelector("[data-slot='popover-content']"),
    step3: !!document.querySelector(".onb-prefs"),
  }));
  check("Escape closes the popover and stays on the step",
    !afterEsc.pop && afterEsc.step3, JSON.stringify(afterEsc));
  await page.keyboard.press("Escape");
  const stepped = await page.waitForSelector(".onb-fields", { timeout: 8000 }).then(() => true).catch(() => false);
  check("with it closed, Escape steps back as before", stepped);
  // Plain browser: no Trakt or MyAnimeList key, so the follow step between
  // Live TV and this one is not there. Back lands on Live TV, not on it.
  check("  across the skipped follow step: Live TV, not an empty step between",
    !(await page.$(".onb-accounts")) && (await page.$eval(".onb-title", (el) => el.textContent)) === "Connect Live TV");
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
  await page.waitForSelector(".onb-prefs", { timeout: 8000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-stage > .onb-chips", { timeout: 8000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-tour", { timeout: 8000 });
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
  // Entrance (900ms) + landing (830ms) + concentric shrink lands 737ms
  // later; the spring settles by ~3590 abs. Poll from the CDP side —
  // headless suspends the page's frame pipeline (rAF + animation
  // timeline) when nothing external touches it, so a fixed
  // waitForTimeout can measure a frozen mid-animation frame; each
  // polled evaluate wakes the renderer.
  let shrunk = { w: Infinity, h: Infinity };
  for (let i = 0; i < 100 && !(shrunk.w < 300 && shrunk.h < 300); i++) {
    await page.waitForTimeout(100);
    shrunk = await page.$eval(".boot-frame", (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }).catch(() => shrunk);
  }
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

// 11. The AIOStreams sign-in, the follow step and the tour (plan 024), in a
//     page with the native side stubbed. `o`: connected (the vault holds a
//     sign-in), old (a build from before the sign-in), noSources (one from
//     before aiojf_sources), start ("unsupported"), trakt / mal (this build
//     has the app key), poll ("never": the code is never approved).
const BASE = "http://127.0.0.1:9/jellyfin";
const CONFIGURE = "http://127.0.0.1:9/stremio/configure";
const tauriStub = ({ o, base, configure }) => {
  window.__calls = [];
  window.__copied = [];
  window.__connected = !!o.connected;
  let polls = 0;
  let cb = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => (window.__copied.push(t), Promise.resolve()) },
  });
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      // The forensic GET behind a failed step: what answered, and how its body starts.
      if (cmd === "http_probe")
        return fetch(args.url).then(async (r) => {
          const headers = {};
          r.headers.forEach((v, k) => (headers[k] = v));
          return JSON.stringify({ status: r.status, headers, bodyHead: (await r.text()).slice(0, 600) });
        });
      if (cmd.startsWith("aiojf_") && o.old) return Promise.reject(`Command ${cmd} not found`);
      if (cmd === "aiojf_status")
        return Promise.resolve(window.__connected ? { connected: true, userName: "Adam", userId: "u1", base } : { connected: false });
      if (cmd === "aiojf_sources") {
        if (o.noSources) return Promise.reject("Command aiojf_sources not found");
        // As aiojf.rs: an id that is not 32 lower case hex is refused before a request.
        return Promise.reject("refused: not an AIOStreams item id");
      }
      if (cmd === "aiojf_start") {
        if (o.start === "unsupported") return Promise.reject("unsupported: no Jellyfin side on this instance");
        return Promise.resolve({ code: "654321", expiresIn: 600, configureUrl: configure });
      }
      if (cmd === "aiojf_poll") {
        if (o.poll === "never") return Promise.resolve("pending");
        if (++polls < 2) return Promise.resolve("pending");
        window.__connected = true;
        return Promise.resolve("approved");
      }
      if (cmd === "aiojf_request") return Promise.resolve({ status: 200, body: JSON.stringify({ Items: [], TotalRecordCount: 0 }) });
      if (cmd === "aiojf_disconnect") {
        window.__connected = false;
        return Promise.resolve();
      }
      if (cmd === "trakt_status") return Promise.resolve({ configured: !!o.trakt, connected: false });
      if (cmd === "mal_status") return Promise.resolve({ configured: !!o.mal, connected: false });
      if (cmd === "trakt_device_start")
        return Promise.resolve({ user_code: "TRAKT123", verification_url: "https://trakt.tv/activate", expires_in: 600, interval: 5 });
      if (cmd === "trakt_device_poll") return Promise.resolve("pending");
      if (cmd === "mal_sign_in_start") return Promise.resolve("https://myanimelist.net/v1/oauth2/authorize?x=1");
      if (cmd === "mal_sign_in_poll") return Promise.resolve({ at: "waiting" });
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
};
const newTauriPage = async (o = {}, init = {}) => {
  const page = await newPage(init);
  // Offline, as every harness is: only localhost answers.
  await page.context().route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  await page.addInitScript(tauriStub, { o, base: BASE, configure: CONFIGURE });
  await page.goto("http://localhost:4173/?onboarding=1");
  await page.waitForSelector(".onb");
  return page;
};
const titleOf = (page) => page.$eval(".onb-title", (el) => el.textContent).catch(() => "");
const callsOf = (page, cmd) => page.evaluate((c) => window.__calls.filter(([n]) => n === c).map(([, a]) => a), cmd);
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
/** The screen the overlay is on, by what only it has. */
const whereIs = (page) =>
  page.evaluate(() => {
    const t = document.querySelector(".onb-title")?.textContent ?? "";
    return t || (document.querySelector(".onb-lockup") ? "logo" : "");
  });
const toStep1 = async (page) => {
  await page.getByRole("button", { name: "Get Started" }).click();
  await page.locator(".onb-title", { hasText: /Sign in to AIOStreams|Bring your streams/ }).waitFor({ timeout: 8000 });
};

// 11a. The sign-in: the address, a code, an approval that advances on its own.
if (!FAST) {
  const page = await newTauriPage({ trakt: true, mal: true });
  await toStep1(page);
  const sub = await page.$$eval(".onb-sub", (els) => els.map((e) => e.textContent).join(" "));
  const input = page.getByPlaceholder("aiostreams.example.com", { exact: true });
  check("step 1 is the sign-in: a title, the syncs-too line, an address field",
    (await titleOf(page)) === "Sign in to AIOStreams" && /Signing in also syncs what you watch with your other AIOStreams apps\./.test(sub) && (await input.count()) === 1,
    JSON.stringify({ title: await titleOf(page), sub }));
  check("  the manifest and \"I'll do this later\" are one click away, quietly",
    (await page.getByRole("button", { name: "Use a manifest URL instead" }).count()) === 1 &&
      (await page.getByRole("button", { name: /later/ }).count()) === 1 &&
      (await page.locator(".onb-input[placeholder*='manifest']").count()) === 0);
  await input.fill("aiostreams.example.com");
  await input.press("Enter");
  const code = await page.locator(".onb-code").innerText({ timeout: 8000 }).catch(() => "");
  const starts = await callsOf(page, "aiojf_start");
  check("Enter on the address starts the code with it, shown large",
    code === "654321" && starts.length === 1 && starts[0].manifestUrl === "aiostreams.example.com", JSON.stringify({ code, starts }));
  const selectable = await page.locator(".onb-code").evaluate((el) => getComputedStyle(el).userSelect);
  const fontSize = await page.locator(".onb-code").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole("button", { name: "Copy code" }).click();
  check("  the code is big, can be selected, and its button copies it",
    fontSize >= 32 && selectable === "text" && JSON.stringify(await page.evaluate(() => window.__copied)) === JSON.stringify(["654321"]),
    JSON.stringify({ fontSize, selectable }));
  check("  and says where to approve it",
    /Save & Install, Jellyfin apps, Connect/.test(await page.$eval(".onb-sub", (e) => e.textContent)));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/onb-signin-code.png` });
  await page.getByRole("button", { name: "Open AIOStreams" }).click();
  const opened = await callsOf(page, "open_external");
  check("  Open AIOStreams copies it and opens the configure page through the app",
    opened[0]?.url === CONFIGURE && (await page.evaluate(() => window.__copied.length)) === 2, JSON.stringify(opened));
  // Approved on the second poll: no click, it moves on by itself.
  const ok = await page.waitForSelector(".onb-hint--ok", { timeout: 14_000 }).then((el) => el.textContent()).catch(() => null);
  check("an approval says who signed in", /Signed in as Adam/.test(String(ok)), String(ok));
  const advanced = await page.waitForSelector(".onb-fields", { timeout: 8000 }).then(() => true).catch(() => false);
  check("  and advances on its own, as a verified step does", advanced);
  const si = (await stored(page, "aiojf"))?.signedIn;
  check("  the sign-in is recorded on this device, with no token", si?.userName === "Adam" && JSON.stringify(si) === JSON.stringify({ base: BASE, userName: "Adam" }), JSON.stringify(si));
  check("  and nothing was written for a manifest", !(await stored(page, "aiostreams")));
  // Back to the step: it says so, rather than asking again.
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-hint--ok", { timeout: 8000 });
  check("Back to a signed-in step shows Continue, not another code",
    (await page.getByRole("button", { name: "Continue", exact: true }).count()) === 1 && (await page.locator(".onb-input").count()) === 0 && (await callsOf(page, "aiojf_start")).length === 1);
  await page.close();
}

// 11b. The follow step: shown with configured stubs, one Connect each, and
//      Back across it. Then the tour, and Back from the tour.
if (!FAST) {
  const page = await newTauriPage({ trakt: true, mal: true });
  await toStep1(page);
  await page.getByRole("button", { name: /later/ }).click(); // sign in later
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click(); // live tv later
  await page.waitForSelector(".onb-accounts", { timeout: 8000 });
  check("with Trakt and MyAnimeList keys, the step after Live TV is Follow what you watch",
    (await titleOf(page)) === "Follow what you watch", await titleOf(page));
  const sub = await page.$eval(".onb-sub", (e) => e.textContent);
  check("  one line on why", sub.replace(/\s+/g, " ") === "Trakt and MyAnimeList keep track of what you watch here, and bring back what you watched elsewhere.", sub);
  const rows = page.locator(".onb-accounts .customize-row__title");
  await rows.first().waitFor({ timeout: 8000 });
  await page.locator(".onb-accounts .mal-row").waitFor({ timeout: 8000 });
  check("  a Trakt row and a MyAnimeList row, each with a Connect, and Continue is there",
    JSON.stringify(await rows.allInnerTexts()) === JSON.stringify(["Trakt", "MyAnimeList"]) &&
      (await page.locator(".onb-accounts").getByRole("button", { name: "Connect", exact: true }).count()) === 2 &&
      (await page.getByRole("button", { name: "Continue", exact: true }).count()) === 1,
    JSON.stringify(await rows.allInnerTexts()));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/onb-follow.png` });
  // The rows are Settings' own: Trakt's Connect shows its code here too.
  await page.locator(".onb-accounts .trakt-row").getByRole("button", { name: "Connect", exact: true }).click();
  const traktCode = await page.locator(".onb-accounts .trakt-row__code").innerText({ timeout: 5000 }).catch(() => "");
  check("  Trakt's Connect is Settings' flow: its code, here", traktCode === "TRAKT123", traktCode);
  // MyAnimeList's Connect opens its page and waits, as in Settings.
  await page.locator(".onb-accounts .mal-row").getByRole("button", { name: "Connect", exact: true }).click();
  const malOpen = await page.locator(".onb-accounts .mal-row").getByRole("button", { name: "Open MyAnimeList" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("  and so is MyAnimeList's", malOpen && (await callsOf(page, "mal_sign_in_start")).length === 1);
  // Continue always works, with nothing connected.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForSelector(".onb-prefs", { timeout: 8000 });
  check("Continue with nothing connected goes on to Make it yours", (await titleOf(page)) === "Make it yours");
  // The tour's Back lands on the start step, and Back from there on this one.
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-accounts", { timeout: 8000 });
  check("Back from Make it yours returns to Follow what you watch", (await titleOf(page)) === "Follow what you watch");
  // A sign-in left half done is closed with the step: MAL's port is given back.
  check("  leaving it cancelled the MyAnimeList sign-in that was waiting", (await callsOf(page, "mal_sign_in_cancel")).length >= 1);
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  check("  and Back again, Live TV", (await titleOf(page)) === "Connect Live TV");
  await page.close();
}

// 11c. Only one of the two has a key: only that one shows.
if (!FAST) {
  const page = await newTauriPage({ mal: true });
  await toStep1(page);
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-accounts", { timeout: 8000 });
  await page.locator(".onb-accounts .mal-row").waitFor({ timeout: 8000 });
  check("a service whose app key is not in the build does not show",
    (await page.locator(".onb-accounts .trakt-row").count()) === 0 && (await page.locator(".onb-accounts .mal-row").count()) === 1);
  await page.close();
}

// 11d. Neither has a key: the step is skipped, going forward and going back.
if (!FAST) {
  const page = await newTauriPage({});
  await toStep1(page);
  await page.getByRole("button", { name: /later/ }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 });
  await page.getByRole("button", { name: /later/ }).click();
  // The step after Live TV is the one on screen, not an empty one in between.
  // (A miss is a failed check here, not a throw: a step that is not skipped
  // never shows the next one's controls.)
  await page.waitForSelector(".onb-prefs", { timeout: 8000 }).catch(() => null);
  check("with neither key, the step after Live TV is Make it yours",
    (await titleOf(page)) === "Make it yours" && (await page.locator(".onb-accounts").count()) === 0, await titleOf(page));
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-fields", { timeout: 8000 }).catch(() => null);
  check("  and Back from it is Live TV", (await titleOf(page)) === "Connect Live TV" && (await page.locator(".onb-accounts").count()) === 0);
  await page.close();
}

// 11e. "Use a manifest URL instead" is today's step, verifying for real.
if (!FAST) {
  const page = await newTauriPage({});
  await toStep1(page);
  await page.getByRole("button", { name: "Use a manifest URL instead" }).click();
  const manifestField = page.getByPlaceholder(/manifest\.json/);
  await manifestField.waitFor({ timeout: 8000 });
  check("\"Use a manifest URL instead\" swaps in the manifest field, with a way back",
    (await page.getByPlaceholder("aiostreams.example.com", { exact: true }).count()) === 0 &&
      (await page.getByRole("button", { name: "Sign in with an address instead" }).count()) === 1);
  await manifestField.fill("http://localhost:8084/manifest.json");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const okMsg = await page.waitForSelector(".onb-hint--ok", { timeout: 10000 }).then((el) => el.textContent()).catch(() => null);
  check("  the manifest still verifies for real: the catalog count", !!okMsg && /Connected, 5 catalogs found/.test(okMsg), String(okMsg));
  const advanced = await page.waitForSelector(".onb-fields", { timeout: 8000 }).then(() => true).catch(() => false);
  check("  saves, and advances", advanced && (await stored(page, "aiostreams")) === "http://localhost:8084/manifest.json");
  check("  and started no sign-in", (await callsOf(page, "aiojf_start")).length === 0);
  await page.close();
}
if (!FAST) {
  // The blocked instance's verdict still shows over the fallback.
  const page = await newTauriPage({});
  await toStep1(page);
  await page.getByRole("button", { name: "Use a manifest URL instead" }).click();
  await page.getByPlaceholder(/manifest\.json/).fill("http://localhost:8084/cf/manifest.json");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const verdict = await page.waitForSelector(".onb-hint:not(.onb-hint--ok)", { timeout: 12000 }).then((el) => el.textContent()).catch(() => null);
  check("a blocked instance behind the fallback names bot protection and offers Continue anyway",
    !!verdict && /bot protection/.test(verdict) && (await page.getByRole("button", { name: "Continue anyway" }).count()) === 1, String(verdict).slice(0, 80));
  await page.close();
}

// 11f. The sign-in's edges.
if (!FAST) {
  // A build from before the sign-in: today's manifest step, nothing else.
  const page = await newTauriPage({ old: true });
  await toStep1(page);
  check("a native build from before the sign-in gets today's manifest step",
    (await titleOf(page)) === "Bring your streams" && (await page.getByPlaceholder("aiostreams.example.com", { exact: true }).count()) === 0 &&
      (await page.getByRole("button", { name: "Use a manifest URL instead" }).count()) === 0 && (await page.getByPlaceholder(/manifest\.json/).count()) === 1,
    await titleOf(page));
  await page.close();
}
if (!FAST) {
  // Signed in before onboarding (a replay): it says so and goes on.
  const page = await newTauriPage({ connected: true });
  await toStep1(page);
  await page.waitForSelector(".onb-hint--ok", { timeout: 8000 });
  const msg = await page.$eval(".onb-hint--ok", (e) => e.textContent);
  check("a replay for someone already signed in says so, with no address to type",
    /Signed in as Adam/.test(msg) && (await page.locator(".onb-input").count()) === 0 && (await page.getByRole("button", { name: "Continue", exact: true }).count()) === 1, msg);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  check("  and Continue goes on to Live TV", await page.waitForSelector(".onb-fields", { timeout: 8000 }).then(() => true).catch(() => false));
  await page.close();
}
if (!FAST) {
  // An instance with no Jellyfin side: the reason, and the step is not stuck.
  const page = await newTauriPage({ start: "unsupported" });
  await toStep1(page);
  await page.getByPlaceholder("aiostreams.example.com", { exact: true }).fill("aiostreams.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const said = await page.waitForSelector(".onb-hint", { timeout: 8000 }).then((el) => el.textContent()).catch(() => null);
  check("an instance with no Jellyfin side says it needs 2.35 with its Jellyfin side on",
    /needs version 2\.35 or later, with its Jellyfin side on/.test(String(said)), String(said));
  await page.getByRole("button", { name: /later/ }).click();
  check("  and \"I'll do this later\" still goes on", await page.waitForSelector(".onb-fields", { timeout: 8000 }).then(() => true).catch(() => false));
  await page.close();
}
if (!FAST) {
  // Back with a code up ends the attempt: it never approves anything later.
  const page = await newTauriPage({ poll: "never" });
  await toStep1(page);
  await page.getByPlaceholder("aiostreams.example.com", { exact: true }).fill("aiostreams.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator(".onb-code").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector(".onb-lockup", { timeout: 8000 });
  const polls = (await callsOf(page, "aiojf_poll")).length;
  await page.waitForTimeout(7000);
  check("Back with a code up leaves the step and stops polling for it",
    (await callsOf(page, "aiojf_poll")).length === polls && (await whereIs(page)) === "logo", `${polls} polls at Back`);
  await page.close();
}
if (!FAST) {
  // Skip setup and the finale are what they were with the sign-in step in.
  const page = await newTauriPage({ trakt: true });
  await page.getByRole("button", { name: "Skip setup" }).click();
  const landing = await page.waitForSelector(".boot-scene.is-landing", { timeout: 10000 }).then(() => true).catch(() => false);
  check("with the sign-in step in the flow, Skip setup still goes straight to the finale", landing);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
