// Headless verify: Fluent's Stream screens (plan 035, "Fluent to tier 3"):
// Stream's home and Home, a film's page and its sources, a series' episodes,
// Discover's body and REC, in BOTH faces, then Default again.
//
// Every interaction is the screen's own, so each check asks the thing a user
// would: a play is the native player being asked to open the right file
// (`inv_open`, the stub below), a filter is the rows that stay, a type is the
// cards that come back. The addon's stream list for the film is routed to a
// set whose Best Match and Quality orders DIFFER, or a Sort that did nothing
// would pass.
//
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-fluent-stream.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const FAKE = "http://localhost:8084";
const SHOTS = process.env.SHOT_DIR;

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** The film's stream list: Best Match (cached, then unmarked, then not
 * cached, the addon's order inside each) is 480p, 720p, 1080p, 2160p; Quality
 * is the reverse. */
const STREAMS = [
  { name: "⏳ 1080p | Debrid", description: "Custom 1080p\n4.2GB\nEnglish, French", url: `${FAKE}/video/c-1080.mp4`, behaviorHints: { bingeGroup: "x|1080p" } },
  { name: "⚡ 480p | Debrid", description: "Custom 480p\n0.9GB", url: `${FAKE}/video/c-480.mp4`, behaviorHints: { bingeGroup: "x|480p" } },
  { name: "⏳ 2160p | Debrid", description: "Custom 2160p\n22GB", url: `${FAKE}/video/c-2160.mp4`, behaviorHints: { bingeGroup: "x|2160p" } },
  { name: "720p | Direct", description: "Custom 720p\n1.6GB", url: `${FAKE}/video/c-720.mp4`, behaviorHints: { bingeGroup: "x|720p" } },
];

const entryOf = (id, title, n, over = {}) => ({
  id,
  title,
  kind: "series",
  episodeId: `${id}:1:${n}`,
  season: 1,
  episode: n,
  epTitle: `S1E${n} Title`,
  label: `S1 · E${n}: S1E${n} Title`,
  posSec: 600,
  durSec: 3000,
  at: Date.now(),
  ...over,
});

/**
 * A page on Fluent, in a face. `tauri` stubs the native side, so a play can be
 * seen as the player being asked to open a file; `streams` routes the film's
 * stream list; `store` is written under blammytv.*.
 */
async function open(face, { tauri = false, store = {}, streams = null, tmdb = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: face });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  if (tmdb) {
    await ctx.route(/api\.themoviedb\.org/, (route) => {
      const u = new URL(route.request().url());
      let body = {};
      if (u.pathname.includes("/genre/")) body = { genres: [{ id: 27, name: "Horror" }] };
      else if (u.pathname.endsWith("/search/keyword")) body = { results: [{ id: 9882, name: u.searchParams.get("query") }] };
      else if (u.pathname.includes("/discover/")) body = { results: [{ id: 348, title: "Alien", release_date: "1979-05-25" }] };
      else if (u.pathname.includes("external_ids")) body = { imdb_id: "tt100001" };
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
  }
  if (streams)
    await ctx.route(/\/stream\/movie\/tt100001\.json/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ streams }) }),
    );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ face, store, tauri, tmdb }) => {
      if (tauri) {
        window.__tauriCalls = [];
        let cb = 0;
        window.__TAURI_INTERNALS__ = {
          transformCallback: (f) => {
            const id = ++cb;
            window["_" + id] = f;
            return id;
          },
          convertFileSrc: (p) => p,
          metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
          invoke: (cmd, args) => {
            window.__tauriCalls.push([cmd, args]);
            if (cmd === "http_get") return fetch(args.url).then((r) => r.text());
            if (cmd === "mpv_status")
              return Promise.resolve(JSON.stringify({ pos: 10, dur: 3000, presenting: true, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] }));
            return Promise.resolve(undefined);
          },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      }
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
      localStorage.setItem("blammytv.theme", JSON.stringify({ v: 1, data: face }));
      localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: "fluent" }));
      if (tmdb) localStorage.setItem("blammytv.tmdbKey", JSON.stringify({ v: 1, data: "harness-key" }));
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
    },
    { face, store, tauri, tmdb },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  // The chrome's title bar replaces the old header's clock and version, which
  // sit where the page's own top-left controls are; they take no clicks here.
  await page.addStyleTag({ content: ".header__brand, .header__clock, .header__version { pointer-events: none; }" });
  return { ctx, page };
}

