// E2E: the Discover tab against fake-aio — toggle, genre rail, grid,
// genre filtering, and the hand-off into the Stream tab's detail page.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem(
    "blammytv.aiostreams",
    JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }),
  );
  // A live source too, or showLive is false and the live half of the nav
  // never renders. This harness has been failing on main at the "Live TV"
  // click for exactly that reason; it needs scripts/fake-m3u.mjs on :8082.
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({ v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U",
      enabled: true, url: "http://localhost:8082/playlist.m3u" }] }),
  );
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page.goto("http://localhost:4173/");
// The capsule (v0.9.1): every destination is a top-level button, and
// each one carries its label as an aria-label, so getByRole still finds it.
// enter the section, then pick the page.
await page.getByRole("button", { name: "Stream", exact: true }).click();
await page.getByRole("button", { name: "Discover", exact: true }).click();
await page
  .waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length > 0, null, { timeout: 20_000 })
  .catch(() => {});

const gridTitles = () =>
  page.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));

let names = await gridTitles();
check("all-content grid conglomerates every catalog",
  names.includes("Fake Movie One") && names.includes("Fake Series One") && names.includes("Extra Movie One"),
  `${names.length} cards`);
// All Content always labels the type, whatever the Card Details setting.
const firstMeta = await page.locator(".disc-grid .stream-card__meta").first().textContent();
const seriesCard = page.locator(".disc-grid .stream-card", { hasText: "Fake Series One" });
const seriesMeta = await seriesCard.locator(".stream-card__meta").textContent().catch(() => "");
check("all-content meta shows the kind",
  (firstMeta ?? "").includes("Movie") && (seriesMeta ?? "").includes("Series"),
  `movie="${firstMeta}" series="${seriesMeta}"`);
check("round-robin order across feeds",
  names[0] === "Fake Movie One" && names[1] === "Fake Series One" && names[2] === "Extra Movie One");

const railNames = await page.$$eval(".genre-card__name", (els) => els.map((e) => e.textContent));
check("genre rail = union of catalog genres", JSON.stringify(railNames) === JSON.stringify(["Action", "Comedy", "Drama"]), railNames.join(","));

// Movies-only via the type chip. It lives in the HEADER capsule now, not
// in Discover's own toggle row, and "All Content" is spelled "Any".
await page.getByRole("button", { name: "Movies", exact: true }).click();
await page.waitForTimeout(600);
names = await gridTitles();
check("Movies filter drops series", names.length === 10 && !names.some((n) => n.startsWith("Fake Series")), `${names.length} cards`);

// Back to All, then filter by Comedy via the rail card.
await page.getByRole("button", { name: "Any", exact: true }).click();
await page.waitForTimeout(400);
await page.locator(".genre-card", { hasText: "Comedy" }).click();
await page.waitForTimeout(700);
names = await gridTitles();
check("Comedy rail filter narrows both types",
  names.includes("Fake Movie Two") && names.includes("Fake Series Two") &&
  !names.includes("Fake Movie One") && !names.includes("Fake Series One"),
  names.join(", "));
check("genre card marked selected", (await page.locator(".genre-card--on").count()) === 1);

// The rail card's own title leads the genre grid (pin-first).
const NAME_BY_ID = { tt1: "Fake Movie", tt2: "Fake Series", tt4: "Extra Movie" };
const pinned = await page.evaluate(() => {
  const memo = JSON.parse(localStorage.getItem("blammytv.discoverArt") ?? "null");
  return memo?.data?.lastByGenre?.comedy?.id ?? null;
});
if (pinned) {
  const word = ["One","Two","Three","Four","Five","Six","Seven","Eight"][Number(pinned.slice(-1)) - 1];
  const family = NAME_BY_ID[pinned.slice(0, 3)];
  check("card art title leads its grid", names[0] === family + " " + word, "pin=" + pinned + " first=" + names[0]);
} else {
  check("card art title leads its grid", false, "no pinned id in art memo");
}

await page.screenshot({ path: process.env.SHOT_DIR + "/discover.png" });

