// E2E: a provider's movies and shows in Stream (plan 028, batches 2 and 3, and
// the picker redesigned), against scripts/fake-panel.mjs on :8081 and its user
// "vod" (Adam's panel's real shapes: folders, a film held twice as a 4K copy and
// a plain one, a show in two seasons with a 4K copy of its first, an adult folder
// flagged by the panel, one caught by its name, and a title flagged in an
// ordinary folder). The Tauri commands are stubbed as verify-jellyfin stubs
// them: mpv_status answers, http_get forwards to the fake, and every inv_open is
// kept, so what the app hands the player (the address, and the User-Agent with
// it) is read as it was sent. Offline, as every harness is: every host but
// localhost is aborted.
//
// The three views that pick a provider's folders, none of them live (each stages
// the picks and a button commits them):
// - B, Collections: Xtream alone and nothing picked, the page IS a grid of folder
//   cards. Movies offers 4K Movies, Action and Comedy, and not the two adult
//   folders; Shows offers Drama and Sitcoms. A click stages a folder (and again
//   unstages it) and changes nothing until "Show Rows", which turns the page into
//   the rows, in the order they were picked. With AIOStreams signed in too the
//   page is not B: the rows are AIOStreams' and D's button is after them. Two
//   libraries are grouped under their names.
// - D, the Rows drawer: the button after the rows ("Edit Rows", or "Add Rows from
//   Your Playlist" before a pick). A real dialog (focus in, Tab stays in, Escape
//   closes, focus back on the button). A switch, a drag or a remove changes the
//   rows behind it only on Done; Escape and the x discard. Reordered by keyboard
//   (Space, ArrowDown, Space) and by mouse, an Escape on a lifted row puts it
//   back and shuts nothing.
// - C, Settings: under the playlist, Your Rows (pills, dragged or lifted into
//   order, an x to remove) and More Folders (a click adds), saved with Save and
//   put back with Discard. Stream follows, and a reload keeps the order.
// Picks saved by v0.12.1 and v0.12.2 (two lists) still make their rows. The light
// theme draws B and D with the theme's own surfaces and ink, and reduced motion
// takes the drag, the hover and the slide out.
//
// - Picking costs no list call: the lists are read once each. A reload keeps the
//   picks, the order and the rows, from disk, with no list call made again inside
//   the TTL.
// - The film opens with two sources, the 4K first; playing it hands mpv the 4K
//   copy's address and the playlist's own User-Agent.
// - A show opens its two seasons; an episode lists a source per copy; playing
//   the first plays the 4K copy's episode, titled "Episode 1".
// - Continue Watching has both, from Xtream, and resuming one asks the
//   playlist's library and nothing from AIOStreams.
// - Live TV still loads its channels for the same playlist.
// - A playlist with no movies or shows, or whose library is switched off, leaves
//   Stream as it was: "No Movies or Shows Yet", and (switched off) no list call.
// - Settings → Playback and Ctrl+K see a library as they see a Jellyfin.
// - Settings → Sources (batch 4): a playlist with a provider library has the
//   switch and its rows under it, a live-only playlist has neither; the switch
//   off empties Stream (and costs no download to turn back on); removing the
//   playlist drops its choices, its record of what it held and its lists on disk.
// - What no playlist owns is cleared at launch: a record on disk for a playlist
//   that is not saved (a settings import replaced the list) is gone after a
//   reload, the saved playlists' records stay, and they hold a hash of the
//   account and not the account.
// - Discover (batch 5): with only a library, the grid is the provider's titles,
//   newest first, with no genre rail; the Movies and Series chips filter it;
//   a search finds a film in a folder nobody picked and a show; a result opens
//   and plays the provider's file; nothing is found in a library switched off.
//
//   (vite on :4173; scripts/fake-panel.mjs on :8081)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-xtvod.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PANEL = "http://localhost:8081";
const UA = "BlammyHarness/1.0 (xtvod)";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const playlist = (user = "vod", extra = {}) => ({
  kind: "xtream",
  id: "vod1",
  name: "Vod Panel",
  enabled: true,
  server: PANEL,
  username: user,
  password: "p",
  userAgent: UA,
  ...extra,
});

const panelLog = async () => (await fetch(`${PANEL}/__log`)).json();
const clearLog = () => fetch(`${PANEL}/__log?clear=1`).then((r) => r.json());
const LISTS = ["get_vod_streams", "get_series", "get_vod_categories", "get_series_categories"];
const listCalls = (log, user = "vod") => log.filter((c) => LISTS.includes(c.action) && c.user === user);

// ------------------------------------------------------------ the page
const stub = ({ playlists, seeds, connected }) => {
  window.__calls = [];
  window.__pos = 600;
  window.__dur = 6000;
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: async (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      // The other accounts a play could be reported to, when a scenario says they are signed in.
      if (connected && cmd === "aiojf_status") return { connected: true, userName: "u", userId: "x", base: "http://localhost:8084/jellyfin" };
      if (connected && cmd === "trakt_status") return { configured: true, connected: true };
      if (connected && cmd === "aiojf_request") return { status: 200, body: JSON.stringify({ Items: [] }) };
      if (connected && cmd === "trakt_request") return { status: 200, body: "[]" };
      if (cmd === "mpv_status")
        return JSON.stringify({ pos: window.__pos, dur: window.__dur, presenting: true, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] });
      return undefined;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  // Seeded once per tab: a reload keeps what the page wrote since.
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: playlists }));
  for (const [k, v] of Object.entries(seeds)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
/** A page in a context of its own: each scenario starts from what it seeds. */
async function openPage({ playlists = [playlist()], seeds = {}, connected = false, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.requests = [];
  p.on("request", (r) => p.requests.push(r.url()));
  await p.addInitScript(stub, { playlists, seeds, connected });
  await p.goto(APP, { waitUntil: "domcontentloaded" });
  return p;
}
const waitFor = async (p, fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(200);
  }
  return false;
};
const storeOf = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
/** What the player was opened with for a provider's film or episode. */
const opens = (p) =>
  p.evaluate(() =>
    window.__calls
      .filter(([c, a]) => c === "inv_open" && /\/(movie|series)\//.test(a.url))
      .map(([, a]) => ({ url: a.url, userAgent: a.userAgent ?? null })),
  );
const pick = (kind, id) => ({ kind, id });
const ACTION = pick("movie", "12");
const COMEDY = pick("movie", "13");
const DRAMA = pick("series", "12");
// B: Stream's empty page.
const coll = (p) => p.locator("[data-xtcoll]");
const cardNames = (p) => coll(p).locator(".xtcard__name").allInnerTexts();
const card = (p, name) => coll(p).locator(".xtcard", { hasText: new RegExp(`^${name}$`) });
const showBtn = (p) => coll(p).getByRole("button", { name: /^Show( \d+ Rows?| Rows)$/ });
const kindTab = (scope, name) => scope.getByRole("button", { name, exact: true });
// D: the drawer and the button that opens it.
const rowsBtn = (p) => p.getByRole("button", { name: /^(Edit Rows|Add Rows from Your Playlist)$/ });
const drawer = (p) => p.locator(".xtdrawer");
const mine = (p) => drawer(p).locator("[data-xtdrawer-rows] .xtrow__name").allInnerTexts();
const grip = (p, name) => drawer(p).getByRole("button", { name: `Reorder ${name}` });
const folderSwitch = (p, name) => drawer(p).getByRole("switch", { name });
const counted = (p) => drawer(p).locator(".xtdrawer__count").innerText();
async function openDrawer(p) {
  await rowsBtn(p).click();
  await drawer(p).waitFor({ timeout: 5000 });
  await p.waitForTimeout(350); // the slide
}
const drawerGone = (p) => drawer(p).waitFor({ state: "detached", timeout: 5000 });
const done = async (p) => {
  await drawer(p).getByRole("button", { name: "Done", exact: true }).click();
  await drawerGone(p);
  await p.waitForTimeout(300);
};
/** Lift a row with the keyboard, move it, drop it. */
async function liftAndMove(p, name, keys) {
  await grip(p, name).focus();
  await p.keyboard.press("Space");
  await p.waitForTimeout(120); // dnd-kit hears the arrows a tick after the lift
  for (const k of keys) {
    await p.keyboard.press(k);
    await p.waitForTimeout(150);
  }
  await p.keyboard.press("Space");
  await p.waitForTimeout(300);
}
/** Drag one handle onto another with the pointer. */
async function dragOnto(p, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 8, { steps: 4 });
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 8, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);
}
const pickIds = (picks) => (picks ?? []).map((x) => `${x.kind}:${x.id}`);
const storedPicks = async (p, pid = "vod1") => pickIds((await storeOf(p, "xtVod"))?.[pid]?.picks);
const rowTitles = (p) => p.locator(".media-row__title").allInnerTexts();
const rowCards = (p, title) =>
  p
    .locator(".media-row", { has: p.locator(".media-row__title", { hasText: new RegExp(`^${title}$`) }) })
    .locator(".stream-card__name")
    .allInnerTexts();
/** Back out of a play: the overlay's Back needs the pointer over it. */
async function leavePlayer(p) {
  await p.waitForTimeout(800);
  const ov = await p.locator(".theater-overlay").first().boundingBox();
  await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await p.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await p.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await p.waitForTimeout(800);
}

// What the fake serves, read straight from it: the refusals below are only
// worth anything if the panel really offers what they refuse.
{
  const cats = await (await fetch(`${PANEL}/player_api.php?username=vod&password=p&action=get_vod_categories`)).json();
  const names = cats.map((c) => c.category_name);
  check("(control) the panel serves the two adult folders and the flagged film the app must leave out", names.includes("Premium Vault") && names.includes("XXX Movies"), JSON.stringify(names));
  const films = await (await fetch(`${PANEL}/player_api.php?username=vod&password=p&action=get_vod_streams`)).json();
  check("  and the film it flags in an ordinary folder", films.some((f) => f.name.startsWith("Flagged In Plain Sight") && f.is_adult === 1 && f.category_id === "12"));
}

// ============================================ Xtream alone, the whole story
await clearLog();
const p = await openPage();
await coll(p).waitFor({ timeout: 20_000 });

