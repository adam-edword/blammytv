// E2E: Fluent's lists, the Live TV guide and the Sports board (plan 035,
// "Fluent to tier 3"), in WinUI's list/details pattern.
//
// Live TV: a folders column (a filter box, Favorites / Recents / Recordings /
// All Channels, each source as a caption header with its streams in use and
// its folders with their counts), a page header with a Now button, a preview
// card (the same #player-slot, Watch, Record, a favourite), and the grid as
// one 8px card with 4px tiles, a progress bar on the airing one, an accent
// border on the selected one and a 2px now-line with a dot.
// Sports: a leagues column (Following, All Sports, each sport as a caption
// header with its leagues and today's counts, a star to follow), a day
// SelectorBar, and the day's games under Live Now / Later Today / Final as
// 8px cards three across, the away side first, the loser dimmed, the status
// in accent with a live dot, and "Live on N channels" as a link.
//
// Each is asserted in Dark and in Light, then the pack is switched off and
// the Default screens are asserted back, unchanged. ESPN is routed, never
// called; every other host is aborted.
//
//   node scripts/fake-panel.mjs     # :8081  (PANEL_PORT to move it)
//   (vite on :4173, or APP_URL)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-fluent-lists.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";
import { openApp, openTheater, startProxy, wake } from "./fluent-native.mjs";

const SPORTS_SRC = new URL("../apps/app/src/features/sports/fixtures/", import.meta.url);

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PANEL = `http://localhost:${process.env.PANEL_PORT ?? 8081}`;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const PLAYLISTS = {
  v: 1,
  data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: PANEL, username: "u", password: "p" }],
};

// ------------------------------------------------------------------ ESPN
const dayAt = (offset, h = 0, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const STATUS = {
  pre: { type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false } },
  live: { type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "Q4 2:31" } },
  final: { type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } },
};
const comp = (id, side, name, color, record, score) => ({
  id: `${id}${side}`,
  homeAway: side,
  score: String(score ?? 0),
  records: record ? [{ type: "total", summary: record }] : [],
  team: {
    id: `${id}${side}`,
    displayName: name,
    shortDisplayName: name,
    name,
    abbreviation: name.slice(0, 3).toUpperCase(),
    color,
  },
});
/** One game, in the shape the endpoint returns. The HOME side is listed
 * first, as ESPN does, and the board reads football away-first. */
// Networks are given to two games only: a channel that several games share at
// one kick-off is not a sure match for any of them (sharing.ts), so it would
// not be offered as "Live on N channels".
const game = (id, state, start, home, away, nets = []) => ({
  id,
  date: start.toISOString(),
  name: `${away[0]} at ${home[0]}`,
  status: STATUS[state],
  competitions: [
    {
      id,
      date: start.toISOString(),
      status: STATUS[state],
      competitors: [
        comp(id, "home", home[0], home[1], home[2], home[3]),
        comp(id, "away", away[0], away[1], away[2], away[3]),
      ],
      broadcasts: nets.length ? [{ market: "national", names: nets }] : [],
    },
  ],
});
const NOW = new Date();
const SOON = new Date(Math.min(NOW.getTime() + 20 * 60_000, dayAt(0, 23, 59).getTime()));
const BOARD = {
  "football/nfl": {
    0: [
      game("n1", "live", new Date(NOW.getTime() - 3600_000), ["Hawks", "1d4f9e", "7-2", 24], ["Bears", "e8731a", "8-1", 21], ["ESPN"]),
      game("n2", "pre", SOON, ["Lions", "0b6fb0", "5-4"], ["Packs", "2a7d3f", "6-3"], ["Fake Sky Sports"]),
      game("n3", "pre", SOON, ["Jets", "1c6b4a", "3-6"], ["Bills", "c0262d", "7-2"]),
      game("n4", "pre", SOON, ["Colts", "2563c4", "4-5"], ["Texans", "a3262a", "5-4"]),
      game("n5", "final", dayAt(0, 0, 5), ["Rams", "1f3f9c", "6-3", 17], ["Niners", "b1272c", "7-2", 35]),
    ],
    1: [game("n6", "pre", dayAt(1, 19), ["Vikes", "4f2683", "6-3"], ["Saints", "b8a361", "4-5"])],
    "-1": [game("n7", "final", dayAt(-1, 19), ["Eagles", "0b6b5a", "8-1", 20], ["Giants", "1d3a8a", "2-7", 13])],
  },
  "basketball/nba": {
    0: [game("b1", "pre", SOON, ["Celtics", "0a7a3d", "9-1"], ["Knicks", "1f58b8", "7-3"])],
  },
};
const boardFor = (path, dates) => {
  const sport = path.split("/")[0];
  const events = Object.entries(BOARD[path] ?? {})
    .filter(([off]) => ymd(dayAt(Number(off))) === dates)
    .flatMap(([, list]) => list);
  return {
    leagues: [{ id: "1", name: path.split("/")[1].toUpperCase(), abbreviation: path.split("/")[1].toUpperCase(), slug: path.split("/")[1] }],
    events,
    sport,
  };
};