const shot = (page, name, face) => (SHOTS ? page.screenshot({ path: `${SHOTS}/fluent-stream-${name}-${face}.png` }) : null);
const plays = (page) => page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").map((c) => c[1].url));
const played = (page, frag) =>
  page
    .waitForFunction((f) => window.__tauriCalls.some((c) => c[0] === "inv_open" && c[1].url.includes(f)), frag, { timeout: 15_000 })
    .then(() => true, () => false);
const css = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const on = (page, sel) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.textContent?.trim()));

/** Stream's own page, and a film's page from its card. */
async function toFilm(page) {
  await goTo(page, "home");
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.locator(".fls-src").first().waitFor({ timeout: 15_000 });
}

for (const face of ["dark", "light"]) {
  const tag = `[${face}]`;

  // ================================================================ Stream, Home
  {
    const { ctx, page } = await open(face, { tauri: true });
    check(`${tag} the pack is Fluent and the face is ${face}`, await page.evaluate((f) => document.documentElement.dataset.themePack === "fluent" && (f === "light") === (document.documentElement.dataset.theme === "light"), face));
    await goTo(page, "home");
    await page.locator(".fls-banner").waitFor({ timeout: 25_000 });
    check(`${tag} Stream's title is "Stream", in Fluent's title type`, (await texts(page, ".fls-page-title")).join() === "Stream" && (await css(page, ".fls-page-title", "fontSize")) === "28px" && (await css(page, ".fls-page-title", "fontWeight")) === "600");
    check(`${tag} the hero is the 8px banner, not the shelf`, (await page.locator(".shero, .lhero").count()) === 0 && (await css(page, ".fls-banner", "borderRadius")) === "8px");
    const acc = await page.evaluate(() => {
      const [watch, more] = [...document.querySelectorAll(".fls-banner .fls-btn")];
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--fl-accent").trim();
      const probe = document.createElement("i");
      probe.style.color = accent;
      document.body.append(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return { watch: watch?.textContent?.trim(), more: more?.textContent?.trim(), bg: watch && getComputedStyle(watch).backgroundColor, want, moreBg: more && getComputedStyle(more).backgroundColor, h: watch?.getBoundingClientRect().height, r: watch && getComputedStyle(watch).borderRadius };
    });
    check(`${tag} Watch Now is the accent button and More Info the standard one, 32px, 4px corners`, acc.watch === "Watch Now" && acc.more === "More Info" && acc.bg === acc.want && acc.moreBg !== acc.want && acc.h === 32 && acc.r === "4px", JSON.stringify(acc));
    const pips = await page.locator(".fls-pip").count();
    const t0 = (await texts(page, ".fls-banner__title"))[0];
    if (pips > 1) await page.locator(".fls-pip").nth(1).click();
    const t1 = (await texts(page, ".fls-banner__title"))[0];
    check(`${tag} the pips move between the featured titles`, pips > 1 && t0 !== t1 && (await on(page, ".fls-pip")).length === 1, `${pips} pips, ${t0} -> ${t1}`);
    check(`${tag} the rows are still there, row titles in caption-strong`, (await page.locator(".media-row").count()) > 1 && (await css(page, ".stream .media-row__title", "fontSize")) === "18px");
    const card = await page.locator(".stream-card__poster").first().evaluate((el) => getComputedStyle(el).borderRadius);
    check(`${tag} a poster has 8px corners`, card === "8px", card);
    await shot(page, "stream", face);
    // Watch Now, on a film (it plays) and on a series (it opens the episodes, as it always did).
    const pipOf = async (kind) => {
      for (let n = 0; n < pips; n++) {
        await page.locator(".fls-pip").nth(n).click();
        if ((await page.locator(".fls-banner__meta").innerText()).endsWith(kind)) return true;
      }
      return false;
    };
    if (await pipOf("Series")) {
      await page.locator(".fls-banner .fls-btn--accent").click();
      await page.locator(".fls-eps-page").waitFor({ timeout: 15_000 }).catch(() => {});
      check(`${tag} Watch Now on a series opens its episodes`, (await page.locator(".fls-eps-page .fls-ep").count()) > 0);
      await page.locator(".fls-back").click();
      await page.locator(".fls-banner").waitFor({ timeout: 15_000 });
    }
    check(`${tag} a featured film is there to play`, await pipOf("Movie"));
    await page.locator(".fls-banner .fls-btn--accent").click();
    const ok = await played(page, "/video/");
    check(`${tag} Watch Now plays a film (the native player is asked for a file)`, ok, JSON.stringify(await plays(page)));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(face);
    await page.locator('[data-dest="hub"]').waitFor();
    await goTo(page, "hub");
    await page.locator(".fls-page-title").waitFor({ timeout: 25_000 });
    check(`${tag} Home's title is "Home"`, (await texts(page, ".fls-page-title"))[0] === "Home");
    await page.locator(".fls-banner, .media-row").first().waitFor({ timeout: 25_000 });
    await shot(page, "home", face);
    await ctx.close();
  }

  // ================================================================ A film's page
  {
    const { ctx, page } = await open(face, { tauri: true, streams: STREAMS });
    await toFilm(page);
    check(`${tag} the film's page is Fluent's, not the old one`, (await page.locator(".fls-title .fls-head").count()) === 1 && (await page.locator(".vod-detail, .vod-source").count()) === 0);
    const head = await page.evaluate(() => ({
      title: document.querySelector(".fls-head__title")?.textContent,
      poster: getComputedStyle(document.querySelector(".fls-head__poster") ?? document.body).borderRadius,
      meta: document.querySelector(".fls-head__meta")?.textContent ?? "",
      syn: !!document.querySelector(".fls-head__synopsis")?.textContent,
      chips: [...document.querySelectorAll(".fls-chip")].map((c) => c.textContent),
      btns: [...document.querySelectorAll(".fls-actions button")].map((b) => b.textContent?.trim()),
    }));
    check(`${tag} the header has the title, an 8px poster, meta, genre pills and the synopsis`, head.title === "Fake Movie One" && head.poster === "8px" && head.chips.includes("Action") && head.syn, JSON.stringify(head));
    check(`${tag} the buttons are Play and Add to Library (its chevron is the lists menu), with no empty More button`, head.btns[0] === "Play" && head.btns.some((b) => b.includes("Add to Library")) && !head.btns.includes("⋯") && !head.btns.includes("···"), JSON.stringify(head.btns));
    const pillsOn = async () => (await on(page, ".fls-pill")).join();
    check(`${tag} the pills are built from the sources: All, each quality highest first, Cached`, (await texts(page, ".fls-pill")).join("|") === "All|2160p|1080p|720p|480p|Cached" && (await pillsOn()) === "All");
    const order = async () => (await texts(page, ".fls-badge")).join(",");
    check(`${tag} Best Match is cached first, then the unmarked, then the rest in the addon's order`, (await order()) === "480p,720p,1080p,2160p", await order());
    const row = await page.evaluate(() => {
      const r = document.querySelector(".fls-src");
      return { name: r.querySelector(".fls-src__name")?.textContent, sub: r.querySelector(".fls-src__sub")?.textContent ?? "", cached: !!r.querySelector(".fls-cached"), list: getComputedStyle(document.querySelector(".fls-list")).borderRadius, role: document.querySelector(".fls-list")?.getAttribute("role") };
    });
    check(`${tag} a row has its quality badge, the addon's own lines and a Cached pill, in one 8px card`, row.name === "Custom 480p" && row.sub === "0.9GB" && row.cached && row.list === "8px" && row.role === "listbox", JSON.stringify(row));
    check(`${tag} only a cached source has the pill`, (await page.locator(".fls-cached").count()) === 1);
    check(`${tag} the first row is selected: the subtle fill and the 3px accent pill`, await page.evaluate(() => {
      const r = document.querySelector('.fls-src[aria-selected="true"]');
      const pill = getComputedStyle(r, "::before");
      return !!r && r === document.querySelector(".fls-src") && pill.width === "3px" && pill.content !== "none" && getComputedStyle(r).backgroundColor !== "rgba(0, 0, 0, 0)";
    }));
    await shot(page, "title", face);
    // Filters
    await page.locator(".fls-pill", { hasText: "1080p" }).click();
    check(`${tag} the 1080p pill keeps only 1080p`, (await order()) === "1080p" && (await pillsOn()) === "1080p");
    await page.locator(".fls-pill", { hasText: "Cached" }).click();
    check(`${tag} the Cached pill keeps only the cached`, (await order()) === "480p");
    await page.locator(".fls-pill", { hasText: "All" }).click();
    // Sort
    await page.locator(".fls-sources__sort select").selectOption({ label: "Quality" });
    check(`${tag} Sort by Quality is highest first`, (await order()) === "2160p,1080p,720p,480p", await order());
    await page.locator(".fls-pill", { hasText: "1080p" }).click();
    await page.locator(".fls-pill", { hasText: "All" }).click();
    check(`${tag} the sort holds across a filter`, (await order()) === "2160p,1080p,720p,480p");
    await page.locator(".fls-sources__sort select").selectOption({ label: "Best Match" });
    check(`${tag} and Best Match puts it back`, (await order()) === "480p,720p,1080p,2160p");
    // Selection and keys, none of which plays
    await page.locator(".fls-src").nth(2).click();
    check(`${tag} a click selects a row and plays nothing`, (await page.locator('.fls-src[aria-selected="true"] .fls-badge').innerText()) === "1080p" && (await plays(page)).length === 0);
    await page.keyboard.press("ArrowUp");
    const afterUp = await page.evaluate(() => ({ sel: document.querySelector('.fls-src[aria-selected="true"] .fls-badge')?.textContent, focus: document.activeElement?.querySelector(".fls-badge")?.textContent, stops: [...document.querySelectorAll(".fls-src")].filter((r) => r.tabIndex === 0).length }));
    check(`${tag} the arrows move the selection and the focus together, one tab stop`, afterUp.sel === "720p" && afterUp.focus === "720p" && afterUp.stops === 1, JSON.stringify(afterUp));
    await page.keyboard.press("End");
    check(`${tag} End is the last row, Home the first`, (await page.locator('.fls-src[aria-selected="true"] .fls-badge').innerText()) === "2160p");
    await page.keyboard.press("Home");
    check(`${tag}   Home`, (await page.locator('.fls-src[aria-selected="true"] .fls-badge').innerText()) === "480p");
    // The focus ring is the double one
    const ring = await page.evaluate(() => {
      const r = document.querySelector('.fls-src[aria-selected="true"]');
      const s = getComputedStyle(r);
      return { outline: s.outlineWidth, shadow: s.boxShadow };
    });
    check(`${tag} the focused row has WinUI's double ring`, ring.outline === "2px" && ring.shadow !== "none", JSON.stringify(ring));
    // Plays
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    check(`${tag} Enter plays the selected source`, await played(page, "c-720"), JSON.stringify(await plays(page)));
    await ctx.close();
  }
  for (const [how, frag] of [
    ["a double click plays that row", "c-2160"],
    ["the play mark plays that row", "c-1080"],
    ["the Play button plays the first source of Best Match", "c-480"],
  ]) {
    const { ctx, page } = await open(face, { tauri: true, streams: STREAMS });
    await toFilm(page);
    if (frag === "c-2160") await page.locator(".fls-src", { hasText: "Custom 2160p" }).dblclick();
    if (frag === "c-1080") await page.locator(".fls-src", { hasText: "Custom 1080p" }).locator(".fls-src__play").click();
    if (frag === "c-480") await page.locator(".fls-actions .fls-btn--accent").click();
    check(`${tag} ${how}`, await played(page, frag), JSON.stringify(await plays(page)));
    await ctx.close();
  }
  {
    // The lists menu is still there: the chevron half of Add to Library.
    const { ctx, page } = await open(face);
    await toFilm(page);
    await page.locator(".vod-save__more").click();
    check(`${tag} the Add to Library chevron opens the lists menu`, await page.getByText("Save To", { exact: true }).isVisible().catch(() => false));
    await page.keyboard.press("Escape");
    await page.locator(".vod-save:not(.vod-save__more)").click();
    check(`${tag} and Add to Library saves, as it always did`, (await page.locator(".vod-save").first().innerText()).includes("In "), await page.locator(".vod-save").first().innerText());
    await page.locator(".fls-back").click();
    check(`${tag} Back returns to Stream's home`, (await page.locator(".fls-banner").count()) === 1);
    await ctx.close();
  }

  // ================================================================ Episodes
  {
    const store = { watchedEpisodes: { tt200001: ["tt200001:1:1"] }, watching: [entryOf("tt200001", "Fake Series One", 2)] };
    const { ctx, page } = await open(face, { tauri: true, store });
    await goTo(page, "home");
    await page.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
    await page.locator(".fls-ep").first().waitFor({ timeout: 15_000 });
    check(`${tag} the series page is Fluent's`, (await page.locator(".fls-eps-page .fls-head").count()) === 1 && (await page.locator(".episode-card, .vod-detail").count()) === 0);
    const bar = await page.evaluate(() => ({ seasons: [...document.querySelectorAll(".season-bar .seg__opt")].map((o) => o.textContent), on: [...document.querySelectorAll(".season-bar .seg__opt")].filter((o) => o.getAttribute("aria-pressed") === "true").map((o) => o.textContent), thumbH: getComputedStyle(document.querySelector(".season-bar .seg__thumb")).height }));
    check(`${tag} a SelectorBar of seasons with the accent underline, opened on the season you are in`, bar.seasons.join() === "Season 1,Season 2" && bar.on.join() === "Season 1" && bar.thumbH === "3px", JSON.stringify(bar));
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".fls-ep")].map((e) => ({
        title: e.querySelector(".fls-ep__title")?.textContent,
        sub: e.querySelector(".fls-ep__sub")?.textContent,
        seen: !!e.querySelector(".fls-ep__seen"),
        bar: e.querySelector(".fls-ep__bar i")?.style.width ?? null,
        next: e.classList.contains("is-next"),
        pic: Math.round((e.querySelector(".fls-ep__pic").getBoundingClientRect().width / e.querySelector(".fls-ep__pic").getBoundingClientRect().height) * 100),
        r: getComputedStyle(e.querySelector(".fls-ep__pic")).borderRadius,
      })),
    );
    check(`${tag} the rows are "N. Title" with the date, on 16:9 thumbnails with 8px corners`, rows.length === 3 && rows[0].title === "1. S1E1 Title" && /^[A-Z][a-z]{2} \d{1,2}, 2024$/.test(rows[0].sub) && rows.every((r) => r.pic === 178 && r.r === "8px"), JSON.stringify(rows));
    check(`${tag} a watched episode has the check badge, and only that one`, rows[0].seen && !rows[1].seen && !rows[2].seen);
    check(`${tag} the one in progress has its bar (600 of 3000 is 20%), the others none`, rows[1].bar === "20%" && rows[0].bar === null && rows[2].bar === null, JSON.stringify(rows.map((r) => r.bar)));
    check(`${tag} the episode up next wears the accent pill`, rows[1].next && !rows[0].next && (await page.evaluate(() => getComputedStyle(document.querySelectorAll(".fls-ep")[1], "::before").width)) === "3px");
    const btns = await texts(page, ".fls-actions button");
    check(`${tag} the header says Resume S1 E2 and has Add to Library`, btns[0].trim() === "Resume S1 E2" && btns.some((b) => b.includes("Add to Library")), JSON.stringify(btns));
    await shot(page, "episodes", face);
    await page.locator(".season-bar .seg__opt", { hasText: "Season 2" }).click();
    const s2 = await texts(page, ".fls-ep__title");
    check(`${tag} the Season 2 option shows Season 2's episodes`, s2.join("|") === "1. S2E1 Title|2. S2E2 Title|3. S2E3 Title" && (await on(page, ".season-bar .seg__opt")).join() === "Season 2", s2.join("|"));
    await page.locator(".fls-actions .fls-btn--accent").click();
    await page.locator(".fls-src").first().waitFor({ timeout: 15_000 });
    check(`${tag} Resume opens that episode's sources, in the same view`, (await texts(page, ".fls-head__episode")).join() === "S1 · E2: S1E2 Title" && (await page.locator(".fls-src").count()) === 2);
    await page.locator(".fls-src").first().dblclick();
    check(`${tag} and an episode's source plays`, await played(page, "/video/tt200001:1:2") || (await plays(page)).length > 0, JSON.stringify(await plays(page)));
    await ctx.close();
  }
  {
    // An episode that has not aired: dim, and not openable.
    const { ctx, page } = await open(face, { store: { watching: [entryOf("tt500001", "Fake Series Airing", 2)] } });
    await goTo(page, "home");
    await page.locator("button.continue-card__sources").first().click();
    await page.locator(".fls-src").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.locator(".fls-back").click();
    await page.locator(".fls-ep").nth(3).waitFor({ timeout: 15_000 });
    const eps = await page.evaluate(() => [...document.querySelectorAll(".fls-ep")].map((c) => ({ off: c.disabled, day: c.querySelector(".fls-ep__sub")?.textContent, filter: getComputedStyle(c.querySelector(".fls-ep__pic")).filter })));
    check(`${tag} the episode that has not aired says when, is dimmed and is a disabled button`, eps.length === 4 && eps[3].off && eps[3].day === "Airs Mar 5, 2099" && /grayscale/.test(eps[3].filter) && eps.slice(0, 3).every((e) => !e.off && e.filter === "none"), JSON.stringify(eps));
    await page.locator(".fls-ep").nth(3).click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
    check(`${tag} clicking it does nothing`, (await page.locator(".fls-ep").count()) === 4 && (await page.locator(".fls-src").count()) === 0);
    await page.locator(".fls-ep").nth(2).focus();
    await page.keyboard.press("Tab");
    check(`${tag} Tab skips it`, await page.evaluate(() => !document.activeElement?.closest(".fls-ep:disabled")));
    await ctx.close();
  }

  // ================================================================ Discover
  {
    const { ctx, page } = await open(face, { tmdb: true });
    await goTo(page, "discover");
    await page.locator(".disc-grid .stream-card").first().waitFor({ timeout: 25_000 });
    check(`${tag} Discover's title and its command row are in the page`, (await texts(page, ".fls-page-title"))[0] === "Discover" && (await page.locator(".fls-cmd").count()) === 1 && (await page.locator(".discover__genres").count()) === 0);
    const cmd = await page.evaluate(() => ({
      types: [...document.querySelectorAll(".fls-cmd .seg__opt")].map((o) => o.textContent),
      on: [...document.querySelectorAll(".fls-cmd .seg__opt")].filter((o) => o.getAttribute("aria-pressed") === "true").map((o) => o.textContent),
      genre: document.querySelector(".fls-combo__select")?.selectedOptions[0]?.textContent,
      genres: [...document.querySelectorAll(".fls-combo__select option")].map((o) => o.textContent),
      ph: document.querySelector(".fls-search input")?.placeholder,
      rec: [...document.querySelectorAll(".fls-cmd button.fls-btn")].map((b) => b.textContent?.trim()),
    }));
    check(`${tag} All / Movies / Series, Genre: Any, "Search Movies & Series" and "Find Something to Watch"`, cmd.types.join() === "All,Movies,Series" && cmd.on.join() === "All" && cmd.genre === "Any" && cmd.genres.includes("Action") && cmd.ph === "Search Movies & Series" && cmd.rec.join() === "Find Something to Watch", JSON.stringify(cmd));
    const names = () => texts(page, ".disc-grid .stream-card__name");
    check(`${tag} the grid has movies and series, 8px posters, a title under each`, (await page.locator(".disc-grid .stream-card").count()) > 4 && (await css(page, ".disc-grid .stream-card__poster", "borderRadius")) === "8px");
    await shot(page, "discover", face);
    // The type filter filters
    await page.locator(".fls-cmd .seg__opt", { hasText: "Series" }).click();
    await page.waitForFunction(() => { const n = [...document.querySelectorAll(".disc-grid .stream-card__name")].map((e) => e.textContent); return n.length > 0 && n.every((t) => /Series/.test(t)); }, null, { timeout: 15_000 }).catch(() => {});
    const series = await names();
    check(`${tag} the Series option leaves only series, and is the one pressed`, series.length > 0 && series.every((t) => /Series/.test(t)) && (await on(page, ".fls-cmd .seg__opt")).join() === "Series", series.join());
    await page.locator(".fls-cmd .seg__opt", { hasText: "Movies" }).click();
    await page.waitForFunction(() => { const n = [...document.querySelectorAll(".disc-grid .stream-card__name")].map((e) => e.textContent); return n.length > 0 && n.every((t) => !/Series/.test(t)); }, null, { timeout: 15_000 }).catch(() => {});
    const movies = await names();
    check(`${tag} the Movies option leaves only films`, movies.length > 0 && movies.every((t) => !/Series/.test(t)) && (await on(page, ".fls-cmd .seg__opt")).join() === "Movies", movies.join());
    await page.locator(".fls-cmd .seg__opt", { hasText: "All" }).click();
    // The genre box
    await page.locator(".fls-combo__select").selectOption({ label: "Comedy" });
    await page.waitForFunction(() => /Comedy/.test(document.querySelector(".discover")?.innerText ?? "") && document.querySelector(".fls-combo__select")?.value === "Comedy", null, { timeout: 15_000 });
    check(`${tag} the Genre box picks a genre: the page is that genre's`, (await page.locator(".fls-combo__select").inputValue()) === "Comedy" && (await page.locator(".discover").innerText()).includes("Comedy"));
    await page.locator(".fls-combo__select").selectOption({ label: "Any" });
    await page.waitForFunction(() => document.querySelector(".fls-combo__select")?.value === "" && document.querySelectorAll(".disc-grid .stream-card").length > 4, null, { timeout: 15_000 });
    check(`${tag}   and Any takes it back`, (await page.locator(".fls-combo__select").inputValue()) === "");
    // Search
    await page.locator(".fls-search input").fill("Fake Movie One");
    await page.getByText("Results for", { exact: false }).waitFor({ timeout: 10_000 });
    await page.locator(".disc-grid .stream-card").first().waitFor({ timeout: 10_000 });
    check(`${tag} the search box searches: results for it`, (await names()).some((t) => /Fake Movie One/.test(t)));
    await page.locator(".fls-search input").press("Escape");
    await page.waitForFunction(() => !/Results for/.test(document.querySelector(".discover")?.innerText ?? ""), null, { timeout: 5000 });
    check(`${tag}   and Escape clears it`, (await page.locator(".fls-search input").inputValue()) === "");
    // The grid's selection is the focused poster
    await page.locator(".disc-grid .stream-card").nth(2).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700); // the shadow eases in
    const sel = await page.evaluate(() => {
      const c = document.activeElement?.closest(".stream-card");
      const t = c?.querySelector(".stream-card__tilt");
      return { is: !!c, check: t ? getComputedStyle(t, "::after").content : "", ring: t ? getComputedStyle(t).boxShadow : "" };
    });
    check(`${tag} the focused poster has the accent border and a check badge`, sel.is && /✓/.test(sel.check) && sel.ring !== "none", JSON.stringify(sel));
    // Open still opens
    const was = await page.locator(".disc-grid .stream-card__name").first().innerText();
    await page.locator(".disc-grid .stream-card").first().click();
    await page.locator(".fls-head__title").waitFor({ timeout: 15_000 });
    check(`${tag} a poster still opens its title`, (await texts(page, ".fls-head__title"))[0] === was, was);
    await page.locator(".fls-back").click();
    await ctx.close();
  }
  {
    // REC
    const { ctx, page } = await open(face, { tmdb: true });
    await goTo(page, "discover");
    await page.locator(".fls-cmd .fls-btn", { hasText: "Find Something to Watch" }).click();
    await page.locator(".fls-rec").waitFor({ timeout: 8000 });
    check(`${tag} REC is a page: a title and a back button, in a card, with no drifting wall`, (await texts(page, ".fls-rec .fls-page-title"))[0] === "Find Something to Watch" && (await page.locator(".rec__wall").count()) === 0 && (await css(page, ".fls-rec .rec__stage", "borderRadius")) === "8px");
    await page.locator(".rec__input").fill("space");
    await page.keyboard.press("Enter");
    check(`${tag} a word becomes a chip, and Find goes live`, (await texts(page, ".rec__chip")).join().includes("space") && !(await page.locator(".rec__go").isDisabled()) && (await texts(page, ".rec__go")).join().trim() === "Find");
    await shot(page, "rec", face);
    await page.locator(".rec__go").click();
    await page.locator(".rec__card").waitFor({ timeout: 12_000 });
    check(`${tag} Find offers a title`, (await page.locator(".rec__card").innerText()).length > 0);
    await page.locator(".fls-rec .fls-back").click();
    await page.locator(".disc-grid .stream-card").first().waitFor({ timeout: 15_000 });
    check(`${tag} Back returns to Discover's grid`, (await page.locator(".fls-rec").count()) === 0 && (await page.locator(".fls-cmd").count()) === 1);
    await ctx.close();
  }
}