// ---- 1. the first visit: B, the folders, is the page
{
  const movies = await cardNames(p);
  await kindTab(coll(p), "Shows").click();
  const shows = await cardNames(p);
  await kindTab(coll(p), "Movies").click();
  check("the first visit to Stream is the folder cards, and no row yet", (await p.locator(".media-row").count()) === 0 && !(await rowsBtn(p).count()), JSON.stringify(await rowTitles(p)));
  check(
    "  Movies offers 4K Movies, Action and Comedy, and not the adult folders",
    movies.length === 3 && ["4K Movies", "Action", "Comedy"].every((n) => movies.includes(n)) && !movies.includes("Premium Vault") && !movies.includes("XXX Movies"),
    JSON.stringify(movies),
  );
  check("  Shows offers Drama and Sitcoms", shows.length === 2 && shows.includes("Drama") && shows.includes("Sitcoms"), JSON.stringify(shows));
  const text = await coll(p).innerText();
  check("  with one playlist the heading does not name it, and it says what picking does", /^Choose Folders\n/.test(text) && !/Vod Panel/.test(text) && /Each folder you pick becomes a row on Stream\./.test(text), JSON.stringify(text.slice(0, 90)));
  check("  every folder starts off, and the button says Show Rows and cannot be pressed", (await coll(p).locator(".xtcard[aria-pressed='true']").count()) === 0 && (await showBtn(p).innerText()) === "Show Rows" && (await showBtn(p).isDisabled()));
  // A fan of the folder's newest posters: Action has more than three titles, Drama two.
  const fan = (name) => card(p, name).locator("img.xtfan__img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  const action = await fan("Action");
  check("  each card is a fan of its three newest posters (the fake's one image, three times for Action)", action.length === 3 && action.every((u) => /^http:\/\/localhost:8081\/logo\.png$/.test(u)), JSON.stringify(action));
  await kindTab(coll(p), "Shows").click();
  check("  and a folder with two titles, two", (await fan("Drama")).length === 2);
  await kindTab(coll(p), "Movies").click();
  check("  no AIOStreams was asked", !p.requests.some((u) => u.includes(":8084")));

  // Hover opens the fan (the control for the reduced-motion page below).
  const left = card(p, "4K Movies").locator(".xtfan__l");
  const shut = await left.evaluate((e) => getComputedStyle(e).transform);
  await card(p, "4K Movies").hover();
  await p.waitForTimeout(500);
  const open = await left.evaluate((e) => getComputedStyle(e).transform);
  check("(control) the pointer over a card opens its fan, which reduced motion's page below leaves shut", shut !== open && shut !== "none", `${shut} -> ${open}`);
  await p.mouse.move(5, 500);
}

// ---- 2. stage folders in B: nothing changes until the button, then the rows in the order picked
{
  await card(p, "Action").click();
  check("a click stages a folder: the card is pressed, with a check, and the button counts it", (await card(p, "Action").getAttribute("aria-pressed")) === "true" && (await card(p, "Action").locator(".xtcard__check").count()) === 1 && (await showBtn(p).innerText()) === "Show 1 Row" && (await showBtn(p).isEnabled()));
  await card(p, "Action").click();
  check("  a second click unstages it, and the button is Show Rows again, disabled", (await card(p, "Action").getAttribute("aria-pressed")) === "false" && (await card(p, "Action").locator(".xtcard__check").count()) === 0 && (await showBtn(p).innerText()) === "Show Rows" && (await showBtn(p).isDisabled()));
  // Picked in this order: Comedy, Drama (on the other tab), Action.
  await card(p, "Comedy").click();
  await kindTab(coll(p), "Shows").click();
  await card(p, "Drama").click();
  await kindTab(coll(p), "Movies").click();
  await card(p, "Action").click();
  check("  a folder staged on the other tab stays staged, and the button counts all three", (await showBtn(p).innerText()) === "Show 3 Rows" && (await card(p, "Comedy").getAttribute("aria-pressed")) === "true");
  await p.waitForTimeout(1500);
  const log = await panelLog();
  check(
    "staging changed nothing: no row, still the folders, nothing stored, and the lists were read once each",
    (await p.locator(".media-row").count()) === 0 && (await coll(p).count()) === 1 && (await storedPicks(p)).length === 0 && LISTS.every((a) => listCalls(log).filter((c) => c.action === a).length === 1),
    JSON.stringify(await storeOf(p, "xtVod")),
  );

  await showBtn(p).click();
  await p.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 5000 });
  await coll(p).waitFor({ state: "detached", timeout: 5000 });
  const titles = await rowTitles(p);
  check("Show Rows turns the page into the rows, in the order they were picked: Comedy, Drama, Action", JSON.stringify(titles.filter((t) => ["Comedy", "Drama", "Action"].includes(t))) === JSON.stringify(["Comedy", "Drama", "Action"]) && titles.length === 3, JSON.stringify(titles));
  check("  the picks are stored as that list, and are the app's own: not on the playlist", JSON.stringify(await storedPicks(p)) === JSON.stringify(["movie:13", "series:12", "movie:12"]) && !("picks" in ((await storeOf(p, "playlists"))?.[0] ?? {})), JSON.stringify(await storeOf(p, "xtVod")));
  const cards = await rowCards(p, "Action");
  const f4 = cards.filter((n) => n === "The Fantastic 4: First Steps").length;
  check("  Action has the film once, whichever copy the panel files it under, and not the title the panel flags", f4 === 1 && cards.includes("Kitchen Sink Story") && cards.length >= 4 && !cards.includes("Flagged In Plain Sight"), JSON.stringify(cards));
  const drama = await rowCards(p, "Drama");
  check("  Drama has the show once (its 4K copy sits in the other folder)", drama.filter((n) => n === "Two Season Show").length === 1 && drama.includes("Plain Series"), JSON.stringify(drama));
  check("  a hero of the picked shows", (await p.locator(".shero__card").count()) > 0);
  check("  and after the rows, the one button, now Edit Rows", (await rowsBtn(p).innerText()) === "Edit Rows" && (await rowsBtn(p).count()) === 1);
  // Centered under the rows (Adam), not at their left edge.
  const centred = await p.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Edit Rows")?.getBoundingClientRect();
    const rows = document.querySelector(".stream__rows")?.getBoundingClientRect();
    return b && rows ? Math.abs(b.left + b.width / 2 - (rows.left + rows.width / 2)) : null;
  });
  check("  in the middle of the page under them", centred !== null && centred < 4, String(centred));
  const calls = listCalls(await panelLog());
  check("every pick cost no call at all: the lists were read once each", LISTS.every((a) => calls.filter((c) => c.action === a).length === 1), JSON.stringify(calls.map((c) => c.action)));
}