// -------------------------------------------------------------- the page
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function open({ face, tab, follows, width = 1440 }) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: face,
    reducedMotion: "reduce",
  });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/site\.api\.espn\.com/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.match(/\/sports\/([^/]+\/[^/]+)\/scoreboard/)?.[1] ?? "";
    const dates = url.searchParams.get("dates") ?? "";
    const reach = dates === "" || dates.includes("-");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reach ? { events: [] } : boardFor(path, dates)),
    });
  });
  await page.addInitScript(
    ({ PLAYLISTS, tab, follows }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
      localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: tab }));
      localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: "fluent" }));
      // Finals fold to one line by default (Compact Results); the cards below
      // are asserted with it off, and the button with it on.
      localStorage.setItem("blammytv.compactResults", JSON.stringify({ v: 1, data: false }));
      if (follows) localStorage.setItem("blammytv.sports-follows", JSON.stringify({ v: 1, data: { leagues: follows, teams: [] } }));
    },
    { PLAYLISTS, tab, follows },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap, .flc-title", { timeout: 20_000 });
  // The chrome builder's work is not here, so the pack is also set straight
  // on the root, in the face under test.
  await page.evaluate((face) => {
    document.documentElement.dataset.themePack = "fluent";
    if (face === "light") document.documentElement.dataset.theme = "light";
  }, face);
  return { ctx, page, errors };
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** A computed style of the first match. */
const style = (page, sel, prop, pseudo) =>
  page.evaluate(({ sel, prop, pseudo }) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el, pseudo)[prop] : null;
  }, { sel, prop, pseudo });
