// E2E: a provider's movies and shows in Stream (plan 028, batches 2 and 3),
// against scripts/fake-panel.mjs on :8081 and its user "vod" (Adam's panel's
// real shapes: folders, a film held twice as a 4K copy and a plain one, a show
// in two seasons with a 4K copy of its first, an adult folder flagged by the
// panel, one caught by its name, and a title flagged in an ordinary folder).
// The Tauri commands are stubbed as verify-jellyfin stubs them: mpv_status
// answers, http_get forwards to the fake, and every inv_open is kept, so what
// the app hands the player (the address, and the User-Agent with it) is read
// as it was sent. Offline, as every harness is: every host but localhost is
// aborted.
//
// - Xtream-only, first visit to Stream: the page IS the folder picker. Movies
//   offers 4K Movies, Action and Comedy, and not the two adult folders; Shows
//   offers Drama and Sitcoms. (The control, with adult content shown, offers
//   them and the flagged film, so the refusals above are the filter's.)
// - Picking Action adds its row on the spot: the film once, and not the title
//   the panel flags; the picker stays while picking; Drama too; Done closes it
//   and a button brings it back.
// - A reload keeps the picks and the rows, from disk, with no list call made
//   again inside the TTL.
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
//   switch and the folder picker under its row, a live-only playlist has
//   neither; picking there adds the row in Stream; the switch off empties
//   Stream (and costs no download to turn back on); removing the playlist drops
//   its choices, its record of what it held and its lists on disk.
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
async function openPage({ playlists = [playlist()], seeds = {}, connected = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
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
const chips = (p, group) => p.locator(`.xtpick__group[aria-label="${group}"] button`).allInnerTexts();
const chip = (p, group, name) => p.locator(`.xtpick__group[aria-label="${group}"] button`, { hasText: new RegExp(`^${name}$`) });
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
await p.locator("[data-xtpick]").first().waitFor({ timeout: 20_000 });

// ---- 1. the first visit: the picker is the page
{
  const movies = await chips(p, "Movies");
  const shows = await chips(p, "Shows");
  check("the first visit to Stream is the folder picker, and no row yet", (await rowTitles(p)).filter((t) => t !== "Choose Folders").length === 0 && (await p.locator(".media-row").count()) === 0, JSON.stringify(await rowTitles(p)));
  check(
    "  Movies offers 4K Movies, Action and Comedy, and not the adult folders",
    ["4K Movies", "Action", "Comedy"].every((n) => movies.includes(n)) && !movies.includes("Premium Vault") && !movies.includes("XXX Movies"),
    JSON.stringify(movies),
  );
  check("  Shows offers Drama and Sitcoms", shows.length === 2 && shows.includes("Drama") && shows.includes("Sitcoms"), JSON.stringify(shows));
  const text = await p.locator("[data-xtpick]").innerText();
  check("  with one playlist the heading does not name it, and it says what picking does", /Choose Folders\n/.test(text) && !/Vod Panel/.test(text) && /Each folder you pick becomes a row on Stream\./.test(text), JSON.stringify(text.slice(0, 90)));
  const off = await p.locator('.xtpick__group[aria-label="Movies"] button[aria-pressed="true"]').count();
  check("  and every folder starts off", off === 0 && (await p.locator("[data-xtpick] button[aria-pressed='true']").count()) === 0);
  check("  no AIOStreams was asked", !p.requests.some((u) => u.includes(":8084")));
}

// ---- 2. pick a folder: its row, on the spot
{
  await chip(p, "Movies", "Action").click();
  await p.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 5000 });
  const cards = await rowCards(p, "Action");
  const f4 = cards.filter((n) => n === "The Fantastic 4: First Steps").length;
  check("picking Action adds its row with the film once, whichever copy the panel files it under", f4 === 1, JSON.stringify(cards));
  check("  and the row is whole: the other Action titles are there, the one the panel flags is not", cards.includes("Kitchen Sink Story") && cards.length >= 4 && !cards.includes("Flagged In Plain Sight"), JSON.stringify(cards));
  check("  the picker is still there, the chip pressed", (await p.locator("[data-xtpick]").count()) === 1 && (await chip(p, "Movies", "Action").getAttribute("aria-pressed")) === "true");

  await chip(p, "Shows", "Drama").click();
  await p.locator(".media-row__title", { hasText: /^Drama$/ }).waitFor({ timeout: 5000 });
  const titles = await rowTitles(p);
  check("picking Drama adds the show row after the film row, and the picker is still up", titles.indexOf("Drama") > titles.indexOf("Action") && (await p.locator("[data-xtpick]").count()) === 1, JSON.stringify(titles));
  const drama = await rowCards(p, "Drama");
  check("  with the show once (its 4K copy sits in the other folder)", drama.filter((n) => n === "Two Season Show").length === 1 && drama.includes("Plain Series"), JSON.stringify(drama));
  const hero = await p.locator(".shero__card").count();
  check("  and a hero of the picked shows", hero > 0, `${hero} slides`);

  await chip(p, "Movies", "Action").click();
  await p.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ state: "detached", timeout: 5000 });
  check("unpicking Action takes its row away again", !(await rowTitles(p)).includes("Action"));
  await chip(p, "Movies", "Action").click();
  await p.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 5000 });

  await p.getByRole("button", { name: "Done", exact: true }).click();
  await p.locator("[data-xtpick]").waitFor({ state: "detached", timeout: 5000 });
  const rows = await rowTitles(p);
  check("Done closes the picker, and the rows stay", rows.includes("Action") && rows.includes("Drama"), JSON.stringify(rows));
  await p.getByRole("button", { name: "Choose Folders", exact: true }).click();
  await p.locator("[data-xtpick]").waitFor({ timeout: 5000 });
  check("  the button after the rows brings it back, with the picks showing", (await chip(p, "Movies", "Action").getAttribute("aria-pressed")) === "true" && (await chip(p, "Shows", "Drama").getAttribute("aria-pressed")) === "true");
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await p.locator("[data-xtpick]").waitFor({ state: "detached", timeout: 5000 });

  const log = await panelLog();
  check("every pick cost no call at all: the lists were read once each", LISTS.every((a) => listCalls(log).filter((c) => c.action === a).length === 1), JSON.stringify(listCalls(log).map((c) => c.action)));
  const picks = await storeOf(p, "xtVod");
  check("  and the picks are the app's own, not on the playlist", picks?.vod1?.picks?.movie?.includes("12") && picks.vod1.picks.series?.includes("12") && !("picks" in ((await storeOf(p, "playlists"))?.[0] ?? {})), JSON.stringify(picks));
}