// Hand-off: click a card → Stream tab detail with sources.
await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie Two" }).click();
await page.waitForFunction(() => document.body.innerText.includes("Sources"), null, { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(500);
const text = await page.evaluate(() => document.body.innerText);
check("card opens Stream detail", text.includes("Full synopsis for tt100002") || text.includes("A perfectly fake movie"));
check("stream sources render after hand-off", (await page.locator(".vod-source").count()) === 2);
await page.screenshot({ path: process.env.SHOT_DIR + "/discover-handoff.png" });

// Back from the handed-off detail returns to DISCOVER, not Stream home.
await page.getByRole("button", { name: /back/i }).first().click();
await page.waitForTimeout(600);
check("back returns to Discover grid", (await page.locator(".disc-grid").count()) > 0);
// The nav is one flat capsule now (no section tab + sub-rail), so the
// assertion is simply which destination carries aria-current.
check("nav shows Discover as the active destination",
  (await page.locator('.navcap__item[aria-current="page"]').getAttribute("data-dest")) === "discover");

// ---- Search: the CAPSULE's second row owns the input now; results merge
// every search catalog (incl. search-only) with type labels intact.
//
// It is no longer a chip that hides on the live side — it is a field in
// row 2, and row 2 belongs to Discover alone. So "is it available" is a
// question about that row's height, not about a modifier class.
check("the search field is open on Discover",
  (await page.locator(".navcap__row--sub").evaluate((el) => el.offsetHeight)) > 30);
const typeSearch = async (v) => {
  await page.focus(".navcap__searchinput");
  await page.fill(".navcap__searchinput", v);
};
await typeSearch("two");
await page.waitForTimeout(900); // debounce + fetch
let found = await gridTitles();
check("search merges all search catalogs",
  found.includes("Fake Movie Two") && found.includes("Fake Series Two") && found.includes("Genre Movie Two"),
  found.join(", "));
check("search results respect kind labels",
  (await page.locator(".disc-grid .stream-card__meta").first().textContent() ?? "").match(/Movie|Series/) !== null);
await page.focus(".navcap__searchinput");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape clears back to browse", (await page.locator(".genre-card").count()) > 0);
check("Escape also blurs the search",
  !(await page.evaluate(() => document.activeElement?.classList.contains("navcap__searchinput") ?? false)));
// The Discover TAB itself clears an active search too.
await typeSearch("two");
await page.waitForTimeout(900);
check("search active again", (await page.locator(".genre-card").count()) === 0);
await page.getByRole("button", { name: "Discover", exact: true }).click();
await page.waitForTimeout(400);
check("Discover tab click clears search to browse",
  (await page.locator(".genre-card").count()) > 0 &&
  (await page.inputValue(".navcap__searchinput")) === "");
// Keyboard shortcuts focus the pill on the VOD side.
await page.locator("body").click({ position: { x: 400, y: 500 } });
for (const combo of ["/", "Control+k", "Control+f"]) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(combo);
  await page.waitForTimeout(150);
  const hit = await page.evaluate(() => document.activeElement?.classList.contains("navcap__searchinput") ?? false);
  check("shortcut " + combo + " focuses search", hit);
}
// Typing "/" INSIDE the input must not re-trigger/steal (it just types).
await typeSearch("");
await page.type(".navcap__searchinput", "a/b");
check("slash inside input just types", (await page.inputValue(".navcap__searchinput")) === "a/b");
await typeSearch("");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

/* ---- The capsule nav (v0.9.1).
 *
 * REMOVED WITH THE OLD HEADER, so the checks for them went too rather than
 * being softened: the ChipTabs thumb sliding onto the search chip and home
 * again (search is no longer a chip in a rail); the inert TV-side search
 * button; the rail collapse and the re-centre it caused; and the Stream
 * button's "return to Home" / "remember my last page" double duty. The
 * capsule shows every destination at once, so none of those states exist.
 *
 * What still matters is that opening search never moves the nav, which was
 * a real regression Adam caught, and that the live side has no search. */
const capX = () => page.locator(".navcap").boundingBox().then((b) => b?.x ?? 0);

const navBefore = await capX();
await page.focus(".navcap__searchinput");
await page.waitForTimeout(700); // the input's width morph
check("opening search does not move the capsule",
  Math.abs(navBefore - (await capX())) < 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
check("closing search does not move it either",
  Math.abs(navBefore - (await capX())) < 1);

// TV side: no VOD search to offer, so the field goes.
await page.locator('[data-dest="guide"]').click();
await page.waitForTimeout(400);
check("Guide is the active destination",
  (await page.locator('.navcap__item[aria-current="page"]').getAttribute("data-dest")) === "guide");
check("search is shut on the live side",
  (await page.locator(".navcap__row--sub").evaluate((el) => el.offsetHeight)) === 0);
// `/` from the live side used to do NOTHING, because there was no search
// on that side to reach. There is now: the field lives in Discover's
// second row, so the shortcut GOES there and lands in it. Deliberate, and
// checked from the Guide in verify-discover-search too. It stays inert
// while a player is up (#inv-chrome) and while you are typing.
await page.keyboard.press("/");
await page.waitForTimeout(600);
check("slash from Live jumps to Discover and lands in the field",
  await page.evaluate(() => document.activeElement?.classList.contains("navcap__searchinput") ?? false));
await page.locator('[data-dest="guide"]').click();
await page.waitForTimeout(400);

// The mark holds the window midline whichever side is active: the capsule
// grows unevenly around it, so any drift here means the anchor is broken.
const markOff = async () => page.evaluate(() => {
  const m = document.querySelector(".navcap__mark")?.getBoundingClientRect();
  return m ? Math.abs((m.left + m.width / 2) - window.innerWidth / 2) : 999;
});
check("mark holds the midline on the live side", (await markOff()) < 1.5);
await page.locator('[data-dest="home"]').click();
await page.waitForTimeout(500);
check("mark holds the midline on the VOD side", (await markOff()) < 1.5);
check("Stream lands on the VOD home",
  (await page.locator('.navcap__item[aria-current="page"]').getAttribute("data-dest")) === "home");

// ---- Library. IT IS A PAGE OF LISTS NOW, not one flat grid of saved
// titles, and this whole block was still written for the old shape: it
// looked for "This list is empty" at the top level and expected the saved
// title to appear in Library's own grid. Both were true of a Library that
// no longer exists, so every check here failed against v0.9.17 as well —
// this is rot from that redesign, not from the capsule work.
//
// The shape it actually has: Library shows LIST cards. Saving from a
// detail page puts the title in a list called "My List". You open that
// card to reach the titles. So the grid at the top level holds lists, and
// the grid one level down holds titles, and the two used to be conflated.
await page.locator('[data-dest="mylist"]').click();
await page.waitForTimeout(600);
check("Library empty state names what lands there on its own",
  (await page.locator(".library__empty").textContent() ?? "")
    .includes("Anything you start watching"));
check("and no list cards yet", (await page.locator(".library__card").count()) === 0);

await page.locator('[data-dest="home"]').click();
await page.waitForTimeout(500);
await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page.waitForTimeout(700);
check("the detail offers Add to Library",
  ((await page.locator(".vod-save:not(.vod-save__more)").textContent()) ?? "")
    .includes("Add to Library"));
await page.locator(".vod-save:not(.vod-save__more)").click();
await page.waitForTimeout(300);
check("save button flips to saved", (await page.locator(".vod-save--on").count()) >= 1);
check("and says which list it went to",
  ((await page.locator(".vod-save--on").textContent()) ?? "").includes("My List"));

await page.locator('[data-dest="mylist"]').click();
await page.waitForTimeout(700);
check("Library grows a My List card",
  (await page.locator(".library__card", { hasText: "My List" }).count()) === 1);
check("and the card counts its titles",
  ((await page.locator(".library__card .stream-card__meta").first().textContent()) ?? "")
    .includes("1 title"));

// One level down: the titles themselves.
await page.locator(".library__card", { hasText: "My List" }).click();
await page.waitForTimeout(700);
check("opening the list heads it by name",
  (await page.locator(".library__heading").textContent()) === "My List");
check("the list holds the saved title",
  (await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie One" }).count()) === 1);
check("the title carries its kind label",
  ((await page.locator(".disc-grid .stream-card__meta").first().textContent()) ?? "")
    .includes("Movie"));

await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie One" }).click();
await page.waitForTimeout(700);
check("a list title opens Stream detail", (await page.locator(".vod-back").count()) > 0);
check("and the detail knows it is already saved",
  (await page.locator(".vod-save--on").count()) >= 1);
// The origin plumbing: back lands in the LIST, not at Library's root.
await page.locator(".vod-back").click();
await page.waitForTimeout(600);
check("back from hand-off returns to the open list",
  (await page.locator('.navcap__item[aria-current="page"]').getAttribute("data-dest")) === "mylist" &&
  (await page.locator(".library__heading").textContent().catch(() => "")) === "My List");

// Unsave from the same button, and the list empties.
await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie One" }).click();
await page.waitForTimeout(700);
await page.locator(".vod-save--on").click();
await page.waitForTimeout(300);
await page.locator(".vod-back").click();
await page.waitForTimeout(600);
check("unsave empties the list",
  (await page.locator(".disc-grid .stream-card").count()) === 0);

// ---- Cache seeding: with the Stream cache warm, the unfiltered grid
// paints from it with ZERO catalog fetches; scrolling past the cached
// depth resumes skip pagination on the network.
const page2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page2.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page2.goto("http://localhost:4173/");
await page2.getByRole("button", { name: "Stream", exact: true }).click();
await page2.waitForFunction(() => document.body.innerText.includes("Top Movies"), null, { timeout: 20_000 }).catch(() => {});
await page2.waitForTimeout(600); // let the cache settle
let plainFetches = 0, skipFetches = 0;
page2.on("request", (r) => {
  const u = r.url();
  if (!/8084\/catalog\//.test(u)) return;
  if (/skip/.test(u)) skipFetches++;
  else if (!/genre|search/.test(u)) plainFetches++;
});
await page2.getByRole("button", { name: "Discover", exact: true }).click();
await page2.waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length > 0, null, { timeout: 10_000 }).catch(() => {});
const seeded = await page2.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));
check("warm cache seeds the grid instantly",
  seeded.includes("Fake Movie One") && seeded.includes("Fake Series One") && seeded.includes("Extra Movie One"),
  seeded.length + " cards");
check("zero unfiltered catalog fetches on seed", plainFetches === 0, "plain=" + plainFetches);
await page2.evaluate(() => document.querySelector(".discover")?.scrollTo(0, 99999));
await page2.waitForTimeout(900);
check("scroll past cache resumes skip pagination", skipFetches > 0, "skip=" + skipFetches);
await page2.close();

// ---- One-click play (opt-in, v0.3.48): a movie card click resolves
// sources and plays immediately (no detail page); series still browse.
// In the browser the stage itself can't mount (Tauri-only), so the
// proof is the /stream/ resolve firing + no detail navigation.
const page3 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page3.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] }));
  localStorage.setItem("blammytv.oneClickPlay", JSON.stringify({ v: 1, data: true }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
let streamFetches = 0;
page3.on("request", (r) => { if (/8084\/stream\//.test(r.url())) streamFetches++; });
await page3.goto("http://localhost:4173/");
await page3.getByRole("button", { name: "Stream", exact: true }).click();
await page3.waitForSelector(".stream-card", { timeout: 20_000 });
await page3.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page3.waitForTimeout(900);
check("one-click: movie card fires a stream resolve", streamFetches > 0, "fetches=" + streamFetches);
check("one-click: no detail page opened", (await page3.locator(".vod-detail").count()) === 0);
await page3.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
await page3.waitForTimeout(700);
check("one-click: series still browses", (await page3.locator(".vod-detail").count()) === 1);
await page3.close();

// ---- Queue #7 (v0.3.49): cast line + More Like This on detail;
// "42m left" on CW cards; finished movies retire from the row.
const page4 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page4.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] }));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.watching", JSON.stringify({
    v: 1,
    data: [
      { id: "tt100003", title: "Fake Movie Three", at: 3, posSec: 1200, durSec: 5700, kind: "movie" },
      { id: "tt100005", title: "Fake Movie Five", at: 2, posSec: 5500, durSec: 5700, kind: "movie" }, // finished → retires
      { id: "tt200001", title: "Fake Series One", at: 1, episodeId: "tt200001:1:2", posSec: 5500, durSec: 5700, kind: "series" },
    ],
  }));
});
await page4.goto("http://localhost:4173/");
await page4.getByRole("button", { name: "Stream", exact: true }).click();
await page4.waitForSelector(".continue-card", { timeout: 20_000 });
const cwTitles = await page4.$$eval(".continue-card .stream-card__name", (els) => els.map((e) => e.textContent));
check("finished movie retired from Continue Watching",
  !cwTitles.includes("Fake Movie Five") && cwTitles.includes("Fake Movie Three") && cwTitles.includes("Fake Series One"),
  cwTitles.join(", "));
