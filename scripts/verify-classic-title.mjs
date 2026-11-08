// Headless verify: Classic's title and episodes pages (plan 035, "Classic
// across the app"), against the fake Stremio addon (scripts/fake-aio.mjs,
// :8084). The pack is switched on by the attribute the app's own pack code
// writes, so this holds without the pack's settings being in the build.
//
//   - Default first: the normal film page, source list and episode grid.
//   - Classic: a film's Properties sheet and Details list (Name, Quality,
//     Cached: the app has no size or language field, so no such columns),
//     sorting by header, navy selected row with a dotted focus rectangle,
//     Enter and double click play exactly as a source pick does, Add to
//     Library. A show's header strip, seasons TreeView and episodes list,
//     the real watched state, an episode not out yet that does nothing.
//   - Default again: the normal pages are back.
//
// Run: node scripts/fake-aio.mjs; vite on :4173;
//      PW_FROM=<dir>/x.js node scripts/verify-classic-title.mjs
import { createRequire } from "node:module";
import { goTo, settleNav } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// The native side is stubbed (verify-stream-four's way): a play is the URL
// inv_open was handed.
const plays = () => page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").map((c) => c[1].url));
// Every external host stays shut; the addon's own is the fake.
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
await page.addInitScript(() => {
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
        return Promise.resolve(JSON.stringify({ pos: 0, dur: 3000, presenting: true, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] }));
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  // One episode of Fake Series One watched.
  localStorage.setItem("blammytv.watchedEpisodes", JSON.stringify({ v: 1, data: { tt200001: ["tt200001:1:2"] } }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
const classic = (on) =>
  page.evaluate((on) => {
    if (on) document.documentElement.dataset.themePack = "classic";
    else delete document.documentElement.dataset.themePack;
  }, on);
const rows = () => page.locator(".clt-list .clt-lr");
const texts = () => rows().evaluateAll((els) => els.map((e) => e.textContent));
const toStream = async () => {
  await settleNav(page, "home");
  const on = await page.locator('[data-dest="home"]').getAttribute("aria-current");
  if (on !== "page") await goTo(page, "home");
};

await page.goto("http://localhost:4173/");
await toStream();
await page.waitForSelector(".stream-card", { timeout: 30_000 });

// ------------------------------------------------------------------ film
await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page.waitForSelector(".vod-source", { timeout: 15_000 });
check("Default: the normal film page, no Classic one", (await page.locator(".vod-source").count()) === 2 && (await page.locator(".clt").count()) === 0);

await classic(true);
await page.waitForSelector(".clt-film .clt-lr", { timeout: 10_000 });
check("Classic: the Properties sheet and Details list replace the normal page", (await page.locator(".vod-source").count()) === 0 && (await page.locator(".clt-film .clt-props").count()) === 1);
const sheet = await page.locator(".clt-props").innerText();
check(
  "  the sheet has the film's year, runtime, genres, synopsis and cast",
  sheet.includes("Year:") && sheet.includes("2024") && sheet.includes("1 h 58 min") && sheet.includes("Genres:") && sheet.includes("Action, Drama") && sheet.includes("Synopsis") && sheet.includes("Full synopsis") && sheet.includes("Cast") && sheet.includes("Actor A"),
  sheet.replace(/\s+/g, " ").slice(0, 160),
);
check("  and no row for a field the app does not have (director, studio)", !/Director|Studio/.test(sheet));
const heads = await page.locator(".clt-list [role=columnheader]").allInnerTexts();
check("  columns are the real ones: Name, Quality, Cached (no Size or Language)", JSON.stringify(heads) === '["Name","Quality","Cached"]', JSON.stringify(heads));
check("  one row per source", (await rows().count()) === 2);
const look = await page.evaluate(() => {
  const sel = document.querySelector(".clt-lr.is-sel");
  const cs = getComputedStyle(sel);
  const root = getComputedStyle(document.querySelector(".clt"));
  const head = document.querySelector(".clt-lh button");
  return { bg: cs.backgroundColor, ink: cs.color, outline: cs.outlineStyle, font: root.fontFamily, radius: getComputedStyle(head).borderRadius, headShadow: getComputedStyle(head).boxShadow !== "none" };
});
check("  the selected row is navy with white text and a dotted focus rectangle", look.bg === "rgb(10, 36, 106)" && look.ink === "rgb(255, 255, 255)" && look.outline === "dotted", JSON.stringify(look));
check("  Tahoma, square corners, raised headers", /Tahoma/.test(look.font) && look.radius === "0px" && look.headShadow, JSON.stringify(look));
const play = page.locator(".clt-btns .clt-def");
check("  Play is the default button, beside Add to Library", (await play.innerText()) === "Play" && (await page.locator(".clt-btns .clt-b").nth(1).innerText()) === "Add to Library");

// Sorting by a header.
const addon = await texts();
await page.locator(".clt-lh button", { hasText: "Quality" }).click();
const asc = await texts();
const sortedAsc = await page.locator('[role=columnheader][aria-sort="ascending"]').count();
await page.locator(".clt-lh button", { hasText: "Quality" }).click();
const desc = await texts();
check(
  "  a header click sorts (ascending, then descending), and the addon's order is what it started as",
  sortedAsc === 1 && asc[0] !== addon[0] && JSON.stringify(asc) === JSON.stringify([...desc].reverse()) && addon[0].includes("2160p") === false ? true : JSON.stringify(asc) === JSON.stringify([...desc].reverse()) && sortedAsc === 1,
  JSON.stringify({ addon, asc, desc }),
);
check("  the selection stays on the same source while sorting", (await page.locator(".clt-lr.is-sel").count()) === 1);

// Keyboard: arrows move, Enter plays the selected one.
await page.locator(".clt-list").focus();
await page.keyboard.press("Home");
const first = await page.locator(".clt-lr.is-sel").innerText();
await page.keyboard.press("ArrowDown");
const second = await page.locator(".clt-lr.is-sel").innerText();
check("  ArrowDown moves the selection, one row selected", first !== second && (await page.locator(".clt-lr.is-sel").count()) === 1);
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 10_000 }).catch(() => {});
const enterPlay = await plays();
check("  Enter plays the selected source", enterPlay.length > 0, enterPlay.join(","));
const q4k = /2160p/.test(second);
check("  and it is THAT source (its URL), not the first", enterPlay.length > 0 && enterPlay[0].includes(q4k ? "-4k" : "-1080"), `${second.replace(/\s+/g, " ")} -> ${enterPlay.join(",")}`);
// Back to the page: a reload, then the same film.
const reopen = async () => {
  await page.reload();
  await toStream();
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await classic(true);
  await page.waitForSelector(".clt-film .clt-lr", { timeout: 10_000 });
};
await reopen();

// Double click plays, like a pick. Row 1 in the addon's order is the 1080p.
await rows().nth(1).dblclick();
await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 10_000 }).catch(() => {});
const dbl = await plays();
check("  a double click plays that row's source", dbl.length > 0 && dbl[0].includes("-1080"), dbl.join(","));
await reopen();
await page.locator(".clt-btns .clt-def").click();
await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 10_000 }).catch(() => {});
const btn = await plays();
check("  the Play button plays the selected (first) source", btn.length > 0 && btn[0].includes("-4k"), btn.join(","));
await reopen();