// ---- 3. D: the Rows drawer
{
  await openDrawer(p);
  const inside = () => p.evaluate(() => !!document.activeElement?.closest(".xtdrawer"));
  check("the button opens a dialog named Rows, and focus moves into it", (await p.getByRole("dialog", { name: "Rows" }).count()) === 1 && (await inside()));
  let stayed = true;
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press("Tab");
    if (!(await inside())) stayed = false;
  }
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press("Shift+Tab");
    if (!(await inside())) stayed = false;
  }
  check("  Tab and Shift+Tab stay inside it", stayed);
  const text = await drawer(p).innerText();
  check("  it has a search, Movies and Shows, Your Rows and every folder with a switch, and the count", /Your Rows/.test(text) && /Folders/.test(text) && (await drawer(p).getByPlaceholder("Search Folders").count()) === 1 && /3 Rows On/.test(text), JSON.stringify(text.slice(0, 140)));
  check("  Your Rows are in the order they were picked", JSON.stringify(await mine(p)) === JSON.stringify(["Comedy", "Drama", "Action"]), JSON.stringify(await mine(p)));
  const on = async (name) => (await folderSwitch(p, name).getAttribute("aria-checked")) === "true";
  check("  and the switches say which: Movies has Action and Comedy on, 4K Movies off", (await on("4K Movies, Movies")) === false && (await on("Action, Movies")) && (await on("Comedy, Movies")));
  await kindTab(drawer(p), "Shows").click();
  check("  Shows has Drama on and Sitcoms off, and not the adult folders anywhere", (await on("Drama, Shows")) && !(await on("Sitcoms, Shows")) && !/Premium Vault|XXX Movies/.test(await drawer(p).innerText()));
  await kindTab(drawer(p), "Movies").click();

  // Nothing is live.
  await folderSwitch(p, "4K Movies, Movies").click();
  check("a switch changes the drawer: the row is added to Your Rows at the end, and the count", JSON.stringify(await mine(p)) === JSON.stringify(["Comedy", "Drama", "Action", "4K Movies"]) && (await counted(p)) === "4 Rows On", JSON.stringify(await mine(p)));
  check("  and nothing behind it: the rows on the page and the stored picks are as they were", !(await rowTitles(p)).includes("4K Movies") && (await rowTitles(p)).length === 3 && (await storedPicks(p)).length === 3);
  await p.keyboard.press("Escape");
  await drawerGone(p);
  check("Escape closes it and discards: focus is back on the button, and the rows and the picks are as they were", (await p.evaluate(() => document.activeElement?.textContent)) === "Edit Rows" && (await rowTitles(p)).length === 3 && (await storedPicks(p)).length === 3);
  await openDrawer(p);
  check("  reopened, the switch is off again: the draft went with the drawer", (await mine(p)).length === 3 && !(await on("4K Movies, Movies")));
  await folderSwitch(p, "4K Movies, Movies").click();
  await drawer(p).getByRole("button", { name: "Close", exact: true }).click();
  await drawerGone(p);
  check("the x closes it the same way, and discards", (await storedPicks(p)).length === 3 && !(await rowTitles(p)).includes("4K Movies"));

  // Reorder by keyboard: Space lifts, ArrowDown moves, Space drops.
  await openDrawer(p);
  await grip(p, "Comedy, Movies").focus();
  await p.keyboard.press("Space");
  await p.waitForTimeout(120);
  await p.keyboard.press("ArrowDown");
  await p.waitForTimeout(100);
  const moving = await drawer(p).locator("[data-xtdrawer-rows] .xtrow").nth(1).evaluate((e) => getComputedStyle(e).transitionDuration);
  await p.keyboard.press("Space");
  await p.waitForTimeout(400);
  check("a row lifted with Space and moved with ArrowDown lands one place down: Drama, Comedy, Action", JSON.stringify(await mine(p)) === JSON.stringify(["Drama", "Comedy", "Action"]), JSON.stringify(await mine(p)));
  check("  the rows that make room glide to their places for 200ms (reduced motion's page below does not)", moving === "0.2s", moving);
  const live = await p.evaluate(() => [...document.querySelectorAll("[aria-live]")].map((e) => e.textContent).join(" | "));
  check("  and it was announced in the app's words", /Dropped Comedy, Movies at row 2 of 3\./.test(live), live);
  check("  nothing behind it has moved yet: the rows on the page are Comedy, Drama, Action and the stored picks the same", JSON.stringify((await rowTitles(p))) === JSON.stringify(["Comedy", "Drama", "Action"]) && JSON.stringify(await storedPicks(p)) === JSON.stringify(["movie:13", "series:12", "movie:12"]), JSON.stringify(await rowTitles(p)));
  await done(p);
  check("Done commits it: the rows are Drama, Comedy, Action, and the picks are stored in that order", JSON.stringify(await rowTitles(p)) === JSON.stringify(["Drama", "Comedy", "Action"]) && JSON.stringify(await storedPicks(p)) === JSON.stringify(["series:12", "movie:13", "movie:12"]), JSON.stringify(await rowTitles(p)));
  check("  and focus is back on the button", (await p.evaluate(() => document.activeElement?.textContent)) === "Edit Rows");

  // Escape on a lifted row puts it back and shuts nothing.
  await openDrawer(p);
  await grip(p, "Drama, Shows").focus();
  await p.keyboard.press("Space");
  await p.waitForTimeout(120);
  await p.keyboard.press("ArrowDown");
  await p.waitForTimeout(150);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  check("Escape on a lifted row puts it back and the drawer stays open", (await drawer(p).count()) === 1 && JSON.stringify(await mine(p)) === JSON.stringify(["Drama", "Comedy", "Action"]), JSON.stringify(await mine(p)));
  await p.keyboard.press("Escape");
  await drawerGone(p);

  // Reorder by mouse.
  await openDrawer(p);
  await dragOnto(p, grip(p, "Action, Movies"), grip(p, "Drama, Shows"));
  check("a row dragged by its handle with the pointer lands where it was dropped: Action, Drama, Comedy", JSON.stringify(await mine(p)) === JSON.stringify(["Action", "Drama", "Comedy"]), JSON.stringify(await mine(p)));
  await done(p);
  check("  and Done commits that order", JSON.stringify(await rowTitles(p)) === JSON.stringify(["Action", "Drama", "Comedy"]) && JSON.stringify(await storedPicks(p)) === JSON.stringify(["movie:12", "series:12", "movie:13"]), JSON.stringify(await rowTitles(p)));

  // Remove with the x, and add with a switch: at the end.
  await openDrawer(p);
  await drawer(p).getByRole("button", { name: "Remove Drama, Shows", exact: true }).click();
  check("the x on a row takes it out of Your Rows (and its switch off), nothing else", JSON.stringify(await mine(p)) === JSON.stringify(["Action", "Comedy"]) && (await counted(p)) === "2 Rows On", JSON.stringify(await mine(p)));
  await p.keyboard.press("Escape");
  await drawerGone(p);
  check("  and Escape leaves the row where it was", (await rowTitles(p)).includes("Drama") && (await storedPicks(p)).length === 3);
  await openDrawer(p);
  await drawer(p).getByRole("button", { name: "Remove Drama, Shows", exact: true }).click();
  await done(p);
  check("  Done takes the row away", JSON.stringify(await rowTitles(p)) === JSON.stringify(["Action", "Comedy"]) && !(await p.locator(".shero__card").count()), JSON.stringify(await rowTitles(p)));
  await openDrawer(p);
  await kindTab(drawer(p), "Shows").click();
  await folderSwitch(p, "Drama, Shows").click();
  check("a switch adds its row at the end of Your Rows", JSON.stringify(await mine(p)) === JSON.stringify(["Action", "Comedy", "Drama"]), JSON.stringify(await mine(p)));
  await kindTab(drawer(p), "Movies").click();
  await drawer(p).getByPlaceholder("Search Folders").fill("zzz");
  check("  and the search narrows the folders by name (and says so when none match)", (await drawer(p).locator(".xtfolder").count()) === 0 && /No folders match “zzz”\./.test(await drawer(p).innerText()));
  await drawer(p).getByPlaceholder("Search Folders").fill("ACT");
  check("  whatever the case", JSON.stringify(await drawer(p).locator(".xtfolder__name").allInnerTexts()) === JSON.stringify(["Action"]));
  await done(p);
  check("  Done: Action, Comedy, Drama", JSON.stringify(await rowTitles(p)) === JSON.stringify(["Action", "Comedy", "Drama"]), JSON.stringify(await rowTitles(p)));
  const calls = listCalls(await panelLog());
  check("none of it cost a call: the lists were read once each", LISTS.every((a) => calls.filter((c) => c.action === a).length === 1), JSON.stringify(calls.map((c) => c.action)));
}

// ---- 3b. a reload: the picks, their order and the rows from storage, the lists from disk
{
  await clearLog();
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
  await p.locator(".media-row__title", { hasText: /^Drama$/ }).waitFor({ timeout: 5000 });
  const cards = await rowCards(p, "Action");
  check("a reload keeps the picks, the order and the rows: Action, Comedy, Drama", cards.includes("The Fantastic 4: First Steps") && JSON.stringify(await rowTitles(p)) === JSON.stringify(["Action", "Comedy", "Drama"]) && (await coll(p).count()) === 0, JSON.stringify(await rowTitles(p)));
  await p.waitForTimeout(2500);
  const calls = listCalls(await panelLog());
  check("  and no list call was made again, inside the TTL: the lists came off disk", calls.length === 0, JSON.stringify(calls.map((c) => c.action)));
}

// ---- 4. a film: its sources, and what mpv is given
{
  await p.locator('.stream-card[data-hint="The Fantastic 4: First Steps"]').first().click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const sources = await p.locator(".vod-source").allInnerTexts();
  check("the film opens with two sources, 2160p first and then HD", sources.length === 2 && /2160p/.test(sources[0]) && /HD/.test(sources[1]) && !/2160p/.test(sources[1]), JSON.stringify(sources));
  const detail = await p.locator(".vod-detail").first().innerText();
  check("  with the page the panel gave it (synopsis and year)", /The plot of 4K The Fantastic 4/.test(detail) && /2025/.test(detail), detail.slice(0, 160));
  const log = await panelLog();
  const info = log.filter((c) => c.action === "get_vod_info");
  check("  one get_vod_info, for the 4K copy", info.length === 1, JSON.stringify(info.map((c) => c.path)));
  await p.locator(".vod-source").first().click();
  const started = await waitFor(p, async () => (await opens(p)).length > 0, 15_000);
  const first = (await opens(p))[0];
  check("playing the first hands mpv the 4K copy's address", started && first.url === `${PANEL}/movie/vod/p/3001.mkv`, first?.url);
  check("  with the playlist's own User-Agent", first?.userAgent === UA, String(first?.userAgent));
  const cw = await storeOf(p, "watching");
  check("  Continue Watching keeps it, and that it came from Xtream", cw?.[0]?.id === "xt:vod1:m:t617126" && cw[0].from === "xt" && cw[0].kind === "movie", JSON.stringify(cw?.[0]));
  check("  and AIOStreams was not told (a play that is not its)", !p.requests.some((u) => u.includes(":8084")));
  await leavePlayer(p);
  await goTo(p, "home");
}

// ---- 5. a show: its seasons, an episode's sources
{
  await p.locator('.stream-card[data-hint="Two Season Show"]').first().click({ timeout: 10_000 });
  await p.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  const text = await p.locator(".stream").innerText();
  check("the show opens its two seasons", /Season 1/.test(text) && /Season 2/.test(text) && !/Season 3/.test(text), text.slice(0, 120).replace(/\n/g, " | "));
  const eps = await p.locator(".episode-card").allInnerTexts();
  check("  season 1 lists three episodes, the first titled Episode 1", eps.length === 3 && /Episode 1/.test(eps[0]), JSON.stringify(eps));
  const log = await panelLog();
  const infos = log.filter((c) => c.action === "get_series_info");
  check("  both copies were read (4K and plain)", infos.length === 2, `${infos.length} get_series_info`);
  await p.locator(".episode-card").first().click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const sources = await p.locator(".vod-source").allInnerTexts();
  const label = await p.locator(".vod-detail__episode").first().innerText().catch(() => "");
  check("the episode lists a source per copy, 2160p first", sources.length === 2 && /2160p/.test(sources[0]), JSON.stringify(sources));
  check("  titled Episode 1", /Episode 1/.test(label), label);
  check("  and opening it read no show again", (await panelLog()).filter((c) => c.action === "get_series_info").length === infos.length);
  await p.locator(".vod-source").first().click();
  const started = await waitFor(p, async () => (await opens(p)).some((o) => o.url.includes("/series/")), 15_000);
  const ep = (await opens(p)).find((o) => o.url.includes("/series/"));
  check("playing it hands mpv the 4K copy's episode", started && ep?.url === `${PANEL}/series/vod/p/400201.mkv`, ep?.url);
  check("  with the playlist's own User-Agent", ep?.userAgent === UA, String(ep?.userAgent));
  const cw = await storeOf(p, "watching");
  const e = cw?.find((x) => x.id === "xt:vod1:s:t70001");
  check(
    "  Continue Watching keeps the episode under the show's key",
    e?.from === "xt" && e.episodeId === "xt:vod1:s:t70001:1:1" && e.season === 1 && e.episode === 1 && e.title === "Two Season Show",
    JSON.stringify(e),
  );
  await leavePlayer(p);
  await goTo(p, "home");
}

// ---- 6. Continue Watching resumes through the library
{
  const card = p.locator(".continue-card", { hasText: "The Fantastic 4: First Steps" }).first();
  await card.waitFor({ timeout: 10_000 });
  check("Continue Watching has the film and the show", (await p.locator(".continue-card", { hasText: "Two Season Show" }).count()) === 1);
  const before = (await opens(p)).length;
  const asked = (await panelLog()).length;
  await card.click();
  const again = await waitFor(p, async () => (await opens(p)).length > before, 15_000);
  const last = (await opens(p)).at(-1);
  check("resuming the film from its card plays the same file", again && last.url === `${PANEL}/movie/vod/p/3001.mkv` && last.userAgent === UA, JSON.stringify(last));
  check("  through the Xtream library: nothing was asked of AIOStreams", !p.requests.some((u) => u.includes(":8084")));
  // The card's title is the library's own (Stream's catalogItem), and a film's
  // files are built from the library: nothing is left to ask the panel.
  const asks = (await panelLog()).slice(asked).filter((c) => c.path === "/player_api.php");
  check("  and the panel's API was asked nothing at all: the title and its files came from the library", asks.length === 0, JSON.stringify(asks.map((c) => c.action)));
  await leavePlayer(p);
  await goTo(p, "home");
}