const cwMeta = await page4.locator(".continue-card", { hasText: "Fake Movie Three" }).locator(".stream-card__meta").textContent();
check("CW card shows time left", (cwMeta ?? "").includes("75m left"), cwMeta ?? "");
// Detail: cast + More Like This (genre-matched, self excluded).
await page4.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page4.waitForSelector(".vod-detail", { timeout: 15_000 });
await page4.waitForTimeout(1200); // full meta + more-like-this fetches
const detailText = await page4.evaluate(() => document.body.innerText);
check("detail shows the cast line", detailText.includes("With Actor A, Actor B"));
const moreTitles = await page4.$$eval(".vod-more__card", (els) => els.map((e) => e.getAttribute("title")));
check("More Like This renders genre neighbors",
  moreTitles.length > 0 && !moreTitles.includes("Fake Movie One"),
  moreTitles.join(", "));
// The shelf lives UNDER the click-transparent body overlay — a card
// click must still land (opens that title's detail).
const firstMore = moreTitles[0];
await page4.locator(".vod-more__card").first().click();
await page4.waitForTimeout(800);
check("shelf card click opens its detail (pointer-events layering)",
  (await page4.evaluate(() => document.body.innerText)).includes(firstMore ?? "@@"));
await page4.screenshot({ path: process.env.SHOT_DIR + "/detail-more.png" });
// Genre pill → Discover with that genre selected — PRIMED WITH AN
// ACTIVE SEARCH first (fleet finding: the hand-off rendered the stale
// search results because the store clear fired before DiscoverScreen's
// subscription existed).
// The field is Discover's now, not the whole VOD side's — page4 is sitting
// on a detail page here, where row 2 is shut and there is nothing to focus.
// Go there first; the rest of the fixture is unchanged.
await page4.locator('[data-dest="discover"]').click();
await page4.waitForTimeout(600);
await page4.focus(".navcap__searchinput");
await page4.fill(".navcap__searchinput", "two");
await page4.waitForTimeout(900); // debounced results on Discover
await page4.locator(".disc-grid .stream-card", { hasText: "Fake Movie Two" }).click();
await page4.waitForTimeout(800); // hand-off to detail, search still stored
await page4.locator(".vod-detail__pills button", { hasText: "Action" }).click();
await page4.waitForTimeout(900);
check("genre pill lands on Discover",
  (await page4.locator('.navcap__item[aria-current="page"]').getAttribute("data-dest")) === "discover");