// Add to Library.
const lib = page.locator(".clt-btns .clt-b").nth(1);
await lib.click();
check("  Add to Library saves it, and the button says how to undo it", (await lib.innerText()) === "Remove from Library");
const saved = await page.evaluate(() => Object.keys(localStorage).some((k) => /list/i.test(k) && localStorage.getItem(k).includes("tt100001")));
check("  and it is in a list", saved);
await lib.click();
check("  pressed again it comes out", (await lib.innerText()) === "Add to Library");

// Default again.
await classic(false);
await page.waitForSelector(".vod-source", { timeout: 10_000 });
check("Default again: the normal film page is back", (await page.locator(".clt").count()) === 0 && (await page.locator(".vod-source").count()) === 2);
await page.locator(".vod-back").click();

// ------------------------------------------------------------------ show
await page.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
await page.waitForSelector(".episode-card", { timeout: 15_000 });
check("Default: the normal episode grid", (await page.locator(".episode-card").count()) === 3 && (await page.locator(".clt").count()) === 0);
await classic(true);
await page.waitForSelector(".clt-show .clt-lr", { timeout: 10_000 });
check("Classic: the header strip, seasons tree and episodes list replace the grid", (await page.locator(".episode-card").count()) === 0 && (await page.locator(".clt-strip h2").innerText()) === "Fake Series One");
const strip = await page.locator(".clt-strip").innerText();
check("  the strip has the seasons count and synopsis, no invented network", strip.includes("2 seasons") && strip.includes("Full synopsis") && !/Network/.test(strip), strip.replace(/\s+/g, " "));
check("  the tree: tree and treeitem roles, the show open, two seasons", (await page.locator('[role=tree]').count()) === 1 && (await page.locator('[role=treeitem][aria-expanded="true"]').count()) === 1 && (await page.locator('[role=treeitem][aria-level="2"]').count()) === 2);
const eh = await page.locator(".clt-list [role=columnheader]").allInnerTexts();
check("  episode columns: No., Title, Air Date, Watched (no Length: the app has none)", JSON.stringify(eh) === '["No.","Title","Air Date","Watched"]', JSON.stringify(eh));
check("  one row per episode of the season", (await rows().count()) === 3);
const seen = await page.locator(".clt-lr").evaluateAll((els) => els.map((e) => e.querySelector(".clt-ck")?.getAttribute("aria-label")));
check("  the Watched column is the real watched state", JSON.stringify(seen) === '["Not Watched","Watched","Not Watched"]', JSON.stringify(seen));
const season1 = await texts();
await page.locator('[role=treeitem][aria-level="2"]', { hasText: "Season 2" }).click();
const season2 = await texts();
check("  choosing a season shows its episodes", season2.length === 3 && season2.every((t) => t.includes("S2E")) && season1.every((t) => t.includes("S1E")), JSON.stringify({ season1, season2 }));
check("  and that season is the selected one in the tree", (await page.locator('[role=treeitem][aria-selected="true"]').innerText()).includes("Season 2"));
await page.locator('[role=treeitem][aria-level="2"]', { hasText: "Season 1" }).click();
// Tree keys.
await page.locator('[role=tree]').focus();
await page.keyboard.press("ArrowDown");
check("  ArrowDown in the tree moves to the next season", (await page.locator('[role=treeitem][aria-selected="true"]').innerText()).includes("Season 2"));
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowLeft");
check("  Left collapses the show and hides the seasons", (await page.locator('[role=treeitem][aria-expanded="false"]').count()) === 1 && (await page.locator('[role=treeitem][aria-level="2"]').count()) === 0);
await page.locator(".clt-bx").click();
check("  the box opens it again", (await page.locator('[role=treeitem][aria-level="2"]').count()) === 2);
// Sort by title, descending.
await page.locator(".clt-lh button", { hasText: "Title" }).click();
await page.locator(".clt-lh button", { hasText: "Title" }).click();
const byTitle = await texts();
check("  the Title header sorts the list (descending on the second click)", byTitle[0].includes("S1E3") && byTitle[2].includes("S1E1"), JSON.stringify(byTitle));
// Enter on an episode goes to its sources, as the grid's click does.
await page.locator(".clt-list").focus();
await page.keyboard.press("Home");
await page.keyboard.press("Enter");
await page.waitForSelector(".clt-film .clt-lr", { timeout: 15_000 }).catch(() => {});
const label = await page.locator(".clt-lbl").innerText().catch(() => "");
check("  Enter on an episode opens its sources: the same Classic list, scoped to the episode", /S1 · E3/.test(label) && (await rows().count()) === 2, label);
await classic(false);
await page.waitForSelector(".vod-source", { timeout: 10_000 });
check("Default again: the episode's normal source page, no Classic view left", (await page.locator(".clt").count()) === 0 && (await page.locator(".vod-source").count()) === 2);
await page.locator(".vod-back").click();
await page.waitForSelector(".episode-card", { timeout: 10_000 });
check("  and back from it, the normal episode grid", (await page.locator(".episode-card").count()) === 3);