// ---- Settings → Playback and Ctrl+K see the library
{
  await p.keyboard.press("Control+k");
  await p.locator(".palette").waitFor({ timeout: 4000 });
  const names = await p.evaluate(() => [...document.querySelectorAll(".palette .mvpick__row .mvpick__nametext")].map((r) => r.textContent));
  await p.keyboard.press("Escape");
  await p.locator(".palette").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("Ctrl+K with only a library has Stream, Discover and Library to go to", ["Stream", "Discover", "Library"].every((n) => names.includes(n)), JSON.stringify(names));
  await p.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 15_000 });
  await p.locator(".settings__body").first().waitFor({ timeout: 10_000 });
  await p.getByRole("tab", { name: "Playback", exact: true }).click();
  await p.waitForTimeout(400);
  const have = await p.evaluate(() => ["one-click-play", "autoplay-next"].map((id) => document.querySelectorAll(`.settings__body [data-setting="${id}"]`).length));
  check("  and Settings → Playback shows Stream's rows, not the sign-in note", have.every((n) => n === 1) && !/to see these settings/.test(await p.locator(".settings__body").innerText()), JSON.stringify(have));
  await p.getByRole("tab", { name: "Appearance", exact: true }).click();
  await p.waitForTimeout(400);
  check("  and Appearance shows Card Details", (await p.locator('.settings__body [data-setting="card-details"]').count()) === 1);
  await p.keyboard.press("Escape");
  await p.locator(".settings__body").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

// ---- 7. Live TV, for the same playlist
{
  await goTo(p, "guide");
  const loaded = await p.locator(".guide__channel", { hasText: "Fake ESPN 4K" }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
  check("Live TV still loads the same playlist's channels", loaded);
}
await p.context().close();

// ============================================ the control: adult content shown
{
  const q = await openPage({
    seeds: { showAdult: true, xtVod: { vod1: { picks: [ACTION] } } },
  });
  await q.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
  const cards = await rowCards(q, "Action");
  check("(control) with adult content shown, the film the panel flags is in the Action row", cards.includes("Flagged In Plain Sight") && cards.includes("The Fantastic 4: First Steps"), JSON.stringify(cards));
  await openDrawer(q);
  const offered = await drawer(q).locator(".xtfolder__name").allInnerTexts();
  check("  and the drawer offers the two adult folders", offered.includes("Premium Vault") && offered.includes("XXX Movies"), JSON.stringify(offered));
  await q.context().close();
  const b = await openPage({ seeds: { showAdult: true } });
  await coll(b).waitFor({ timeout: 20_000 });
  const folders = await cardNames(b);
  check("  and so does B", folders.includes("Premium Vault") && folders.includes("XXX Movies"), JSON.stringify(folders));
  await b.context().close();
}

// ============================================ picks saved by v0.12.1 and v0.12.2
// Two lists, movies and shows, drawn in the panel's folder order. They are read
// as one list (movies first, then shows, each as saved) and rewritten as the list
// when something changes.
{
  const q = await openPage({ seeds: { xtVod: { vod1: { picks: { series: ["12"], movie: ["13", "12"] } } } } });
  await q.locator(".media-row__title", { hasText: /^Drama$/ }).waitFor({ timeout: 20_000 });
  check("picks saved as two lists still make their rows: movies, then shows, each in its saved order", JSON.stringify(await rowTitles(q)) === JSON.stringify(["Comedy", "Action", "Drama"]), JSON.stringify(await rowTitles(q)));
  await openDrawer(q);
  check("  and the drawer shows them in that order", JSON.stringify(await mine(q)) === JSON.stringify(["Comedy", "Action", "Drama"]), JSON.stringify(await mine(q)));
  await done(q);
  check("  Done with nothing changed leaves what was saved as it was", !Array.isArray((await storeOf(q, "xtVod")).vod1.picks));
  await openDrawer(q);
  await liftAndMove(q, "Drama, Shows", ["ArrowUp", "ArrowUp"]);
  await done(q);
  check("  and a drag writes the list: Drama, Comedy, Action", JSON.stringify(await rowTitles(q)) === JSON.stringify(["Drama", "Comedy", "Action"]) && JSON.stringify(await storedPicks(q)) === JSON.stringify(["series:12", "movie:13", "movie:12"]), JSON.stringify(await storeOf(q, "xtVod")));
  await q.context().close();
}

// ============================================ AIOStreams signed in too
// B is the page only when the provider is all Stream has. With an addon (signed
// in) its rows are the page, and the button after them opens the drawer.
{
  const q = await openPage({ seeds: { aiostreams: "http://localhost:8084/manifest.json" } });
  await q.locator(".media-row__title", { hasText: /^Top Movies$/ }).waitFor({ timeout: 20_000 });
  await q.waitForTimeout(1500);
  check("with AIOStreams signed in, the page is its rows and not the folders", (await coll(q).count()) === 0 && (await q.locator(".media-row").count()) > 0 && q.requests.some((u) => u.includes(":8084")), JSON.stringify(await rowTitles(q)));
  check("  and the button after them offers the provider's rows: Add Rows from Your Playlist", (await rowsBtn(q).count()) === 1 && (await rowsBtn(q).innerText()) === "Add Rows from Your Playlist");
  await openDrawer(q);
  check("  the drawer has no rows yet and says what to do", JSON.stringify(await mine(q)) === "[]" && /No rows yet\. Switch on a folder below\./.test(await drawer(q).innerText()) && (await counted(q)) === "No Rows On");
  await folderSwitch(q, "Action, Movies").click();
  check("  and switching a folder on changes nothing behind it", !(await rowTitles(q)).includes("Action") && (await storedPicks(q)).length === 0);
  await done(q);
  const titles = await rowTitles(q);
  check("  Done adds the row after AIOStreams' own, and the button is Edit Rows", titles.at(-1) === "Action" && titles.includes("Top Movies") && (await rowsBtn(q).innerText()) === "Edit Rows", JSON.stringify(titles));
  await q.context().close();
}

// ============================================ AIOStreams and Trakt signed in too
// A play is reported to the addon's sync and scrobbled to Trakt, when they are
// connected, and a provider's play is neither's: it has no id either knows. The
// addon's report would have counted it as a play it could not name (Settings
// shows that count), and so it is not made for one at all. The tick the episode
// list shows is the app's own, kept here.
{
  const q = await openPage({ connected: true, seeds: { xtVod: { vod1: { picks: [ACTION, DRAMA] } } } });
  await q.locator('.stream-card[data-hint="The Fantastic 4: First Steps"]').first().click({ timeout: 20_000 });
  await q.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await q.evaluate(() => (window.__pos = 5700)); // 95%: past the line, where the end is reported
  const mark = await q.evaluate(() => window.__calls.length);
  await q.locator(".vod-source").first().click();
  const started = await waitFor(q, async () => (await opens(q)).length > 0, 15_000);
  await q.waitForTimeout(12_000); // Trakt looks every 10s, the progress tick every 5s
  await leavePlayer(q);
  await goTo(q, "home");

  await q.locator('.stream-card[data-hint="Two Season Show"]').first().click({ timeout: 10_000 });
  await q.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  await q.locator(".episode-card").first().click();
  await q.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await q.locator(".vod-source").first().click();
  const episode = await waitFor(q, async () => (await opens(q)).some((o) => o.url.includes("/series/")), 15_000);
  await q.waitForTimeout(12_000);
  await leavePlayer(q);

  const sent = await q.evaluate(
    (from) =>
      window.__calls
        .slice(from)
        .filter(([c]) => c === "aiojf_request" || c === "trakt_request")
        .map(([c, a]) => `${c} ${a.method} ${a.path}`),
    mark,
  );
  const reports = sent.filter((x) => /Sessions\/Playing|UserPlayedItems|\/scrobble|\/sync\/history/.test(x));
  check("with AIOStreams and Trakt connected, a provider's film and episode are played and reported to neither", started && episode && reports.length === 0, JSON.stringify(reports));
  const asked = await q.evaluate((from) => window.__calls.slice(from).filter(([c]) => c === "trakt_status").length, mark);
  check("  (Trakt did look: it was asked if it was connected, and had nothing to send)", asked > 0);
  const aiojf = await storeOf(q, "aiojf");
  check("  and AIOStreams did not count them as plays it could not name", !(aiojf?.unpackable > 0), JSON.stringify(aiojf));
  const ledger = await storeOf(q, "watchedEpisodes");
  check("  the episode is ticked here, under the show's key", ledger?.["xt:vod1:s:t70001"]?.includes("xt:vod1:s:t70001:1:1"), JSON.stringify(ledger));
  await goTo(q, "home");
  await q.locator('.stream-card[data-hint="Two Season Show"]').first().click({ timeout: 10_000 });
  await q.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  check("  and the episode list shows the tick", (await q.locator(".episode-card__seen").count()) >= 1);
  await q.context().close();
}

// ============================================ My List
{
  const q = await openPage({ seeds: { xtVod: { vod1: { picks: [ACTION] } } } });
  await q.locator('.stream-card[data-hint="The Fantastic 4: First Steps"]').first().click({ timeout: 20_000 });
  await q.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await q.getByRole("button", { name: /Add to Library/ }).first().click();
  await q.waitForTimeout(400);
  const lists = await storeOf(q, "lists");
  const saved = lists?.[0]?.entries?.[0];
  check("a provider's film saved to My List keeps its key and that it is the provider's", saved?.id === "xt:vod1:m:t617126" && saved.from === "xt", JSON.stringify(saved));
  await q.locator(".vod-back").click();
  await goTo(q, "mylist");
  await q.getByText("My List", { exact: true }).first().click();
  await q.locator('.stream-card[data-hint="The Fantastic 4: First Steps"]').first().click({ timeout: 8000 });
  await q.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  check("  and opens from there to the provider's two sources, with no AIOStreams asked", (await q.locator(".vod-source").count()) === 2 && !q.requests.some((u) => u.includes(":8084")));
  await q.context().close();
}

// ============================================ a playlist with no movies or shows
{
  await clearLog();
  const q = await openPage({ playlists: [playlist("u")] });
  const asked = await waitFor(q, async () => listCalls(await panelLog(), "u").length > 0, 15_000);
  await q.waitForTimeout(1200);
  const text = await q.locator("main").innerText();
  check("(control) a playlist that is live TV only is asked for its library, finds none, and Stream says so as it did", asked && /No Movies or Shows Yet/.test(text) && (await coll(q).count()) === 0, text.slice(0, 80));
  check("  and its sub is true for them: another way in, an Xtream playlist that has movies and shows", /Sign in to AIOStreams or Jellyfin, or add an Xtream playlist with movies and shows, in Settings → Sources\./.test(text), text);
  await q.keyboard.press("Control+k");
  await q.locator(".palette").waitFor({ timeout: 4000 });
  const names = await q.evaluate(() => [...document.querySelectorAll(".palette .mvpick__row .mvpick__nametext")].map((r) => r.textContent));
  check("  and Ctrl+K has none of Stream's places", !["Stream", "Discover", "Library"].some((n) => names.includes(n)), JSON.stringify(names));
  await q.context().close();
}

// ============================================ a live-only panel that fails the list calls
{
  await clearLog();
  const q = await openPage({ playlists: [playlist("novod")] });
  const asked = await waitFor(q, async () => listCalls(await panelLog(), "novod").length > 0, 15_000);
  await q.waitForTimeout(1500);
  const text = await q.locator("main").innerText();
  check(
    "a live-only panel that answers the movie calls with an error leaves Stream as it was, not a failed catalog",
    asked && /No Movies or Shows Yet/.test(text) && !/Couldn.t Load/.test(text),
    text.slice(0, 80),
  );
  await q.context().close();
}

// ============================================ the switch
{
  await clearLog();
  const q = await openPage({ seeds: { xtVod: { vod1: { off: true, picks: [ACTION] } } } });
  await q.waitForTimeout(3000);
  const text = await q.locator("main").innerText();
  check(
    "a playlist whose library is switched off puts nothing in Stream and asks the panel for no list",
    /No Movies or Shows Yet/.test(text) && (await q.locator(".media-row").count()) === 0 && listCalls(await panelLog()).length === 0,
    text.slice(0, 80),
  );
  await q.context().close();
}

// ============================================ two libraries
const TWO = () => [playlist("vod", { id: "vod1", name: "Alpha" }), playlist("vod", { id: "vod2", name: "Beta", server: "http://127.0.0.1:8081" })];
{
  const q = await openPage({
    playlists: TWO(),
    seeds: { xtVod: { vod1: { picks: [ACTION] }, vod2: { picks: [ACTION] } } },
  });
  await q.locator(".media-row__title", { hasText: /^Action · Beta$/ }).waitFor({ timeout: 20_000 });
  const titles = await rowTitles(q);
  check("with two libraries the rows say whose they are", titles.includes("Action · Alpha") && titles.includes("Action · Beta"), JSON.stringify(titles));
  const keys = await q.locator(".stream-card").evaluateAll((els) => els.map((e) => e.dataset.hint));
  check("  and the same film from each is a card of its own", keys.filter((k) => k === "The Fantastic 4: First Steps").length === 2, JSON.stringify(keys));
  check("  one button after the rows, not one for each", (await rowsBtn(q).count()) === 1);
  await openDrawer(q);
  const names = await drawer(q).locator(".xtdrawer__libname").allInnerTexts();
  check("  the drawer groups Your Rows and the folders under each playlist's name", JSON.stringify(names) === JSON.stringify(["Alpha", "Beta", "Alpha", "Beta"]), JSON.stringify(names));
  check("  and says whose a folder is where its name alone would not", (await folderSwitch(q, "Action, Movies, Beta").getAttribute("aria-checked")) === "true" && (await folderSwitch(q, "Comedy, Movies, Alpha").getAttribute("aria-checked")) === "false");
  await drawer(q).getByRole("button", { name: "Remove Action, Movies, Beta", exact: true }).click();
  await done(q);
  check("  taking Beta's row out leaves Alpha's, still named for its playlist", JSON.stringify(await rowTitles(q)) === JSON.stringify(["Action · Alpha"]) && (await storedPicks(q, "vod2")).length === 0 && JSON.stringify(await storedPicks(q, "vod1")) === JSON.stringify(["movie:12"]), JSON.stringify(await rowTitles(q)));
  await q.context().close();

  // B, with nothing picked in either: the folders under each playlist's name.
  const b = await openPage({ playlists: TWO() });
  await coll(b).waitFor({ timeout: 20_000 });
  await b.locator("[data-xtcoll] .xtcoll__lib").nth(1).waitFor({ timeout: 10_000 });
  const heads = await coll(b).locator(".xtcoll__lib-title").allInnerTexts();
  check("B with two libraries groups the folders under each playlist's name", JSON.stringify(heads) === JSON.stringify(["Alpha", "Beta"]) && (await coll(b).locator('[role="group"][aria-label="Beta"] .xtcard').count()) === 3, JSON.stringify(heads));
  await coll(b).locator('[role="group"][aria-label="Beta"] .xtcard', { hasText: /^Action$/ }).click();
  check("  a click in one stages only that one", (await coll(b).locator('[role="group"][aria-label="Alpha"] .xtcard[aria-pressed="true"]').count()) === 0 && (await showBtn(b).innerText()) === "Show 1 Row");
  await showBtn(b).click();
  await b.locator(".media-row__title", { hasText: /^Action · Beta$/ }).waitFor({ timeout: 5000 });
  check("  and the button shows Beta's row and writes Beta's picks alone", JSON.stringify(await rowTitles(b)) === JSON.stringify(["Action · Beta"]) && JSON.stringify(await storedPicks(b, "vod2")) === JSON.stringify(["movie:12"]) && (await storedPicks(b, "vod1")).length === 0, JSON.stringify(await storeOf(b, "xtVod")));
  await b.context().close();
}

// ============================================ Settings → Sources
const openSources = async (p) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 15_000 });
  await p.locator(".settings__body").first().waitFor({ timeout: 10_000 });
  await p.getByRole("tab", { name: "Sources", exact: true }).click();
  await p.locator('.settings__body [data-setting="playlists"]').waitFor({ timeout: 10_000 });
};
const closeSettings = async (p) => {
  await p.keyboard.press("Escape");
  await p.locator(".settings__body").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
};
/** One playlist's block of Settings → Sources, by its name. */
const item = (p, name) => p.locator(".playlist-item", { has: p.locator(".playlist-row__name", { hasText: new RegExp(`^${name}$`) }) });
/** One playlist's panel in the Movies and Shows section, by its name: its own
 * section since Adam's v0.12.3 look, not part of the playlist's row. */