check("genre pill pre-selects its genre",
  ((await page4.locator(".genre-card--on .genre-card__name").textContent().catch(() => "")) ?? "") === "Action");
check("genre pill wins over a stale search",
  !(await page4.evaluate(() => document.body.innerText)).includes("Results for") &&
  (await page4.inputValue(".navcap__searchinput")) === "");
// Row-cap fine-tune: click the number, type an exact value, Enter.
await page4.locator("button[aria-label='Settings']").click();
await page4.waitForTimeout(400);
// The row cap moved to Customize; there is no AIOStreams tab any more
// (the rail is General / Customize, with sources split inside General).
await page4.getByRole("button", { name: "Customize", exact: true }).click();
await page4.waitForTimeout(400);
await page4.locator(".rowcap__value--btn").click();
await page4.fill(".rowcap__value--edit", "37");
await page4.keyboard.press("Enter");
await page4.waitForTimeout(300);
check("row-cap number is click-to-edit (exact 37 sticks)",
  (await page4.locator(".rowcap__value--btn").textContent()) === "37" &&
  (await page4.evaluate(() => JSON.parse(localStorage.getItem("blammytv.rowCap") ?? "{}").data)) === 37);
await page4.close();

// ---- Aurora easter egg (v0.3.55): hidden until Custom is spam-clicked
// x10; the unlock flips the whole app to the gradient live.
const page5 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page5.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page5.goto("http://localhost:4173/");
await page5.getByRole("button", { name: "Stream", exact: true }).click();
await page5.locator("button[aria-label='Settings']").click();
await page5.waitForTimeout(300);
await page5.getByRole("button", { name: "Customize", exact: true }).click();
await page5.waitForTimeout(400);
// The accent swatches are not in Customize any more — Customize carries a
// LAUNCHER that pops the standalone Themes panel out (and closes Settings).
// The egg lives with the swatches, so the walk has to go one step further.
await page5.locator(".themes-launch").click();
await page5.waitForTimeout(600);
check("aurora swatch hidden before unlock",
  (await page5.locator(".accent-swatch--aurora").count()) === 0);
for (let i = 0; i < 10; i++) {
  await page5.locator(".accent-custom").click();
  await page5.waitForTimeout(40);
}
await page5.waitForTimeout(300);
const egg = await page5.evaluate(() => ({
  style: document.documentElement.dataset.accentStyle ?? null,
  unlocked: JSON.parse(localStorage.getItem("blammytv.auroraUnlocked") ?? "{}").data === true,
  stored: JSON.parse(localStorage.getItem("blammytv.accent-style") ?? "{}").data,
}));
check("spam x10 unlocks + flips to aurora",
  egg.style === "aurora" && egg.unlocked && egg.stored === "aurora", JSON.stringify(egg));
check("aurora swatch now in the picker, checked",
  (await page5.locator(".accent-swatch--aurora").count()) === 1 &&
  (await page5.locator(".accent-swatch--aurora .accent-swatch__check").count()) === 1);
await page5.close();

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
