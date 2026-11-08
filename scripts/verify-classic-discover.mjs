// Headless verify: Classic's Discover body and its REC page (plan 035).
//
// Classic is a theme pack (data-theme-pack="classic"). Phase 1 owns the
// header and the app-wide paint; this file owns the page body: By Genre as
// an etched box of raised buttons, the poster grid as Explorer's Thumbnails
// view, and REC as the Windows wizard. The harness sets the attribute
// itself, which also brings phase 1's header: REC is reached from its band's
// Find Something to Watch button, not the capsule's chip.
//
// Both ways round: Default first (the normal rail, grid and wall), then
// Classic (every interaction), then Default again to show it comes back.
//
// Offline: Cinemeta is aborted and TMDB is answered in the shape tmdb.ts
// parses, as verify-recommender does.
//
// Run, from the REPO ROOT:
//   node scripts/fake-aio.mjs                              # :8084
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-classic-discover.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`);
};

const PLAYLIST = {
  v: 1,
  data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }],
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.route("**://v3-cinemeta.strem.io/**", (r) => r.abort());
await page.route(/api\.themoviedb\.org/, (route) => {
  const u = new URL(route.request().url());
  let body = {};
  if (u.pathname.includes("/genre/")) body = { genres: [] };
  else if (u.pathname.endsWith("/search/keyword")) body = { results: [{ id: 10051, name: u.searchParams.get("query") }] };
  else if (u.pathname.includes("/discover/")) body = { results: [{ id: 348, title: "Alien", release_date: "1979-05-25" }] };
  else if (u.pathname.includes("external_ids")) body = { imdb_id: "tt100001" };
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
await page.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem("blammytv.tmdbKey", JSON.stringify({ v: 1, data: "harness-key" }));
}, PLAYLIST);

const classicOn = () => page.evaluate(() => { document.documentElement.dataset.themePack = "classic"; });
const classicOff = () => page.evaluate(() => { delete document.documentElement.dataset.themePack; });

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".navcap", { timeout: 20_000 });
await goTo(page, "discover");
await page.waitForSelector(".disc-grid .stream-card", { timeout: 20_000 });

// ---- Default: the normal page ------------------------------------------
const defTitles = await page.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));
check("default: the poster grid and the genre rail", defTitles.length > 0 && (await page.locator(".genre-card").count()) === 3);
check("default: nothing of Classic's",
  (await page.locator(".cl-disc-thumbs, .cl-disc-gb, .cl-rec-wiz").count()) === 0);

// ---- Classic: genres ---------------------------------------------------
await classicOn();
await page.waitForSelector(".cl-disc-thumbs", { timeout: 10_000 });
check("classic: the default grid and rail are gone",
  (await page.locator(".disc-grid, .genre-card").count()) === 0);
const gb = await page.locator("fieldset.cl-disc-gb").evaluate((el) => ({
  legend: el.querySelector("legend")?.textContent,
  border: getComputedStyle(el).borderTopWidth,
  radius: getComputedStyle(el).borderTopLeftRadius,
  font: getComputedStyle(el).fontFamily,
}));
check("classic: By Genre is an etched group box, Tahoma, square",
  gb.legend === "By Genre" && gb.border === "1px" && gb.radius === "0px" && /Tahoma/.test(gb.font), JSON.stringify(gb));
const gen = await page.locator(".cl-disc-gbtn").evaluateAll((els) =>
  els.map((e) => ({ t: e.textContent, block: getComputedStyle(e.querySelector("i")).backgroundColor, sh: getComputedStyle(e).boxShadow !== "none" })));
check("classic: a raised button per genre, each with a colour block",
  gen.map((g) => g.t).join(",") === "Action,Comedy,Drama" && gen.every((g) => g.sh && g.block !== "rgba(0, 0, 0, 0)"),
  JSON.stringify(gen));

// ---- Classic: the thumbnails -------------------------------------------
const lb = page.locator(".cl-disc-thumbs");
// The sunken area is shorter than the default grid's cards, so more pages
// can have paged in by now: the first ones must match, in order.
const capTitles = await page.$$eval(".cl-disc-thumb__cap b", (els) => els.map((e) => e.textContent));
check("classic: the grid is a listbox of options", (await lb.getAttribute("role")) === "listbox" &&
  (await page.locator('.cl-disc-thumbs [role="option"]').count()) === capTitles.length);
check("classic: the same titles in the same order",
  capTitles.length >= defTitles.length && JSON.stringify(capTitles.slice(0, defTitles.length)) === JSON.stringify(defTitles));
const area = await lb.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, sh: getComputedStyle(el).boxShadow }));
check("classic: a sunken white area", area.bg === "rgb(255, 255, 255)" && area.sh !== "none", JSON.stringify(area));
const art = await page.locator(".cl-disc-thumb__art").first().evaluate((el) => ({
  w: getComputedStyle(el).borderTopWidth, col: getComputedStyle(el).borderTopColor,
}));
check("classic: each poster in a thin white frame", art.w === "3px" && art.col === "rgb(255, 255, 255)", JSON.stringify(art));
const sub = await page.locator(".cl-disc-thumb__cap small").first().textContent().catch(() => "");
check("classic: a year and runtime line under the title", /^(\d{4})?( · )?(\d+ min)?$/.test(sub ?? ""), sub ?? "none");
check("classic: nothing selected yet",
  (await page.locator(".cl-disc-thumb--sel").count()) === 0 &&
  (await page.locator('.cl-disc-thumbs [tabindex="0"]').count()) === 1);

// Keyboard: arrows move, the focused title is the selected one.
await page.locator('.cl-disc-thumbs [role="option"]').first().focus();
await page.keyboard.press("ArrowRight");
const sel1 = await page.locator(".cl-disc-thumb--sel .cl-disc-thumb__cap b").evaluate((el) => ({
  t: el.textContent, bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color,
}));
check("classic: ArrowRight selects the next title, navy caption white text",
  sel1.t === defTitles[1] && sel1.bg === "rgb(10, 36, 106)" && sel1.fg === "rgb(255, 255, 255)", JSON.stringify(sel1));
const cols = await page.locator('.cl-disc-thumbs [role="option"]').evaluateAll(
  (els) => els.filter((e) => e.offsetTop === els[0].offsetTop).length);
await page.keyboard.press("ArrowDown");
const down = await page.locator(".cl-disc-thumb--sel .cl-disc-thumb__cap b").textContent();
check("classic: ArrowDown moves a row", down === defTitles[1 + cols], `cols=${cols} got=${down}`);
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowLeft");
check("classic: ArrowUp and ArrowLeft come back",
  (await page.locator(".cl-disc-thumb--sel .cl-disc-thumb__cap b").textContent()) === defTitles[0]);
await page.keyboard.press("End");
check("classic: End goes to the last title",
  (await page.locator(".cl-disc-thumb--sel .cl-disc-thumb__cap b").textContent()) ===
    (await page.$$eval(".cl-disc-thumb__cap b", (els) => els.at(-1).textContent)));
check("classic: one selection and one tab stop",
  (await page.locator(".cl-disc-thumb--sel").count()) === 1 &&
  (await page.locator('.cl-disc-thumbs [tabindex="0"]').count()) === 1);
await page.screenshot({ path: (process.env.SHOT_DIR ?? "/tmp") + "/classic-discover.png" });

// Genre picking is today's: the page becomes that genre's rows.
await page.locator(".cl-disc-gbtn", { hasText: "Comedy" }).click();
await page.waitForSelector(".genre-rows .stream-card", { timeout: 10_000 });
const rows = await page.$$eval(".genre-rows .stream-card__name", (els) => els.map((e) => e.textContent));
check("classic: a genre button opens that genre's rows",
  rows.includes("Fake Movie Two") && !rows.includes("Fake Movie One"), rows.join(", "));
check("classic: and shows pressed", (await page.locator(".cl-disc-gbtn[aria-pressed=true]").textContent()) === "Comedy");
await page.locator(".cl-disc-gbtn", { hasText: "Comedy" }).click();
await page.waitForSelector(".cl-disc-thumbs", { timeout: 10_000 });
check("classic: pressing it again clears the genre",
  (await page.locator(".cl-disc-gbtn[aria-pressed=true]").count()) === 0 &&
  (await page.locator('.cl-disc-thumbs [role="option"]').count()) >= defTitles.length);

// Open: a click hands off to Stream, as a card does.
await page.locator(".cl-disc-thumb", { hasText: "Fake Movie Two" }).first().click();
await page.waitForSelector(".clt-srcs .clt-lr", { timeout: 15_000 }).catch(() => {});
check("classic: a click opens the title in Stream", (await page.locator(".clt-srcs .clt-lr").count()) === 2);
await page.getByRole("button", { name: /back/i }).first().click();
await page.waitForSelector(".cl-disc-thumbs", { timeout: 10_000 });
// Enter on the focused one opens it too.
await page.locator('.cl-disc-thumbs [role="option"]').first().focus();
await page.keyboard.press("Enter");
await page.waitForSelector(".clt-srcs .clt-lr", { timeout: 15_000 }).catch(() => {});
check("classic: Enter opens the focused title", (await page.locator(".clt-srcs .clt-lr").count()) >= 1);
await page.getByRole("button", { name: /back/i }).first().click();
await page.waitForSelector(".cl-disc-thumbs", { timeout: 10_000 });

// ---- Classic: REC ------------------------------------------------------
await page.locator(".cl-band .cl-rec").click();
await page.waitForSelector(".cl-rec-wiz", { timeout: 8000 });
check("classic: REC is the wizard, with no drifting wall",
  (await page.locator(".rec__wall, .rec__stage").count()) === 0);
const title = await page.locator(".cl-rec-title").evaluate((el) => ({
  t: el.textContent, bg: getComputedStyle(el).backgroundImage, fg: getComputedStyle(el).color,
}));
check("classic: a navy title bar, Find Something to Watch",
  /^Find Something to Watch/.test(title.t ?? "") && /gradient/.test(title.bg) && title.fg === "rgb(255, 255, 255)", JSON.stringify(title));
check("classic: What are you in the mood for?",
  (await page.locator(".cl-rec-pane h3").textContent()) === "What are you in the mood for?");
const side = await page.locator(".cl-rec-side img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
check("classic: three posters from the page's own catalog in the side panel",
  side.length === 3 && side.every((s) => /localhost:8084\/poster\//.test(s ?? "")), side.join(" "));
check("classic: Watch Now waits for a pick, Find waits for a word",
  (await page.getByRole("button", { name: "Watch Now" }).isDisabled()) &&
  (await page.getByRole("button", { name: "Find", exact: true }).isDisabled()));
check("classic: the keyword field has focus", await page.locator(".cl-rec-field").evaluate((el) => el === document.activeElement));

// Words: Enter and Add both make a tag; a tag's ✕ takes it back.
await page.locator(".cl-rec-field").fill("heist");
await page.keyboard.press("Enter");
await page.locator(".cl-rec-field").fill("funny");
await page.getByRole("button", { name: "Add", exact: true }).click();
check("classic: Enter and Add each make a tag",
  (await page.locator(".cl-rec-tag").allTextContents()).join("|") === "heist ✕|funny ✕");
await page.locator(".cl-rec-field").fill("heist");
await page.keyboard.press("Enter");
check("classic: a repeated word adds no tag", (await page.locator(".cl-rec-tag").count()) === 2);
await page.getByRole("button", { name: "Remove funny" }).click();
check("classic: a tag's ✕ removes it", (await page.locator(".cl-rec-tag").count()) === 1);
await page.locator(".cl-rec-field").focus();
await page.keyboard.press("Backspace");
check("classic: Backspace on an empty field takes the last tag back", (await page.locator(".cl-rec-tag").count()) === 0);
await page.locator(".cl-rec-field").fill("heist");
await page.keyboard.press("Enter");

// Find: ONE pick, with its details; Find Again and Watch Now come alive.
await page.getByRole("button", { name: "Find", exact: true }).click();
await page.waitForSelector(".cl-rec-pick", { timeout: 12_000 });
const pick = await page.locator(".cl-rec-pick").innerText();
check("classic: Your pick, with the title and its details",
  /Your pick/.test(pick) && /Fake Movie One/.test(pick), pick.replace(/\n/g, " | "));
check("classic: Find becomes Find Again, Watch Now is live",
  (await page.getByRole("button", { name: "Find Again" }).isEnabled()) &&
  (await page.getByRole("button", { name: "Watch Now" }).isEnabled()));
await page.screenshot({ path: (process.env.SHOT_DIR ?? "/tmp") + "/classic-rec.png" });
await page.getByRole("button", { name: "Find Again" }).click();
await page.waitForSelector(".cl-rec-pick", { timeout: 12_000 });
check("classic: Find Again rolls again", (await page.locator(".cl-rec-pick").count()) === 1);
check("classic: the TMDB credit stays", /TMDB API but is not endorsed/.test(await page.locator(".cl-rec-credit").textContent()));

// Watch Now opens the pick in Stream. (Back from Stream lands on the grid,
// as it does in Default: a tab flip does not keep the recommender.)
await page.getByRole("button", { name: "Watch Now" }).click();
await page.waitForSelector(".clt-srcs .clt-lr", { timeout: 15_000 }).catch(() => {});
check("classic: Watch Now opens the pick in Stream", (await page.locator(".clt-srcs .clt-lr").count()) >= 1);
await page.getByRole("button", { name: /back/i }).first().click();
await page.waitForSelector(".cl-disc-thumbs, .cl-rec-wiz", { timeout: 10_000 });

// Close leaves REC for the grid beneath it.
if ((await page.locator(".cl-rec-wiz").count()) === 0) {
  await page.locator(".cl-band .cl-rec").click();
  await page.waitForSelector(".cl-rec-wiz", { timeout: 8000 });
}
await page.getByRole("button", { name: "Close", exact: true }).last().click();
await page.waitForSelector(".cl-disc-thumbs", { timeout: 10_000 });
check("classic: Close returns to the poster grid", (await page.locator(".cl-rec-wiz").count()) === 0);
await page.locator(".cl-band .cl-rec").click();
await page.waitForSelector(".cl-rec-wiz", { timeout: 8000 });
await page.getByRole("button", { name: "Close", exact: true }).first().click();
await page.waitForSelector(".cl-disc-thumbs", { timeout: 10_000 });
check("classic: the title bar's ✕ closes it too", (await page.locator(".cl-rec-wiz").count()) === 0);

// ---- Default again ------------------------------------------------------
await classicOff();
await page.waitForSelector(".disc-grid .stream-card", { timeout: 10_000 });
const back = await page.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));
check("default again: the normal grid and rail are back, unchanged",
  JSON.stringify(back.slice(0, defTitles.length)) === JSON.stringify(defTitles) && (await page.locator(".genre-card").count()) === 3 &&
  (await page.locator(".cl-disc-thumbs, .cl-disc-gb").count()) === 0);
await page.locator('.navcap__row--sub [data-key="rec"]').click();
await page.waitForSelector(".rec__wall", { timeout: 8000 });
check("default again: REC has its wall, input and sparkle, and no wizard",
  (await page.locator(".rec__input, .rec__go").count()) === 2 && (await page.locator(".cl-rec-wiz").count()) === 0);

check("no page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