/** The accent, as the browser resolves it to a colour. */
const accent = (page) =>
  page.evaluate(() => {
    const p = document.createElement("i");
    p.style.color = "var(--fl-accent)";
    document.body.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
const text = (page, sel) => page.locator(sel).first().innerText();

// ===================================================================== LIVE
async function live(face) {
  const tag = `live ${face}`;
  const { ctx, page, errors } = await open({ face, tab: "live" });
  await page.waitForSelector(".guide__cell", { timeout: 30_000 });
  await settle(page);
  const acc = await accent(page);

  // The column.
  check(`${tag}: the folders column is 240px with a stroke on its right edge`,
    (await page.locator(".fl-aside").evaluate((e) => e.getBoundingClientRect().width)) === 240 &&
      (await style(page, ".fl-aside", "borderRightWidth")) === "1px");
  check(`${tag}: it has a Filter folders box`, (await page.getByRole("searchbox", { name: "Filter folders" }).count()) === 1);
  const nav = await page.locator(".fl-folders__list > .fl-nav .fl-nav__name").allInnerTexts();
  check(`${tag}: Favorites, Recents, Recordings, All Channels come first`,
    nav.slice(0, 4).join("|") === "Favorites|Recents|Recordings|All Channels", nav.slice(0, 4).join("|"));
  check(`${tag}: the source is a caption header with its streams in use`,
    /^Test · \d+ of \d+ streams?$/.test((await text(page, ".fl-folders__group .fl-caption")).trim()),
    (await text(page, ".fl-folders__group .fl-caption")).trim());
  const folderNames = await page.locator(".fl-folders__group .fl-nav .fl-nav__name").allInnerTexts();
  const folderCounts = await page.locator(".fl-folders__group .fl-nav .fl-nav__count").allInnerTexts();
  check(`${tag}: each folder has a glyph and a right-aligned channel count`,
    folderNames.length >= 3 && folderCounts.length === folderNames.length && folderCounts.every((c) => /^\d+$/.test(c)),
    folderNames.map((n, i) => `${n} ${folderCounts[i]}`).join(", "));
  check(`${tag}: All Channels is the selected item, with the pill and a fill`,
    (await page.locator('.fl-nav[aria-current="true"] .fl-nav__name').allInnerTexts()).join() === "All Channels" &&
      (await style(page, '.fl-nav[aria-current="true"]', "backgroundColor", null)) !== "rgba(0, 0, 0, 0)" &&
      (await style(page, '.fl-nav[aria-current="true"]', "width", "::before")) === "3px" &&
      (await style(page, '.fl-nav[aria-current="true"]', "backgroundColor", "::before")) === acc);

  // The header.
  check(`${tag}: the header is Live TV, All Channels · N channels, and a Now button`,
    (await text(page, ".fl-head__title")) === "Live TV" &&
      /^All Channels · 5 channels$/.test(await text(page, ".fl-head__sub")) &&
      (await page.getByRole("button", { name: "Back to now" }).count()) >= 1,
    await text(page, ".fl-head__sub"));

  // The preview card.
  const slot = await page.locator("#player-slot").evaluate((e) => ({
    inHero: !!e.closest(".hero.fl-hero"),
    cls: e.className,
    r: getComputedStyle(e).borderRadius,
  }));
  check(`${tag}: the preview card holds the same #player-slot, radius untouched`,
    slot.inHero && slot.cls === "hero__preview" && slot.r === "10px", JSON.stringify(slot));
  check(`${tag}: the card is 8px`, (await style(page, ".fl-hero", "borderRadius")) === "8px");
  const details = await page.locator(".fl-hero__details").innerText();
  check(`${tag}: it names the channel, its number and folder, Now: and Next:`,
    /Channel 1 · Sports/.test(details) && /Now:/.test(details) && /Next:/.test(details), details.replace(/\n+/g, " | "));
  check(`${tag}: a ProgressBar shows how far the programme is`,
    (await page.locator('.fl-hero [role="progressbar"]').getAttribute("aria-valuenow")) !== null);
  check(`${tag}: Watch is the accent button`,
    (await style(page, ".fl-hero .fl-btn--accent", "backgroundColor")) === acc);
  check(`${tag}: Record is the existing RecordButton in Fluent paint`,
    (await page.locator('.fl-hero .rec-btn button[aria-label="Record"]').count()) === 1 &&
      (await style(page, ".fl-hero .rec-btn button", "borderRadius")) === "4px");

  // The grid.
  check(`${tag}: the grid is one 8px card`, (await style(page, ".guide-wrap", "borderRadius")) === "8px");
  check(`${tag}: programme tiles are 4px with a 1px stroke`,
    (await style(page, ".guide__cell:not(.guide__cell--blank)", "borderRadius")) === "4px" &&
      (await style(page, ".guide__cell:not(.guide__cell--blank)", "borderTopWidth")) === "1px");
  check(`${tag}: an airing tile carries a thin accent bar along its bottom`,
    (await page.locator(".guide__cell--live .guide__cell-bar").count()) >= 1 &&
      (await style(page, ".guide__cell-bar", "backgroundColor")) === acc &&
      (await style(page, ".guide__cell-bar", "height")) === "3px");
  check(`${tag}: the selected tile has an accent border`,
    (await page.locator(".guide__cell--selected").count()) === 1 &&
      (await style(page, ".guide__cell--selected", "borderTopColor")) === acc);
  check(`${tag}: the now-line is 2px accent with a dot on top`,
    (await style(page, ".guide__nowline", "width")) === "2px" &&
      (await style(page, ".guide__nowline", "backgroundColor")) === acc &&
      (await style(page, ".guide__nowline", "width", "::before")) === "8px");
  check(`${tag}: the channel column shows a rounded logo, the name and the number`,
    (await style(page, ".guide__card .chlogo", "borderRadius")) === "6px" &&
      /Channel 1/.test(await text(page, ".guide__channel"))  );

  // The column opens wide enough for a typical name: "Fake Sky Sports FHD"
  // read "Fake Sky Sports F" at the Default's 189px.
  const cut = await page.$$eval(".guide__card-name", (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  const longest = await page.$$eval(".guide__card-name", (els) => Math.max(...els.map((e) => e.textContent.length)));
  check(`${tag}: no channel name is cut in the channel column`, cut.length === 0 && longest >= 17, `${JSON.stringify(cut)}, longest ${longest} chars`);

  // Interaction: a folder.
  const rows = () => page.locator(".guide__row").count();
  const before = await rows();
  await page.locator(".fl-folders__group .fl-nav", { hasText: "News" }).click();
  await settle(page);
  check(`${tag}: a folder click selects it and narrows the guide`,
    (await page.locator('.fl-nav[aria-current="true"] .fl-nav__name').allInnerTexts()).join() === "News" &&
      (await rows()) === 1 && before > 1 && (await text(page, ".fl-head__sub")) === "News · 1 channel",
    `${before} -> ${await rows()}, ${await text(page, ".fl-head__sub")}`);
  await page.getByRole("searchbox", { name: "Filter folders" }).fill("spo");
  await settle(page);
  const filtered = await page.locator(".fl-folders__group .fl-nav .fl-nav__name").allInnerTexts();
  check(`${tag}: the filter box narrows the list by name`, filtered.join() === "Sports", filtered.join());
  await page.getByRole("searchbox", { name: "Filter folders" }).fill("");
  await page.locator(".fl-folders__list > .fl-nav", { hasText: "All Channels" }).click();
  await settle(page);
  check(`${tag}: All Channels brings every channel back`, (await rows()) === before);

  // The right-click Hide menu stays.
  await page.locator(".fl-folders__group .fl-nav", { hasText: "News" }).click({ button: "right" });
  check(`${tag}: right-click on a folder still offers Hide`,
    (await page.locator('.folder-menu [role="menuitem"]').innerText()).includes("Hide"));
  await page.keyboard.press("Escape");

  // Favourite, Recents, Watch.
  await page.locator('.fl-hero button[aria-label^="Add Fake ESPN 4K to favorites"]').click();
  await settle(page);
  const count = (label) =>
    page.locator(".fl-folders__list > .fl-nav", { hasText: label }).locator(".fl-nav__count").innerText();
  check(`${tag}: the star favourites the channel and the Favorites count follows`, (await count("Favorites")) === "1");
  await page.locator(".fl-folders__list > .fl-nav", { hasText: "Favorites" }).click();
  await settle(page);
  check(`${tag}: Favorites lists it`, (await rows()) === 1 && /Favorites · 1 channel/.test(await text(page, ".fl-head__sub")));
  await page.locator(".fl-folders__list > .fl-nav", { hasText: "Recents" }).click();
  await settle(page);
  await page.locator(".fl-folders__list > .fl-nav", { hasText: "All Channels" }).click();
  await page.locator(".fl-hero .fl-btn--accent").click();
  await settle(page);
  check(`${tag}: Watch tunes the channel, which lands in Recents`, (await count("Recents")) === "1", await count("Recents"));

  // Now jumps the guide back.
  await page.evaluate(() => { document.querySelector(".guide").scrollLeft = 900; });
  await settle(page);
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Back to now" }).first().click();
  await settle(page);
  await page.waitForTimeout(150);
  check(`${tag}: the header's Now jumps the guide to the current time`,
    (await page.evaluate(() => document.querySelector(".guide").scrollLeft)) === 0);

  await page.screenshot({
    path: `${process.env.SHOT_DIR ?? "/tmp"}/fluent-lists-live-${face}.png`,
  }).catch(() => {});

  // Default again.
  await page.evaluate(() => { delete document.documentElement.dataset.themePack; });
  await settle(page);
  const back = await page.evaluate(() => ({
    side: !!document.querySelector(".live-sidebar .seg"),
    flAside: !!document.querySelector(".fl-aside"),
    flHero: !!document.querySelector(".fl-hero"),
    hero: !!document.querySelector(".hero .hero__title"),
    bars: document.querySelectorAll(".guide__cell-bar").length,
    num: !!document.querySelector(".guide__card-num"),
    sel: !!document.querySelector(".guide__cell--selected"),
    head: !!document.querySelector(".fl-head"),
    radius: getComputedStyle(document.querySelector(".guide__cell")).borderRadius,
  }));
  check(`${tag}: switched to Default, today's Live TV is back`,
    back.side && !back.flAside && !back.flHero && back.hero && back.bars === 0 && !back.num && !back.sel && !back.head && back.radius !== "4px",
    JSON.stringify(back));
  check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
  await ctx.close();
}

// =================================================================== SPORTS
async function sports(face) {
  const tag = `sports ${face}`;
  // 1600 wide: the title bar's pane takes 280px, so at 1440 the grid holds two
  // 300px cards a row, not three.
  const { ctx, page, errors } = await open({ face, tab: "live", follows: ["football/nfl"], width: 1600 });
  await page.waitForSelector(".navcap, .flc-title");
  await goTo(page, "sports");
  await page.waitForSelector(".fl-game", { timeout: 20_000 });
  // The channel list lands after the schedule: the links appear with it.
  await page.waitForSelector(".fl-game .fl-link", { timeout: 20_000 });
  await settle(page);
  const acc = await accent(page);

  check(`${tag}: the leagues column is 240px`,
    (await page.locator(".fl-aside").evaluate((e) => e.getBoundingClientRect().width)) === 240);
  const top = await page.locator(".fl-folders__list > .fl-nav .fl-nav__name").allInnerTexts();
  check(`${tag}: Filter leagues, then Following and All Sports`,
    (await page.getByRole("searchbox", { name: "Filter leagues" }).count()) === 1 && top.slice(0, 2).join("|") === "Following|All Sports",
    top.slice(0, 2).join("|"));
  const cap = await page.locator(".fl-folders__group .fl-caption").allInnerTexts();
  check(`${tag}: each sport is a caption header with its leagues under it`,
    cap.includes("American Football") && cap.includes("Basketball") && (await page.locator('.fl-folders__group[aria-label="American Football"] .fl-nav', { hasText: "NFL" }).count()) === 1,
    cap.slice(0, 5).join(", "));
  check(`${tag}: a league carries a colour square and today's game count`,
    (await page.locator('.fl-folders__group[aria-label="American Football"] .fl-nav', { hasText: "NFL" }).locator(".fl-swatch").count()) === 1 &&
      (await page.locator('.fl-folders__group[aria-label="American Football"] .fl-nav', { hasText: "NFL" }).locator(".fl-nav__count").innerText()) === "5");
  check(`${tag}: Following is the selected item, with the pill`,
    (await page.locator('.fl-folders__list > .fl-nav[aria-current="true"] .fl-nav__name').innerText()) === "Following" &&
      (await style(page, '.fl-folders__list > .fl-nav[aria-current="true"]', "backgroundColor", "::before")) === acc);

  // Header and the day SelectorBar.
  check(`${tag}: the title is Sports with a subtitle`,
    (await text(page, ".fl-head__title")) === "Sports" && /^Following · 5 games$/.test(await text(page, ".fl-head__sub")),
    await text(page, ".fl-head__sub"));
  const tabs = await page.getByRole("tab").allInnerTexts();
  check(`${tag}: a day SelectorBar reads Today, Tomorrow`, tabs.join("|") === "Today|Tomorrow", tabs.join("|"));
  check(`${tag}: the selected day has the accent pill`,
    (await page.locator('[role="tab"][aria-selected="true"]').innerText()) === "Today" &&
      (await style(page, '[role="tab"][aria-selected="true"]', "backgroundColor", "::after")) === acc);

  // Groups.
  const groups = await page.locator(".fl-group__title").allInnerTexts();
  check(`${tag}: games sit under Live Now, Later Today, Final`, groups.join("|") === "Live Now|Later Today|Final", groups.join("|"));

  // Cards.
  check(`${tag}: a game is an 8px card`, (await style(page, ".fl-game", "borderRadius")) === "8px");
  const pre = await page.locator('.fl-group[aria-label="Later Today"] .fl-game').evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  check(`${tag}: three across in a responsive grid`, pre.length === 3 && new Set(pre).size === 1, pre.join());
  const liveCard = page.locator('.fl-group[aria-label="Live Now"] .fl-game');
  const names = await liveCard.locator(".fl-game__name").allInnerTexts();
  check(`${tag}: the away team is stacked first (football)`, names.join("|") === "Bears|Hawks", names.join("|"));
  check(`${tag}: a 20px colour square, the record and a tabular score`,
    (await liveCard.locator(".fl-game__mark").first().evaluate((e) => [e.getBoundingClientRect().width, getComputedStyle(e).backgroundColor].join())) === "20,rgb(232, 115, 26)" &&
      (await liveCard.locator(".fl-game__record").allInnerTexts()).join() === "8-1,7-2" &&
      (await liveCard.locator(".fl-game__score").allInnerTexts()).join() === "21,24" &&
      /tabular-nums/.test(await liveCard.locator(".fl-game__score").first().evaluate((e) => getComputedStyle(e).fontVariantNumeric)));
  check(`${tag}: a live game's status is accent, with a live dot`,
    (await liveCard.locator(".fl-game__status").innerText()) === "Q4 2:31" &&
      (await liveCard.locator(".fl-game__status").evaluate((e) => getComputedStyle(e).color)) === acc &&
      (await liveCard.locator(".fl-game__dot").count()) === 1);
  const fin = page.locator('.fl-group[aria-label="Final"] .fl-game').first();
  check(`${tag}: on a final the loser is dimmed`,
    (await fin.locator(".is-lost .fl-game__name").innerText()) === "Rams" &&
      (await fin.locator(".is-lost .fl-game__score").evaluate((e) => getComputedStyle(e).color)) !==
        (await fin.locator(".fl-game__team:not(.is-lost) .fl-game__score").evaluate((e) => getComputedStyle(e).color)),
  );
  check(`${tag}: a final has no channel link, only its status`, (await fin.locator(".fl-link").count()) === 0 && (await fin.locator(".fl-game__status").innerText()) === "Final");
  const link = liveCard.locator(".fl-link");
  check(`${tag}: "Live on N channels" is a link button`, /^Live on \d+ channels?$/.test(await link.innerText()), await link.innerText().catch(() => "none"));

  // Header buttons.
  const hb = await page.locator(".fl-head__actions .fl-btn").allInnerTexts();
  check(`${tag}: Compact Results and Multi-View are Fluent buttons in the header`,
    hb.some((t) => /Compact Results/.test(t)) && hb.some((t) => /Multi-View/.test(t)), hb.join("|"));
  await page.getByRole("button", { name: "Compact Results" }).click();
  await settle(page);
  check(`${tag}: Compact Results folds the finals`, (await page.locator(".compactcard").count()) >= 1 && (await page.locator(".fl-group[aria-label=Final] .fl-game").count()) === 0);
  // A pill in Default (100px); WinUI has no pills for rows.
  check(`${tag}: the compact final line has Fluent's 4px corners, not Default's pill`, (await style(page, ".compactcard", "borderRadius")) === "4px", await style(page, ".compactcard", "borderRadius"));
  await page.getByRole("button", { name: "Compact Results" }).click();
  await settle(page);

  // A league click narrows, and it is multi-select.
  const league = (name) => page.locator(".fl-folders__group .fl-nav", { hasText: new RegExp(`^${name}`) }).first();
  await league("NBA").click();
  await settle(page);
  await page.waitForTimeout(400);
  check(`${tag}: a league click picks it, with the pill and fill, and the board narrows to it`,
    (await league("NBA").getAttribute("aria-pressed")) === "true" &&
      (await style(page, '.fl-folders__group .fl-nav[aria-pressed="true"]', "backgroundColor", "::before")) === acc &&
      (await text(page, ".fl-head__sub")) === "NBA · 1 game" &&
      (await page.locator(".fl-game").count()) === 1,
    `${await text(page, ".fl-head__sub")}, ${await page.locator(".fl-game").count()} cards`);
  await league("NFL").click();
  await settle(page);
  await page.waitForTimeout(400);
  check(`${tag}: picks are multi-select`,
    (await page.locator('.fl-folders__group .fl-nav[aria-pressed="true"]').count()) === 2 &&
      (await text(page, ".fl-head__sub")) === "2 leagues · 6 games",
    await text(page, ".fl-head__sub"));
  await league("NBA").click();
  await settle(page);
  check(`${tag}: a second click lifts the pick`, (await league("NBA").getAttribute("aria-pressed")) === "false");
  await page.locator(".fl-folders__list > .fl-nav", { hasText: "Following" }).click();
  await settle(page);
  check(`${tag}: Following clears the picks`, (await page.locator('.fl-folders__group .fl-nav[aria-pressed="true"]').count()) === 0);

  // Follow and unfollow, kept: a star on the row.
  const nba = page.locator(".fl-leaguerow", { hasText: "NBA" }).first();
  await nba.hover();
  check(`${tag}: a star shows on hover`, (await style(page, ".fl-leaguerow:hover .fl-leaguerow__star", "opacity")) === "1");
  await nba.locator(".fl-leaguerow__star").click();
  const follows = () => page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.sports-follows")).data.leagues);
  check(`${tag}: the star follows a league`, (await follows()).includes("basketball/nba"), (await follows()).join());
  await nba.locator(".fl-leaguerow__star").click();
  check(`${tag}: unfollowing takes a second click`,
    (await follows()).includes("basketball/nba") && /Click again/.test((await nba.locator(".fl-leaguerow__star").getAttribute("aria-label")) ?? ""));
  await nba.locator(".fl-leaguerow__star").click();
  check(`${tag}: and the second click removes it`, !(await follows()).includes("basketball/nba"), (await follows()).join());
  await page.getByRole("searchbox", { name: "Filter leagues" }).fill("nfl");
  await settle(page);
  const hits = await page.locator(".fl-folders__group .fl-nav .fl-nav__name").allInnerTexts();
  check(`${tag}: Filter leagues narrows the list by name`, hits.includes("NFL") && !hits.includes("NBA"), hits.join());
  await page.getByRole("searchbox", { name: "Filter leagues" }).fill("");

  // Days.
  await page.getByRole("tab", { name: "Tomorrow" }).click();
  await settle(page);
  check(`${tag}: a day tab shows that day`,
    (await page.locator(".fl-game").count()) === 1 && (await text(page, ".fl-group__title")) === "Scheduled",
    `${await page.locator(".fl-game").count()}`);
  await page.getByRole("tab", { name: "Today" }).click();
  await page.getByRole("button", { name: "Show Earlier Days" }).click();
  await page.getByRole("tab", { name: "Yesterday" }).waitFor({ timeout: 10_000 });
  check(`${tag}: Show Earlier Days adds Yesterday to the bar`, (await page.getByRole("tab").allInnerTexts()).join("|") === "Yesterday|Today|Tomorrow");
  // One control: a SelectorBar of days (the accent pill under the day you are
  // on), its ends two subtle icon buttons, not accent links.
  await page.mouse.move(900, 800);
  await settle(page);
  const bar = await page.evaluate(() => {
    const steps = [...document.querySelectorAll(".fl-tabbar > .fl-tabbar__step")];
    const tabs = document.querySelector(".fl-tabs").getBoundingClientRect();
    return {
      links: document.querySelectorAll(".fl-tabbar .fl-link").length,
      steps: steps.map((b) => ({ name: b.getAttribute("aria-label"), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), bg: getComputedStyle(b).backgroundColor, text: b.textContent.trim(), svg: !!b.querySelector("svg"), before: b.getBoundingClientRect().right <= tabs.left + 1, after: b.getBoundingClientRect().left >= tabs.right - 1 })),
      rule: getComputedStyle(document.querySelector(".fl-tabbar")).borderBottomWidth,
    };
  });
  check(`${tag}: the day bar's ends are subtle icon buttons (earlier before the days, more after), no links`,
    bar.links === 0 && bar.steps.length === 2 && bar.steps.every((s) => s.w === 28 && s.h === 28 && s.bg === "rgba(0, 0, 0, 0)" && s.svg && s.text === "") &&
      bar.steps[0].name === "Show Earlier Days" && bar.steps[0].before && bar.steps[1].name === "Show More Days" && bar.steps[1].after && bar.rule === "0px",
    JSON.stringify(bar));

  // A day bar that cannot load says so in words and offers the way out; the
  // chevron's colour alone says nothing to anyone who can't see it.
  let down = true;
  await page.route(/site\.api\.espn\.com/, (r) => (down ? r.fulfill({ status: 500, body: "no" }) : r.fallback()));
  await page.getByRole("button", { name: "Show More Days" }).click();
  await page.locator(".fl-tabbar__err").waitFor({ timeout: 10_000 }).catch(() => {});
  const err = await page.evaluate(() => {
    const e = document.querySelector(".fl-tabbar__err");
    return e && { text: e.firstChild?.textContent, button: e.querySelector("button")?.textContent, role: e.getAttribute("role"), chevron: document.querySelector(".fl-tabbar__step--more")?.dataset.state };
  });
  check(`${tag}: a day bar that cannot load more days says so, with Try Again`, err && err.text === "Couldn’t load those." && err.button === "Try Again" && err.role === "alert" && err.chevron === "error", JSON.stringify(err));
  down = false;
  // Try Again is the chevron's own click: the day bar goes to "loading" for it.
  // (The board's 30 second cache holds the failure, so it may fail again at
  // once; that is the cache's, as Default's button has it.)
  await page.evaluate(() => {
    window.__states = [];
    new MutationObserver(() => window.__states.push(document.querySelector(".fl-tabbar__step--more")?.dataset.state)).observe(document.querySelector(".fl-tabbar__step--more"), { attributes: true, attributeFilter: ["data-state"] });
  });
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await page.waitForTimeout(500);
  const states = await page.evaluate(() => window.__states);
  check(`${tag}: Try Again asks again (the bar goes to loading for it)`, states.includes("loading"), states.join(">"));

  // A click opens what it opens today.
  await page.getByRole("tab", { name: "Today" }).click();
  await settle(page);
  await page.locator('.fl-group[aria-label="Live Now"] .fl-game__main').click();
  check(`${tag}: a game opens the theater`, (await page.locator(".sportstheater").count()) === 1);
  await page.locator(".sportsrail__tilt").first().waitFor({ timeout: 10_000 }).catch(() => {});
  check(`${tag}: and its channel rows have Fluent's 4px corners, not Default's pills`,
    (await page.locator(".sportsrail__tilt").count()) >= 1 && (await style(page, ".sportsrail__tilt", "borderRadius")) === "4px", `${await page.locator(".sportsrail__tilt").count()} rows, ${await style(page, ".sportsrail__tilt", "borderRadius")}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".fl-game", { timeout: 10_000 });

  await page.screenshot({
    path: `${process.env.SHOT_DIR ?? "/tmp"}/fluent-lists-sports-${face}.png`,
  }).catch(() => {});

  // Default again.
  await page.evaluate(() => { delete document.documentElement.dataset.themePack; });
  await settle(page);
  const back = await page.evaluate(() => ({
    fl: document.querySelectorAll("[class*='fl-']").length,
    side: !!document.querySelector(".sportsside"),
    grid: document.querySelectorAll(".sports__grid .upcard, .sports__grid .compactcard").length,
    row: !!document.querySelector(".media-row .gamecard"),
  }));
  check(`${tag}: switched to Default, today's Sports is back`,
    back.fl === 0 && back.side && back.grid >= 1 && back.row, JSON.stringify(back));
  check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
  await ctx.close();
}

// ===================================================== TENNIS AND GOLF CARDS
// The cards that are not a game keep their layout and take Fluent's corners
// and fill: a tournament (the tennis draw) and a golf round.
async function others(face) {
  const tag = `cards ${face}`;
  const atp = JSON.parse(readFileSync(new URL("atp-scoreboard.json", SPORTS_SRC), "utf8"));
  for (const g of atp.events[0].groupings) for (const c of g.competitions) c.date = "2026-07-26T17:00Z";
  // The golf round is dated into the pinned day, so the board files it there.
  const golfRaw = JSON.parse(readFileSync(new URL("golf-final.json", SPORTS_SRC), "utf8"));
  golfRaw.events[0].date = "2026-07-26T12:00Z";
  const golf = JSON.stringify(golfRaw);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: face, reducedMotion: "reduce" });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|site\.api\.espn\.com)/, (r) => r.abort());
  await ctx.route(/site\.api\.espn\.com/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: /tennis\/atp/.test(r.request().url()) ? JSON.stringify(atp) : /golf\//.test(r.request().url()) ? golf : '{"events":[]}',
    }),
  );
  await ctx.clock.setFixedTime(new Date("2026-07-26T16:00:00Z"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(({ PLAYLISTS }) => {
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
    localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: "fluent" }));
    localStorage.setItem("blammytv.compactResults", JSON.stringify({ v: 1, data: false }));
    localStorage.setItem("blammytv.sports-follows", JSON.stringify({ v: 1, data: { leagues: ["tennis/atp", "golf/pga"], teams: [], conferences: [] } }));
  }, { PLAYLISTS });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-dest="sports"]', { timeout: 60_000 });
  await page.evaluate((face) => {
    document.documentElement.dataset.themePack = "fluent";
    if (face === "light") document.documentElement.dataset.theme = "light";
  }, face);
  await goTo(page, "sports");
  await page.locator(".tourncard").first().waitFor({ timeout: 15_000 });
  await settle(page);
  check(`${tag}: a tournament card and a golf round sit in the grid in Fluent's paint`,
    (await page.locator(".fl-grid .tourncard").count()) >= 1 &&
      (await page.locator(".fl-grid .golfcard").count()) >= 1 &&
      (await style(page, ".fl-grid .golfcard__tilt", "borderRadius")) === "8px" &&
      (await style(page, ".fl-grid .tourncard .upcard__tilt", "borderRadius")) === "8px",
    `${await style(page, ".fl-grid .golfcard__tilt", "borderRadius")}, ${await style(page, ".fl-grid .tourncard .upcard__tilt", "borderRadius")}`);
  await page.screenshot({ path: `${process.env.SHOT_DIR ?? "/tmp"}/fluent-lists-cards-${face}.png` }).catch(() => {});
  await page.locator(".tourncard").first().click();
  check(`${tag}: a tournament still opens its draw`, await page.locator(".tourndraw").waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
  await ctx.close();
}