const lib = (p, name) => p.locator(".playlist-library", { has: p.locator(".playlist-library__name", { hasText: new RegExp(`^${name}$`) }) });
const LIBRARY = (name) => `${name} movies and shows in Stream and Discover`;
const sw = (p, name) => lib(p, name).getByRole("switch", { name: LIBRARY(name) });
/** The records the app keeps on disk for the playlists' lists (blammytv-vod). */
const diskKeys = (p) =>
  p.evaluate(
    () =>
      new Promise((resolve) => {
        const rq = indexedDB.open("blammytv-vod", 1);
        rq.onerror = () => resolve(null);
        rq.onsuccess = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains("lists")) {
            db.close();
            return resolve([]);
          }
          const k = db.transaction("lists").objectStore("lists").getAllKeys();
          k.onsuccess = () => {
            db.close();
            resolve(k.result.sort());
          };
          k.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
  );
const LIVE_ONLY = () => playlist("u", { id: "live1", name: "Live Only" });
const heldBoth = (p) => async () => {
  const h = await storeOf(p, "xtVodHeld");
  return !!h?.vod1 && !!h?.live1;
};

{
  await clearLog();
  const s = await openPage({ playlists: [playlist("vod", { name: "Vod Panel" }), LIVE_ONLY()] });
  await coll(s).waitFor({ timeout: 20_000 });
  const read = await waitFor(s, heldBoth(s), 20_000);
  await openSources(s);
  const vodItem = item(s, "Vod Panel");
  const liveItem = item(s, "Live Only");
  const vodLib = lib(s, "Vod Panel");
  const edit = vodLib.locator("[data-xtedit]");
  const yours = () => edit.locator(".xtpill:not(.xtpill--add) .xtpill__name").allInnerTexts();
  const more = () => edit.locator(".xtpill--add .xtpill__name").allInnerTexts();
  const addPill = (name, kind) => edit.getByRole("button", { name: `Add ${name}, ${kind}`, exact: true });
  const bar = () => edit.locator(".xtedit__bar");
  const save = () => edit.getByRole("button", { name: "Save", exact: true });
  const discard = () => edit.getByRole("button", { name: "Discard", exact: true });
  const pillGrip = (name) => edit.getByRole("button", { name: `Reorder ${name}`, exact: true });
  check("(control) both playlists have been read, so a missing switch is not a late one", read && (await liveItem.count()) === 1 && (await vodItem.count()) === 1, JSON.stringify(await storeOf(s, "xtVodHeld")));
  check(
    "a playlist whose provider has movies and shows has the switch, on, and its rows, in its own panel",
    (await vodLib.locator('[data-setting="playlist-library"]').count()) === 1 &&
      (await sw(s, "Vod Panel").getAttribute("aria-checked")) === "true" &&
      (await vodLib.locator('[data-setting="playlist-library-folders"] [data-xtedit]').count()) === 1,
  );
  check(
    "  and a playlist that is live TV only has neither",
    (await lib(s, "Live Only").count()) === 0 && (await s.locator('[data-setting="playlist-library"]').count()) === 1,
  );
  // Its own section, after the playlists and their guide's refresh, and not
  // part of the playlist's row (Adam: the two read as one block).
  const placed = await s.evaluate(() => {
    const section = document.querySelector("[data-xtsection]");
    const refresh = document.querySelector(".playlists-refresh");
    return {
      inRow: !!document.querySelector(".playlist-item .playlist-library"),
      section: !!section,
      after: !!section && !!refresh && !!(refresh.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING),
      head: section?.querySelector("h3")?.textContent ?? null,
    };
  });
  check("  in a Movies and Shows section of its own, after the guide's refresh, not in the playlist's row", placed.section && placed.after && !placed.inRow && placed.head === "Movies and Shows", JSON.stringify(placed));
  const text = await vodLib.innerText();
  check("  the label says where they go, and Your Rows and More Folders are under it, with nothing picked yet", /Show in Stream and Discover/.test(text) && /Your Rows/.test(text) && /No rows yet\. Pick a folder below\./.test(text) && /More Folders/.test(text), JSON.stringify(text.slice(0, 140)));
  const movies = await more();
  await kindTab(edit, "Shows").click();
  const shows = await more();
  await kindTab(edit, "Movies").click();
  check(
    "  More Folders is Stream's: movies and shows apart, and not the adult ones",
    movies.length === 3 && ["4K Movies", "Action", "Comedy"].every((n) => movies.includes(n)) && !movies.includes("Premium Vault") && !movies.includes("XXX Movies") && shows.length === 2,
    JSON.stringify({ movies, shows }),
  );
  check("  with no Save or Discard until something changes", (await bar().count()) === 0);

  // Staged: nothing reaches the store or Stream until Save.
  await addPill("Action", "Movies").click();
  await kindTab(edit, "Shows").click();
  await addPill("Drama", "Shows").click();
  check("a click on a folder in More Folders adds it to the end of Your Rows, and takes it out of More", JSON.stringify(await yours()) === JSON.stringify(["Action", "Drama"]) && !(await more()).includes("Drama"), JSON.stringify(await yours()));
  check("  Save and Discard appear, and the store has nothing: Save is what writes", (await bar().count()) === 1 && (await storedPicks(s)).length === 0, JSON.stringify(await storeOf(s, "xtVod")));
  await discard().click();
  check("Discard puts Your Rows back, and the bar goes", (await yours()).length === 0 && (await bar().count()) === 0 && (await storedPicks(s)).length === 0);
  await kindTab(edit, "Movies").click();
  check("  and the folders are back in More Folders", (await more()).includes("Action"));

  await addPill("Action", "Movies").click();
  await kindTab(edit, "Shows").click();
  await addPill("Drama", "Shows").click();
  await kindTab(edit, "Movies").click();
  await addPill("Comedy", "Movies").click();
  check("Your Rows after three clicks: Action, Drama, Comedy", JSON.stringify(await yours()) === JSON.stringify(["Action", "Drama", "Comedy"]), JSON.stringify(await yours()));
  check(
    "  each with a grip, and a line saying they drag, which More Folders has neither of",
    (await edit.locator(".xtpill:not(.xtpill--add) .xtpill__grip").count()) === 3 &&
      (await edit.locator(".xtpill--add .xtpill__grip").count()) === 0 &&
      (await edit.getByText("Drag to change the order.", { exact: true }).count()) === 1,
  );
  // Reorder by keyboard: Space lifts, ArrowRight moves, Space drops.
  await pillGrip("Action, Movies").focus();
  await s.keyboard.press("Space");
  await s.waitForTimeout(120);
  await s.keyboard.press("ArrowRight");
  await s.waitForTimeout(150);
  await s.keyboard.press("Space");
  await s.waitForTimeout(300);
  check("a pill lifted with Space and moved with ArrowRight lands one place on: Drama, Action, Comedy", JSON.stringify(await yours()) === JSON.stringify(["Drama", "Action", "Comedy"]), JSON.stringify(await yours()));
  check("  nothing is stored yet", (await storedPicks(s)).length === 0);
  // Escape on a lifted pill puts it back and Settings stays up.
  await pillGrip("Comedy, Movies").focus();
  await s.keyboard.press("Space");
  await s.waitForTimeout(120);
  await s.keyboard.press("ArrowLeft");
  await s.waitForTimeout(150);
  await s.keyboard.press("Escape");
  await s.waitForTimeout(400);
  check("Escape on a lifted pill puts it back, and Settings stays open", (await s.locator(".settings__body").count()) === 1 && JSON.stringify(await yours()) === JSON.stringify(["Drama", "Action", "Comedy"]), JSON.stringify(await yours()));
  await save().click();
  check("Save writes the picks, in that order", JSON.stringify(await storedPicks(s)) === JSON.stringify(["series:12", "movie:12", "movie:13"]) && (await bar().count()) === 0, JSON.stringify(await storeOf(s, "xtVod")));
  check("  and the picks are the library's own, not on the playlist", !("picks" in ((await storeOf(s, "playlists"))?.[0] ?? {})));
  await closeSettings(s);
  await s.locator(".media-row__title", { hasText: /^Comedy$/ }).waitFor({ timeout: 5000 });
  check("  Stream follows: the page is the rows, Drama, Action, Comedy", JSON.stringify(await rowTitles(s)) === JSON.stringify(["Drama", "Action", "Comedy"]) && (await coll(s).count()) === 0, JSON.stringify(await rowTitles(s)));
  const lists = listCalls(await panelLog());
  check("  (a pick costs no call at all: the lists were read once each)", LISTS.every((a) => lists.filter((c) => c.action === a).length === 1), JSON.stringify(lists.map((c) => c.action)));

  // The other way: a row added in the drawer is at the end of Your Rows.
  await openDrawer(s);
  await folderSwitch(s, "4K Movies, Movies").click();
  await done(s);
  await openSources(s);
  check("a row added in Stream's drawer is the last of Your Rows in Settings", JSON.stringify(await yours()) === JSON.stringify(["Drama", "Action", "Comedy", "4K Movies"]), JSON.stringify(await yours()));
  // Remove with the x, then Save.
  await edit.getByRole("button", { name: "Remove 4K Movies, Movies", exact: true }).click();
  check("the x on a pill takes it out of Your Rows, and puts it back in More Folders", JSON.stringify(await yours()) === JSON.stringify(["Drama", "Action", "Comedy"]) && (await more()).includes("4K Movies") && (await bar().count()) === 1);
  await save().click();
  check("  and Save writes it", JSON.stringify(await storedPicks(s)) === JSON.stringify(["series:12", "movie:12", "movie:13"]));
  await closeSettings(s);
  await s.locator(".media-row__title", { hasText: /^4K Movies$/ }).waitFor({ state: "detached", timeout: 5000 });

  // Closing Settings drops what was not saved.
  await openSources(s);
  await kindTab(edit, "Movies").click();
  await addPill("4K Movies", "Movies").click();
  await closeSettings(s);
  await openSources(s);
  check("what was not saved goes when Settings closes", (await yours()).length === 3 && (await bar().count()) === 0 && (await storedPicks(s)).length === 3);
  await closeSettings(s);

  // The switch.
  await clearLog();
  await openSources(s);
  await sw(s, "Vod Panel").click();
  check("the switch off: it stays, off, and its rows go", (await sw(s, "Vod Panel").getAttribute("aria-checked")) === "false" && (await vodLib.locator("[data-xtedit]").count()) === 0 && (await vodLib.locator('[data-setting="playlist-library"]').count()) === 1);
  const off = await storeOf(s, "xtVod");
  check("  kept in the library's store, with the picks still in it", off?.vod1?.off === true && pickIds(off.vod1.picks).length === 3, JSON.stringify(off));
  await closeSettings(s);
  await waitFor(s, async () => /No Movies or Shows Yet/.test(await s.locator("main").innerText()), 8000);
  check("  and Stream is as it was with no library: no row, no folders, no button", (await s.locator(".media-row").count()) === 0 && (await coll(s).count()) === 0 && (await rowsBtn(s).count()) === 0 && /No Movies or Shows Yet/.test(await s.locator("main").innerText()));
  await goTo(s, "discover");
  const nothing = await waitFor(s, async () => /Nothing to Discover Yet/.test(await s.locator(".discover").innerText().catch(() => "")), 8000);
  check("  and so is Discover", nothing);
  await goTo(s, "home");
  await openSources(s);
  await sw(s, "Vod Panel").click();
  check("the switch back on: on, and Your Rows are back as they were", (await sw(s, "Vod Panel").getAttribute("aria-checked")) === "true" && JSON.stringify(await yours()) === JSON.stringify(["Drama", "Action", "Comedy"]), JSON.stringify(await yours()));
  await closeSettings(s);
  await s.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 8000 });
  check("  Stream has its rows again, in order", JSON.stringify(await rowTitles(s)) === JSON.stringify(["Drama", "Action", "Comedy"]), JSON.stringify(await rowTitles(s)));
  check("  and off and on again cost no download: the lists were still there", listCalls(await panelLog()).length === 0, JSON.stringify(listCalls(await panelLog()).map((c) => c.action)));
  await s.context().close();
}