// ---- 3. a reload: the picks and rows from storage, the lists from disk
{
  await clearLog();
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
  await p.locator(".media-row__title", { hasText: /^Drama$/ }).waitFor({ timeout: 5000 });
  const cards = await rowCards(p, "Action");
  check("a reload keeps the picks and the rows", cards.includes("The Fantastic 4: First Steps") && (await p.locator("[data-xtpick]").count()) === 0, JSON.stringify(cards));
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
    seeds: { showAdult: true, xtVod: { vod1: { picks: { movie: ["12"] } } } },
  });
  await q.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 20_000 });
  const cards = await rowCards(q, "Action");
  check("(control) with adult content shown, the film the panel flags is in the Action row", cards.includes("Flagged In Plain Sight") && cards.includes("The Fantastic 4: First Steps"), JSON.stringify(cards));
  await q.getByRole("button", { name: "Choose Folders", exact: true }).click();
  await q.locator("[data-xtpick]").waitFor({ timeout: 5000 });
  const movies = await chips(q, "Movies");
  check("  and the picker offers the two adult folders", movies.includes("Premium Vault") && movies.includes("XXX Movies"), JSON.stringify(movies));
  await q.context().close();
}

// ============================================ AIOStreams and Trakt signed in too
// A play is reported to the addon's sync and scrobbled to Trakt, when they are
// connected, and a provider's play is neither's: it has no id either knows. The
// addon's report would have counted it as a play it could not name (Settings
// shows that count), and so it is not made for one at all. The tick the episode
// list shows is the app's own, kept here.
{
  const q = await openPage({ connected: true, seeds: { xtVod: { vod1: { picks: { movie: ["12"], series: ["12"] } } } } });
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
  const q = await openPage({ seeds: { xtVod: { vod1: { picks: { movie: ["12"] } } } } });
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
  check("(control) a playlist that is live TV only is asked for its library, finds none, and Stream says so as it did", asked && /No Movies or Shows Yet/.test(text) && (await q.locator("[data-xtpick]").count()) === 0, text.slice(0, 80));
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
  const q = await openPage({ seeds: { xtVod: { vod1: { off: true, picks: { movie: ["12"] } } } } });
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
{
  const q = await openPage({
    playlists: [playlist("vod", { id: "vod1", name: "Alpha" }), playlist("vod", { id: "vod2", name: "Beta", server: "http://127.0.0.1:8081" })],
    seeds: { xtVod: { vod1: { picks: { movie: ["12"] } }, vod2: { picks: { movie: ["12"] } } } },
  });
  await q.locator(".media-row__title", { hasText: /^Action · Beta$/ }).waitFor({ timeout: 20_000 });
  const titles = await rowTitles(q);
  check("with two libraries the rows say whose they are", titles.includes("Action · Alpha") && titles.includes("Action · Beta"), JSON.stringify(titles));
  const keys = await q.locator(".stream-card").evaluateAll((els) => els.map((e) => e.dataset.hint));
  check("  and the same film from each is a card of its own", keys.filter((k) => k === "The Fantastic 4: First Steps").length === 2, JSON.stringify(keys));
  await q.getByRole("button", { name: "Choose Folders from Alpha", exact: true }).click();
  await q.locator("[data-xtpick]").waitFor({ timeout: 5000 });
  const heading = await q.locator("[data-xtpick] .media-row__title").first().innerText();
  check("  the picker names the playlist it is for", heading === "Choose Folders from Alpha", heading);
  await q.context().close();
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
const LIBRARY = (name) => `${name} movies and shows in Stream and Discover`;
const sw = (p, name) => item(p, name).getByRole("switch", { name: LIBRARY(name) });
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
  await s.locator("[data-xtpick]").first().waitFor({ timeout: 20_000 });
  const read = await waitFor(s, heldBoth(s), 20_000);
  await openSources(s);
  const vodItem = item(s, "Vod Panel");
  const liveItem = item(s, "Live Only");
  check("(control) both playlists have been read, so a missing switch is not a late one", read && (await liveItem.count()) === 1 && (await vodItem.count()) === 1, JSON.stringify(await storeOf(s, "xtVodHeld")));
  check(
    "a playlist whose provider has movies and shows has the switch, on, and the folder picker, under its row",
    (await vodItem.locator('[data-setting="playlist-library"]').count()) === 1 &&
      (await sw(s, "Vod Panel").getAttribute("aria-checked")) === "true" &&
      (await vodItem.locator('[data-setting="playlist-library-folders"] [data-xtpick]').count()) === 1,
  );
  check(
    "  and a playlist that is live TV only has neither",
    (await liveItem.locator('[data-setting="playlist-library"]').count()) === 0 && (await liveItem.locator("[data-xtpick]").count()) === 0 && (await s.locator('[data-setting="playlist-library"]').count()) === 1,
  );
  const text = await vodItem.locator(".playlist-library").innerText();
  check("  the label says where they go, and the picker says what picking does", /Movies and Shows in Stream and Discover/.test(text) && /Choose Folders\n/.test(text) && /Each folder you pick becomes a row on Stream\./.test(text), JSON.stringify(text.slice(0, 120)));
  const movies = await vodItem.locator('.xtpick__group[aria-label="Movies"] button').allInnerTexts();
  const shows = await vodItem.locator('.xtpick__group[aria-label="Shows"] button').allInnerTexts();
  check(
    "  the folders are Stream's: movies and shows apart, and not the adult ones",
    ["4K Movies", "Action", "Comedy"].every((n) => movies.includes(n)) && !movies.includes("Premium Vault") && !movies.includes("XXX Movies") && shows.length === 2,
    JSON.stringify({ movies, shows }),
  );
  check("  and every folder starts off", (await vodItem.locator("[data-xtpick] button[aria-pressed='true']").count()) === 0);

  // Picking in Settings adds the row in Stream.
  await vodItem.locator('.xtpick__group[aria-label="Movies"] button', { hasText: /^Action$/ }).click();
  await vodItem.locator('.xtpick__group[aria-label="Shows"] button', { hasText: /^Drama$/ }).click();
  const picks = await storeOf(s, "xtVod");
  check("picking Action and Drama in Settings keeps the picks in the library's store, as Stream's picker does", picks?.vod1?.picks?.movie?.includes("12") && picks.vod1.picks.series?.includes("12") && !("picks" in ((await storeOf(s, "playlists"))?.[0] ?? {})), JSON.stringify(picks));
  check("  and they stay pressed there, the picker still up", (await vodItem.locator('.xtpick__group[aria-label="Movies"] button[aria-pressed="true"]').count()) === 1 && (await vodItem.locator("[data-xtpick]").count()) === 1);
  await closeSettings(s);
  await s.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 5000 });
  await s.locator(".media-row__title", { hasText: /^Drama$/ }).waitFor({ timeout: 5000 });
  const titles = await rowTitles(s);
  const cards = await rowCards(s, "Action");
  check("  and Stream has both rows, the film once", titles.includes("Action") && titles.includes("Drama") && cards.filter((n) => n === "The Fantastic 4: First Steps").length === 1, JSON.stringify(titles));
  const lists = listCalls(await panelLog());
  check("  (a pick costs no call at all: the lists were read once each)", LISTS.every((a) => lists.filter((c) => c.action === a).length === 1), JSON.stringify(lists.map((c) => c.action)));

  // The other way: a pick in Stream shows in Settings.
  await s.getByRole("button", { name: "Choose Folders", exact: true }).click();
  await chip(s, "Movies", "Comedy").click();
  await s.locator(".media-row__title", { hasText: /^Comedy$/ }).waitFor({ timeout: 5000 });
  await openSources(s);
  check("a pick made in Stream is pressed in Settings", (await vodItem.locator('.xtpick__group[aria-label="Movies"] button[aria-pressed="true"]').allInnerTexts()).sort().join() === "Action,Comedy");
  await closeSettings(s);

  // The switch.
  await clearLog();
  await openSources(s);
  await sw(s, "Vod Panel").click();
  check("the switch off: it stays, off, and the picker goes", (await sw(s, "Vod Panel").getAttribute("aria-checked")) === "false" && (await vodItem.locator("[data-xtpick]").count()) === 0 && (await vodItem.locator('[data-setting="playlist-library"]').count()) === 1);
  const off = await storeOf(s, "xtVod");
  check("  kept in the library's store, with the picks still in it", off?.vod1?.off === true && off.vod1.picks?.movie?.includes("12"), JSON.stringify(off));
  await closeSettings(s);
  await waitFor(s, async () => /No Movies or Shows Yet/.test(await s.locator("main").innerText()), 8000);
  check("  and Stream is as it was with no library: no row, no folder picker", (await s.locator(".media-row").count()) === 0 && (await s.locator("[data-xtpick]").count()) === 0 && /No Movies or Shows Yet/.test(await s.locator("main").innerText()));
  await goTo(s, "discover");
  const nothing = await waitFor(s, async () => /Nothing to Discover Yet/.test(await s.locator(".discover").innerText().catch(() => "")), 8000);
  check("  and so is Discover", nothing);
  await goTo(s, "home");
  await openSources(s);
  await sw(s, "Vod Panel").click();
  check("the switch back on: on, and the picker is back with the picks pressed", (await sw(s, "Vod Panel").getAttribute("aria-checked")) === "true" && (await vodItem.locator('.xtpick__group[aria-label="Movies"] button[aria-pressed="true"]').count()) === 2);
  await closeSettings(s);
  await s.locator(".media-row__title", { hasText: /^Action$/ }).waitFor({ timeout: 8000 });
  check("  Stream has its rows again", (await rowTitles(s)).includes("Action") && (await rowTitles(s)).includes("Drama"));
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

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