// ======================================================= NARROW AND THEATER
// The Guide at 1100px: the folders column folds behind a Folders button and
// opens over the grid (a choice, a click outside or Escape shuts it); a wide
// window keeps the column. In the theater the mini-guide folds it too, so the
// strip sits inside the frame with room for three cards. And with real
// scrollbars (a browser that does not hide them), no sideways scroller of the
// Guide shows a bar: Fluent's scrollbar is drawn with the pseudos Default's
// hiding rule rides on, not scrollbar-width.
const proxy = await startProxy();
const browserSb = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", ignoreDefaultArgs: ["--hide-scrollbars"] });
async function narrow(face) {
  const light = face === "light";
  const tag = `narrow ${face}`;
  const { ctx, page } = await openApp(browser, { url: APP, panel: PANEL, proxy, light, w: 1100, h: 700 });
  await page.waitForSelector(".guide__cell", { timeout: 30_000 });
  await settle(page);
  const side = () => page.evaluate(() => {
    const a = document.querySelector(".fl-aside");
    const r = a.getBoundingClientRect();
    const g = document.querySelector(".live-main").getBoundingClientRect();
    return { vis: getComputedStyle(a).visibility, x: Math.round(r.x), w: Math.round(r.width), top: Math.round(r.y), gx: Math.round(g.x), gw: Math.round(g.width) };
  });
  const closed = await side();
  check(`${tag}: at 1100px the folders column is folded and the grid keeps the page's width`, closed.vis === "hidden" && closed.gw >= 700, JSON.stringify(closed));
  const btn = page.getByRole("button", { name: "Folders" });
  check(`${tag}: a Folders button heads the page`, (await btn.count()) === 1 && (await btn.getAttribute("aria-expanded")) === "false");
  await btn.click();
  await settle(page);
  const open = await side();
  check(`${tag}: it opens the column over the grid, which does not move`, open.vis === "visible" && open.w === 280 && open.x + open.w > open.gx + 100 && open.gx === closed.gx && open.gw === closed.gw && (await btn.getAttribute("aria-expanded")) === "true", JSON.stringify(open));
  check(`${tag}: and puts the keyboard in its filter box`, await page.evaluate(() => document.activeElement?.closest(".fl-filter") !== null));
  await page.locator(".fl-folders__list .fl-nav", { hasText: "News" }).first().click();
  await settle(page);
  check(`${tag}: choosing a folder closes it`, (await side()).vis === "hidden" && (await page.locator(".fl-hero, .fl-head__sub").first().innerText()).length > 0);
  await btn.click();
  await page.keyboard.press("Escape");
  await settle(page);
  check(`${tag}: Escape closes it and hands focus back to the button`, (await side()).vis === "hidden" && (await page.evaluate(() => document.activeElement?.classList.contains("fl-head__folders"))));
  await btn.click();
  await page.mouse.click(900, 600);
  await settle(page);
  check(`${tag}: so does a click outside`, (await side()).vis === "hidden");

  await ctx.close();

  // The theater's mini-guide, on a page of its own (the folder above narrowed
  // the Guide to one channel). 1100px has the column as a flyout already; at
  // 1200px it is in the page, and it is the fold that gives the strip its room.
  for (const [tw, th] of [[1100, 700], [1200, 700]]) {
    const t = await openApp(browser, { url: APP, panel: PANEL, proxy, light, w: tw, h: th });
    await openTheater(t.page);
    await t.page.getByRole("button", { name: "Mini-Guide" }).click();
    await t.page.waitForSelector(".mg-card", { timeout: 5000 });
    await wake(t.page);
    const mg = await t.page.evaluate(() => {
      const frame = document.querySelector(".theater-overlay").getBoundingClientRect();
      const s = document.querySelector(".mg-strip").getBoundingClientRect();
      const inside = [...document.querySelectorAll(".mg-card")].filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left >= frame.left - 1 && b.right <= frame.right + 1 && b.top >= frame.top - 1 && b.bottom <= frame.bottom + 1;
      }).length;
      return { stripTop: Math.round(s.top), theaterTop: Math.round(frame.top), inside, folded: getComputedStyle(document.querySelector(".fl-aside")).display };
    });
    check(`${tag}: at ${tw}x${th} the mini-guide's strip sits inside the theater and three cards fit`, mg.stripTop >= mg.theaterTop && mg.inside >= 3, JSON.stringify(mg));
    check(`${tag}: at ${tw}x${th} the folders column is folded while it is open`, mg.folded === "none", JSON.stringify(mg));
    await t.page.keyboard.press("Escape");
    await t.page.waitForTimeout(300);
    check(`${tag}: at ${tw}x${th} it comes back when the mini-guide shuts`, (await t.page.locator(".fl-aside--folded").count()) === 0);
    await t.ctx.close();
  }

  // Wide: the column stays where it was, and there is no Folders button.
  const wide = await openApp(browser, { url: APP, panel: PANEL, proxy, light, w: 1440, h: 900 });
  await wide.page.waitForSelector(".guide__cell", { timeout: 30_000 });
  await settle(wide.page);
  const w = await wide.page.evaluate(() => ({ vis: getComputedStyle(document.querySelector(".fl-aside")).visibility, w: Math.round(document.querySelector(".fl-aside").getBoundingClientRect().width), folders: getComputedStyle(document.querySelector(".fl-head__folders")).display }));
  check(`${tag}: at 1440px the column is in the page and there is no Folders button`, w.vis === "visible" && w.w === 240 && w.folders === "none", JSON.stringify(w));
  await wide.ctx.close();

  // Real scrollbars.
  const sb = await openApp(browserSb, { url: APP, panel: PANEL, proxy, light, w: 1440, h: 900, native: false });
  await sb.page.waitForSelector(".guide__cell", { timeout: 30_000 });
  await settle(sb.page);
  const bars = await sb.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (!/auto|scroll/.test(cs.overflowX)) continue;
      const g = el.offsetHeight - el.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      if (g > 0) out.push(`${el.className} ${g}px`);
    }
    return { out, vertical: [...document.querySelectorAll("body *")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.offsetWidth - el.clientWidth > 0).length };
  });
  check(`${tag}: with real scrollbars the Guide shows no sideways bar`, bars.out.length === 0, bars.out.join(", "));
  check(`${tag}: and its vertical ones are still drawn`, bars.vertical >= 1, String(bars.vertical));
  await sb.ctx.close();
}

for (const face of ["dark", "light"]) {
  await live(face);
  await sports(face);
  await others(face);
  await narrow(face);
}
proxy.close();
await browserSb.close();
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall ok");
process.exit(fail ? 1 : 0);