// ============================================ removing a playlist
{
  const r = await openPage({ playlists: [playlist("vod", { name: "Vod Panel" }), LIVE_ONLY()], seeds: { xtVod: { vod1: { off: false, picks: { movie: ["12"] } } } } });
  await r.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
  const read = await waitFor(r, heldBoth(r), 20_000);
  const on = await waitFor(r, async () => ((await diskKeys(r)) ?? []).join() === "live1,vod1", 10_000);
  check("(control) both playlists' lists are on disk, with the choices and the record of what each held", read && on && !!(await storeOf(r, "xtVod"))?.vod1, JSON.stringify(await diskKeys(r)));
  await openSources(r);
  await item(r, "Vod Panel").getByRole("button", { name: "Delete Vod Panel" }).click();
  await item(r, "Vod Panel").getByRole("button", { name: "Click again to remove Vod Panel" }).click();
  await r.waitForTimeout(500);
  const gone = await waitFor(r, async () => ((await diskKeys(r)) ?? ["?"]).join() === "live1", 8000);
  const choices = await storeOf(r, "xtVod");
  const held = await storeOf(r, "xtVodHeld");
  check("removing a playlist drops its lists from disk, and leaves the other playlist's", gone, JSON.stringify(await diskKeys(r)));
  check("  and its choices and its record of what it held, and not the other's", !choices || !("vod1" in choices), JSON.stringify(choices));
  check("  the other's record of what it held is still there", !!held?.live1 && !held.vod1, JSON.stringify(held));
  await r.context().close();
}