// ======================================================================= Default again
{
  const { ctx, page } = await open("dark", { tauri: true });
  await page.evaluate(() => delete document.documentElement.dataset.themePack);
  await goTo(page, "home");
  await page.locator(".shero, .lhero").first().waitFor({ timeout: 25_000 });
  check("[default] Stream is the shelf hero again, with no Fluent title or banner", (await page.locator(".fls-banner, .fls-page-title").count()) === 0);
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  check("[default] a film's page is the old one: the glass sources column, no Fluent", (await page.locator(".vod-detail").count()) === 1 && (await page.locator(".vod-source").count()) === 2 && (await page.locator('[class*="fls-"]').count()) === 0);
  await page.locator(".vod-back").click();
  await page.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
  await page.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  check("[default] a series' page is the old one: the season bar and the tiles", (await page.locator(".episode-card").count()) === 3 && (await page.locator(".fls-ep").count()) === 0);
  await goTo(page, "discover");
  await page.locator(".disc-grid .stream-card").first().waitFor({ timeout: 25_000 });
  check("[default] Discover keeps its genre rail and the header's row, and has no Fluent bar", (await page.locator(".discover__genres").count()) === 1 && (await page.locator(".fls-cmd").count()) === 0 && (await page.locator(".navcap__row--sub").count()) === 1);
  // Switched on again at runtime: the screens follow with no reload.
  await page.evaluate(() => (document.documentElement.dataset.themePack = "fluent"));
  await page.locator(".fls-cmd").waitFor({ timeout: 5000 });
  check("[default] and switching Fluent on again brings its bar back without a reload", (await page.locator(".discover__genres").count()) === 0);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