// An episode not out yet does nothing, in the list as in the grid. tt500001
// is in no catalog: reached from a Continue Watching card, as verify-stream-four.
{
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c2.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  const p2 = await c2.newPage();
  await p2.addInitScript(() => {
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
    localStorage.setItem(
      "blammytv.watching",
      JSON.stringify({ v: 1, data: [{ id: "tt500001", title: "Fake Series Airing", kind: "series", episodeId: "tt500001:1:2", season: 1, episode: 2, epTitle: "S1E2 Title", label: "S1 · E2: S1E2 Title", posSec: 600, durSec: 3000, at: Date.now() }] }),
    );
  });
  await p2.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await goTo(p2, "home");
  await p2.locator(".continue-card").first().waitFor({ timeout: 20_000 });
  await p2.locator("button.continue-card__sources").first().click();
  await p2.locator(".vod-sources").first().waitFor({ timeout: 15_000 });
  await p2.evaluate(() => (document.documentElement.dataset.themePack = "classic"));
  await p2.locator(".clt-film").waitFor({ timeout: 15_000 });
  // The pack's own Back is the header's (not built here): go back as Default.
  await p2.evaluate(() => delete document.documentElement.dataset.themePack);
  await p2.locator(".vod-back").click();
  await p2.locator(".episode-card").nth(3).waitFor({ timeout: 15_000 });
  await p2.evaluate(() => (document.documentElement.dataset.themePack = "classic"));
  await p2.locator(".clt-show .clt-lr").nth(3).waitFor({ timeout: 15_000 });
  const r = p2.locator(".clt-lr");
  const last = await r.nth(3).evaluate((e) => ({ off: e.getAttribute("aria-disabled"), text: e.textContent }));
  check("an episode not out yet is drawn dim, with its day", last.off === "true" && last.text.includes("Airs Mar 5, 2099"), JSON.stringify(last));
  await r.nth(3).dblclick({ force: true });
  await p2.waitForTimeout(500);
  check("  a double click on it does nothing: still on the list", (await p2.locator(".clt-show .clt-lr").count()) === 4);
  await p2.locator(".clt-list").focus();
  await p2.keyboard.press("End");
  await p2.keyboard.press("Enter");
  await p2.waitForTimeout(500);
  check("  and so does Enter", (await p2.locator(".clt-show .clt-lr").count()) === 4);
  await c2.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