// ============================================ what no playlist owns, at launch
{
  /** The record under `id` as it is on disk, or null (the database or the record is not there). */
  const diskRecord = (p, id) =>
    p.evaluate(
      (k) =>
        new Promise((resolve) => {
          const rq = indexedDB.open("blammytv-vod", 1);
          rq.onerror = () => resolve(null);
          rq.onsuccess = () => {
            const db = rq.result;
            const g = db.transaction("lists").objectStore("lists").get(k);
            g.onsuccess = () => {
              db.close();
              resolve(g.result ?? null);
            };
            g.onerror = () => {
              db.close();
              resolve(null);
            };
          };
        }),
      id,
    );
  /** What a settings import leaves: a record under an id no saved playlist has,
   * in the shape 1.0.0 wrote (the account itself in `fp`). */
  const plant = (p, id) =>
    p.evaluate(
      (k) =>
        new Promise((resolve) => {
          const rq = indexedDB.open("blammytv-vod", 1);
          rq.onerror = () => resolve(false);
          rq.onsuccess = () => {
            const db = rq.result;
            const tx = db.transaction("lists", "readwrite");
            const empty = { movies: [], shows: [], movieFolders: [], showFolders: [] };
            tx.objectStore("lists").put({ fp: JSON.stringify(["http://old.invalid", "olduser", "oldpass"]), at: 1, lists: empty }, k);
            tx.oncomplete = () => {
              db.close();
              resolve(true);
            };
            tx.onerror = () => resolve(false);
          };
        }),
      id,
    );
  const g = await openPage({ playlists: [playlist("vod", { name: "Vod Panel" }), LIVE_ONLY()], seeds: { xtVod: { vod1: { off: false, picks: { movie: ["12"] } } } } });
  await g.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
  const both = await waitFor(g, async () => ((await diskKeys(g)) ?? []).join() === "live1,vod1", 10_000);
  const planted = await plant(g, "ghost");
  check("(control) both playlists' lists are on disk, and a record no playlist owns is planted beside them", both && planted && ((await diskKeys(g)) ?? []).join() === "ghost,live1,vod1", JSON.stringify(await diskKeys(g)));
  await g.reload({ waitUntil: "domcontentloaded" });
  const cleared = await waitFor(g, async () => ((await diskKeys(g)) ?? []).join() === "live1,vod1", 10_000);
  check("a reload clears the record no playlist owns, and leaves the saved playlists' records", cleared, JSON.stringify(await diskKeys(g)));
  const rec = await diskRecord(g, "vod1");
  check("  and what the saved ones keep of the account is a hash, not the account", typeof rec?.fp === "string" && /^[0-9a-f]{64}$/.test(rec.fp), JSON.stringify(rec?.fp ?? null));
  await g.context().close();
}

// ============================================ a lapsed account's answer
// A panel whose account lapsed answers EVERY call with {"user_info":{"auth":0}}
// and a 200. That is not a list, so it is a failed read: the copy on disk and
// the rows stay, whatever its age. It used to read as a library of nothing,
// replace the copy (on disk too, stamped now) and empty Stream for 12 hours.
{
  /** The record on disk for the playlist: when it was read and what it holds. */
  const record = (p) =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const rq = indexedDB.open("blammytv-vod", 1);
          rq.onerror = () => resolve(null);
          rq.onsuccess = () => {
            const db = rq.result;
            if (!db.objectStoreNames.contains("lists")) return resolve(null), db.close();
            const g = db.transaction("lists").objectStore("lists").get("vod1");
            g.onsuccess = () => {
              db.close();
              resolve(g.result ? { at: g.result.at, movies: g.result.lists.movies.length, shows: g.result.lists.shows.length } : null);
            };
            g.onerror = () => (db.close(), resolve(null));
          };
        }),
    );
  /** Make the record 13 hours old, past the 12 the lists are used as they are. */
  const age = (p) =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const rq = indexedDB.open("blammytv-vod", 1);
          rq.onerror = () => resolve(false);
          rq.onsuccess = () => {
            const db = rq.result;
            const tx = db.transaction("lists", "readwrite");
            const g = tx.objectStore("lists").get("vod1");
            g.onsuccess = () => tx.objectStore("lists").put({ ...g.result, at: Date.now() - 13 * 3600_000 }, "vod1");
            tx.oncomplete = () => (db.close(), resolve(true));
            tx.onerror = () => resolve(false);
          };
        }),
    );
  await fetch(`${PANEL}/__lapse?on=0`);
  const q = await openPage({ playlists: [playlist("vodlapse")], seeds: { xtVod: { vod1: { picks: [ACTION] } } } });
  try {
    await q.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
    const wrote = await waitFor(q, async () => (await record(q))?.movies > 0, 10_000);
    const before = await record(q);
    const aged = await age(q);
    check("(control) the account's lists are on disk, and the copy is made 13 hours old", wrote && aged && before.movies > 0 && before.shows > 0, JSON.stringify(before));
    const old = await record(q);

    // The account lapses. A relaunch shows the old copy at once and reads again behind it.
    await fetch(`${PANEL}/__lapse?on=1`);
    await clearLog();
    await q.reload({ waitUntil: "domcontentloaded" });
    await q.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
    const asked = await waitFor(q, async () => listCalls(await panelLog(), "vodlapse").length > 0, 15_000);
    check("(control) the launch read the lists again, and the panel answered them with the sign-in object", asked && listCalls(await panelLog(), "vodlapse").length >= 4, JSON.stringify(listCalls(await panelLog(), "vodlapse").map((c) => c.action)));
    await q.waitForTimeout(2000); // what the failed read would have done to the page
    check("the rows are still there", (await rowTitles(q)).includes("Action") && (await rowCards(q, "Action")).length > 0, JSON.stringify(await rowTitles(q)));
    const kept = await record(q);
    check("  and so is the copy on disk, as it was: not replaced with nothing, not stamped now", kept?.movies === old.movies && kept?.shows === old.shows && kept?.at === old.at, JSON.stringify({ old, kept }));
    const held = await storeOf(q, "xtVodHeld");
    check("  and the record of what the playlist held did not drop to nothing", held?.vod1?.movies > 0, JSON.stringify(held));

    // The account is back: the next launch reads it, and the copy is the new read.
    await fetch(`${PANEL}/__lapse?on=0`);
    await q.reload({ waitUntil: "domcontentloaded" });
    const renewed = await waitFor(q, async () => (await record(q))?.at > old.at, 15_000);
    check("once the panel answers again, the next launch reads it and replaces the copy", renewed && (await rowTitles(q)).includes("Action"), JSON.stringify(await record(q)));
  } finally {
    await fetch(`${PANEL}/__lapse?on=0`);
    await q.context().close();
  }
}

// ============================================ Discover
{
  const GRID = ["Quiet Harbor", "Plain Series", "Skyline Run", "Show Without Backdrop", "Midnight Express Lane", "Two Season Show"];
  const MOVIES = ["Quiet Harbor", "Skyline Run", "Midnight Express Lane", "Second Wind", "Laugh Track", "Paper Moon Rising", "The Long Road Home", "Other Panel Spelling", "Kitchen Sink Story", "Home Movie Night", "The Fantastic 4: First Steps"];
  const SHOWS = ["Plain Series", "Show Without Backdrop", "Two Season Show"];
  await clearLog();
  // Discover is the tab it opens on, with nothing picked and nothing read yet.
  const d = await openPage({ seeds: { startupTab: "discover" } });
  const names = () => d.locator(".disc-grid .stream-card__name").allInnerTexts();
  const shown = await waitFor(d, async () => (await names()).length >= MOVIES.length + SHOWS.length, 20_000);
  const all = await names();
  check("Discover with only a provider's library: its titles are the grid, movies and shows alternating, newest first", shown && JSON.stringify(all.slice(0, GRID.length)) === JSON.stringify(GRID), JSON.stringify(all));
  check("  every title once, and not the ones the adult filter keeps out", all.length === MOVIES.length + SHOWS.length && new Set(all).size === all.length && !all.some((n) => /Flagged|Vault|Name Caught/.test(n)), JSON.stringify(all));
  check("  with no genre rail, since the lists carry no genres", (await d.locator(".genre-card").count()) === 0 && (await d.getByText("By Genre").count()) === 0);
  check("  and no sign-in card, and nothing asked of AIOStreams", (await d.getByText("Nothing to Discover Yet").count()) === 0 && !d.requests.some((u) => u.includes(":8084")));
  const calls = listCalls(await panelLog());
  check("  paged from the lists already read: the four list calls, once each, and no search or other call", LISTS.every((a) => calls.filter((c) => c.action === a).length === 1) && (await panelLog()).filter((c) => c.user === "vod" && !LISTS.includes(c.action) && c.path === "/player_api.php").length === 0, JSON.stringify((await panelLog()).map((c) => c.action)));

  // The type chips filter it.
  await d.getByRole("button", { name: "Movies", exact: true }).click();
  await waitFor(d, async () => JSON.stringify(await names()) === JSON.stringify(MOVIES), 8000);
  check("the Movies chip leaves the movies, newest first", JSON.stringify(await names()) === JSON.stringify(MOVIES), JSON.stringify(await names()));
  await d.getByRole("button", { name: "Series", exact: true }).click();
  await waitFor(d, async () => JSON.stringify(await names()) === JSON.stringify(SHOWS), 8000);
  check("  and the Series chip the shows", JSON.stringify(await names()) === JSON.stringify(SHOWS), JSON.stringify(await names()));
  await d.getByRole("button", { name: "Any", exact: true }).click();
  await waitFor(d, async () => (await names()).length === MOVIES.length + SHOWS.length, 8000);

  // Search.
  const search = d.locator(".navcap__searchinput");
  await search.fill("QUIET harbor");
  await waitFor(d, async () => (await d.locator(".disc-grid .stream-card", { hasText: "Quiet Harbor" }).count()) > 0, 10_000);
  const found = await names();
  check("a search finds a film in a folder no one picked, whatever the case, and nothing else", JSON.stringify(found) === JSON.stringify(["Quiet Harbor"]), JSON.stringify(found));
  check("  heading and all: Results for the words typed", /Results for “QUIET harbor”/.test(await d.locator(".discover").innerText()));
  await search.fill("two season");
  await waitFor(d, async () => (await d.locator(".disc-grid .stream-card", { hasText: "Two Season Show" }).count()) > 0, 10_000);
  check("  and a show, once, though the panel holds two copies of it", JSON.stringify(await names()) === JSON.stringify(["Two Season Show"]), JSON.stringify(await names()));
  await search.fill("zzzzq");
  await waitFor(d, async () => /No Results for/.test(await d.locator(".discover").innerText()), 10_000);
  check("  and a word no title has is No Results, not a failure", !/didn’t go through/.test(await d.locator(".discover").innerText()));
  check("  none of it asked the panel anything: no search or other call", (await panelLog()).filter((c) => c.user === "vod" && !LISTS.includes(c.action) && c.path === "/player_api.php").length === 0);

  // A result opens, and plays the provider's file.
  await search.fill("quiet harbor");
  await d.locator(".disc-grid .stream-card", { hasText: "Quiet Harbor" }).first().click({ timeout: 10_000 });
  await d.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const sources = await d.locator(".vod-source").allInnerTexts();
  check("a search result opens the provider's page, with its one file", sources.length === 1, JSON.stringify(sources));
  await d.locator(".vod-source").first().click();
  const started = await waitFor(d, async () => (await opens(d)).length > 0, 15_000);
  const first = (await opens(d))[0];
  check("  and playing it hands mpv the provider's address and the playlist's User-Agent", started && first.url === `${PANEL}/movie/vod/p/3016.mkv` && first.userAgent === UA, JSON.stringify(first));
  check("  with nothing asked of AIOStreams", !d.requests.some((u) => u.includes(":8084")));
  await d.context().close();
}

// ---- two libraries, one switched off
{
  const q = await openPage({
    playlists: [playlist("vod", { id: "vod1", name: "Alpha" }), playlist("vod", { id: "vod2", name: "Beta", server: "http://127.0.0.1:8081" })],
    seeds: { startupTab: "discover" },
  });
  const search = q.locator(".navcap__searchinput");
  const names = () => q.locator(".disc-grid .stream-card__name").allInnerTexts();
  await waitFor(q, async () => (await names()).length > 0, 20_000);
  await search.fill("quiet harbor");
  await waitFor(q, async () => (await names()).length === 2, 10_000);
  check("with two libraries a search finds the film in each, as two cards", JSON.stringify(await names()) === JSON.stringify(["Quiet Harbor", "Quiet Harbor"]), JSON.stringify(await names()));
  await openSources(q);
  await sw(q, "Beta").click();
  await closeSettings(q);
  await waitFor(q, async () => (await names()).length === 1, 10_000);
  check("  and with one switched off, only the other's", JSON.stringify(await names()) === JSON.stringify(["Quiet Harbor"]), JSON.stringify(await names()));
  await q.locator(".disc-grid .stream-card", { hasText: "Quiet Harbor" }).first().click({ timeout: 10_000 });
  await q.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await q.locator(".vod-source").first().click();
  const started = await waitFor(q, async () => (await opens(q)).length > 0, 15_000);
  check("  which is Alpha's: the address is its server's", started && (await opens(q))[0].url === `${PANEL}/movie/vod/p/3016.mkv`, JSON.stringify(await opens(q)));
  await q.context().close();
}

// ---- a live-only playlist on Discover
{
  const q = await openPage({ playlists: [playlist("u")], seeds: { startupTab: "discover" } });
  const shown = await waitFor(q, async () => /Nothing to Discover Yet/.test(await q.locator(".discover").innerText().catch(() => "")), 15_000);
  const text = await q.locator(".discover").innerText();
  check(
    "(control) a playlist that is live TV only is no source: Discover says Nothing to Discover Yet, with the way to get one",
    shown && /Sign in to AIOStreams or Jellyfin, or add an Xtream playlist with movies and shows, in Settings → Sources\./.test(text) && !/Couldn.t Load/.test(text),
    text,
  );
  await q.context().close();
}

// ============================================ the light theme
// B and D are drawn in the theme's own surfaces and ink, never a raw dark ground:
// every surface they paint is light, and their words clear 4.5:1 on it. The same
// pages in dark are dark, so the reading is of something.
/** The colour a surface paints and the ink on it, as numbers: a canvas resolves
 * any CSS colour (oklch, color-mix) to sRGB, and each translucent layer, from the
 * page down to the element, is laid over the one below it. */
const paintOf = (p, selectors) =>
  p.evaluate((sels) => {
    const cx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    cx.canvas.width = cx.canvas.height = 1;
    const rgba = (c) => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
    /** What is behind an element's text: every background from the root down. */
    const groundOf = (el) => {
      const chain = [];
      for (let e = el; e; e = e.parentElement) chain.push(rgba(getComputedStyle(e).backgroundColor));
      return chain.reduceRight((under, layer) => (layer[3] > 0 ? over(layer, under) : under), [255, 255, 255]);
    };
    const out = {};
    for (const sel of sels) {
      const els = [...document.querySelectorAll(sel)];
      let surface = Infinity;
      let ratio = Infinity;
      for (const el of els) {
        const ground = groundOf(el);
        const ink = over(rgba(getComputedStyle(el).color), ground);
        const [hi, lo] = [lum(ground), lum(ink)].sort((x, y) => y - x);
        surface = Math.min(surface, lum(ground));
        ratio = Math.min(ratio, (hi + 0.05) / (lo + 0.05));
      }
      out[sel] = { n: els.length, surface: Math.round(surface * 100) / 100, ratio: Math.round(ratio * 10) / 10 };
    }
    return out;
  }, selectors);
{
  // The words in the text colour clear 4.5:1. The quieter words are the app's
  // muted tier, which on the light page is 4.4:1 wherever the app uses it, so
  // they are held to 4.0: a fainter tier (--text-dim, --text-ghost) would not be.
  const INK = { B: [".xtcoll__title", ".xtcard__name"], D: [".xtdrawer__title", ".xtrow__name", ".xtfolder__name"] };
  const MUTED = { B: [".xtcoll__note"], D: [".xtdrawer__sec", ".xtrow__kind", ".xtdrawer__count"] };
  const SURFACES = { B: [".xtcard"], D: [".xtdrawer", ".xtrow", ".xtfolder"] };
  const light = async (p, v) => {
    const r = await paintOf(p, [...INK[v], ...MUTED[v], ...SURFACES[v]]);
    const ok =
      INK[v].every((k) => r[k].n > 0 && r[k].surface > 0.6 && r[k].ratio >= 4.5) &&
      MUTED[v].every((k) => r[k].n > 0 && r[k].surface > 0.6 && r[k].ratio >= 4.0) &&
      SURFACES[v].every((k) => r[k].n > 0 && r[k].surface > 0.6);
    return { r, ok };
  };

  const dark = await openPage();
  await coll(dark).waitFor({ timeout: 20_000 });
  const darkB = await paintOf(dark, [".xtcard"]);
  check("(control) in the dark theme the folder cards are dark, so the light check below is reading something", darkB[".xtcard"].n > 0 && darkB[".xtcard"].surface < 0.1, JSON.stringify(darkB));
  await dark.context().close();

  const l = await openPage({ seeds: { theme: "light" } });
  await coll(l).waitFor({ timeout: 20_000 });
  await card(l, "Action").click();
  check("in the light theme the page is light", (await l.evaluate(() => document.documentElement.dataset.theme)) === "light");
  const b = await light(l, "B");
  check("  B: the heading, the sentence and the cards are on light surfaces, in ink that is readable on them", b.ok, JSON.stringify(b.r));
  const ring = await card(l, "Action").evaluate((e) => getComputedStyle(e).borderTopColor);
  const rest = await card(l, "Comedy").evaluate((e) => getComputedStyle(e).borderTopColor);
  check("  and a staged card is told from one that is not by its ring, in the accent", ring !== rest);
  await l.context().close();

  const d = await openPage({ seeds: { theme: "light", xtVod: { vod1: { picks: [ACTION, DRAMA, COMEDY] } } } });
  await d.locator(".media-row__title", { hasText: /^Comedy$/ }).waitFor({ timeout: 20_000 });
  await openDrawer(d);
  const r = await light(d, "D");
  check("  D: the drawer, its rows and its folders are on light surfaces, in ink that is readable on them", r.ok, JSON.stringify(r.r));
  await d.context().close();
}

// ============================================ reduced motion
// The drag, the hover and the slide are the movement, and reduced motion takes
// them out: the rows that make room jump to their places, a card's fan stays shut
// under the pointer, and the drawer fades in without sliding. (The same pages
// without it do each, above.)
{
  const q = await openPage({ reducedMotion: "reduce", seeds: { xtVod: { vod1: { picks: [ACTION, DRAMA, COMEDY] } } } });
  await q.locator(".media-row__title", { hasText: /^Comedy$/ }).waitFor({ timeout: 20_000 });
  await openDrawer(q);
  await grip(q, "Action, Movies").focus();
  await q.keyboard.press("Space");
  await q.waitForTimeout(120);
  await q.keyboard.press("ArrowDown");
  await q.waitForTimeout(150);
  const moving = await drawer(q).locator("[data-xtdrawer-rows] .xtrow").nth(1).evaluate((e) => getComputedStyle(e).transitionDuration);
  await q.keyboard.press("Space");
  await q.waitForTimeout(300);
  check("with reduced motion the rows that make room jump to their places", moving === "0s" && JSON.stringify(await mine(q)) === JSON.stringify(["Drama", "Action", "Comedy"]), `${moving} ${JSON.stringify(await mine(q))}`);
  const slide = await drawer(q).evaluate((e) => getComputedStyle(e).getPropertyValue("--xt-slide").trim());
  check("  and the drawer does not slide in, it fades", slide === "0px", slide);
  await q.context().close();

  const c = await openPage({ reducedMotion: "reduce" });
  await coll(c).waitFor({ timeout: 20_000 });
  const left = card(c, "4K Movies").locator(".xtfan__l");
  const shut = await left.evaluate((e) => getComputedStyle(e).transform);
  await card(c, "4K Movies").hover();
  await c.waitForTimeout(500);
  const open = await left.evaluate((e) => getComputedStyle(e).transform);
  const lift = await card(c, "4K Movies").evaluate((e) => getComputedStyle(e).transform);
  check("  and a card's fan stays shut and the card stays down under the pointer", shut === open && lift === "none", `${shut} -> ${open}, card ${lift}`);
  await c.context().close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
