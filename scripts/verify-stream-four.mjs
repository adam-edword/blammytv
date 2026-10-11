// E2E: four fixes on the Stream side (v0.11.34, plans/aiostreams-app.md), in
// StreamScreen against scripts/fake-aio.mjs, the native side stubbed where a
// play is the subject.
//
//   1. The next episode's sources are asked for when the Up Next card's
//      window opens (and at the end of the file if they were not), kept 180s,
//      and the roll after the countdown uses them: no second ask.
//   2. Continue Watching's resume goes back to the source the entry was on,
//      among the cached ones: its file name, then its binge group, then the
//      first cached. Never an uncached one.
//   3. An episode that has not aired is drawn dim with its day, takes no
//      click and no Tab, and is never the next episode: the Up Next card
//      after the last aired episode does not arm.
//   4. A title AIOStreams found nothing playable for says why on the source
//      screen: the notices it sent, as it said them.
//
// HOW. verify-upnext's pattern for the plays: the IPC boundary is stubbed, so
// isTauri() is true and StreamScreen plays through useDirectOverlay; mpv_status
// answers from window.__pos / __dur / __ended / __chapters; inv_open's url is
// what was played. The clock (page.clock) is paused once an episode is on, so
// 180 seconds are pumped, not waited. The asks are counted AT THE FAKE
// (GET /__asked/<type>/<id>), as a difference from the count when the
// scenario began: the fake outlives the scenario and the harnesses before it.
// Hidden titles tt500001-3 are in no catalog and are reached from a Continue
// Watching card (fake-aio.mjs says what each is).
//
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-stream-four.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const FAKE = "http://localhost:8084";
const AIO = `${FAKE}/manifest.json`;
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};

const DUR = 3000;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** An episode's Continue Watching entry, mid-way. */
const ep = (n, id = "tt200001", title = "Fake Series One") => ({
  id,
  title,
  kind: "series",
  episodeId: `${id}:1:${n}`,
  season: 1,
  episode: n,
  epTitle: `S1E${n} Title`,
  label: `S1 · E${n}: S1E${n} Title`,
  posSec: 600,
  durSec: DUR,
});
/** The two-releases film's entry, with what it remembers of its source. */
const film = (over = {}) => ({
  id: "tt500002",
  title: "Fake Movie Two Releases",
  kind: "movie",
  posSec: 600,
  durSec: 6000,
  ...over,
});

/** How many times the fake was asked for this stream list. */
const askedAtFake = async (type, id) =>
  (await fetch(`${FAKE}/__asked/${type}/${id}`).then((r) => r.json())).count;

/**
 * A page with a Continue Watching entry seeded, on the Stream tab, offline
 * but for the fake. `tauri` stubs the native side (a play can be driven);
 * `clock` installs page.clock (paused later, by `playing`). `store` is written
 * under blammytv.*.
 */
async function open(entry, { store = {}, chapters = [], tauri = false, clock = false, route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  if (route) await route(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (clock) await page.clock.install();
  await page.addInitScript(
    ({ AIO, store, entry, chapters, DUR, tauri }) => {
      if (tauri) {
        window.__tauriCalls = [];
        window.__pos = 600;
        window.__dur = DUR;
        window.__ended = false;
        window.__chapters = chapters;
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
            if (cmd === "mpv_seek_abs") {
              window.__pos = args.pos;
              return Promise.resolve(undefined);
            }
            if (cmd === "mpv_status")
              return Promise.resolve(
                JSON.stringify({
                  pos: window.__pos,
                  dur: window.__dur,
                  presenting: true,
                  ended: window.__ended,
                  buffering: false,
                  seekable: true,
                  audio: [],
                  subs: [],
                  chapters: window.__chapters,
                }),
              );
            return Promise.resolve(undefined);
          },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      }
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: AIO }));
      localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: [{ ...entry, at: Date.now() }] }));
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
    },
    { AIO, store, entry, chapters, DUR, tauri },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await goTo(page, "home");
  await page.locator(".continue-card").first().waitFor({ timeout: 20_000 });
  return { ctx, page };
}

/** Click a control that is sliding in only once it holds still. */
async function clickWhenStill(page, locator) {
  let last = null;
  let still = 0;
  for (let i = 0; i < 25 && still < 2; i++) {
    const box = await locator.boundingBox().catch(() => null);
    const key = box && `${Math.round(box.x)},${Math.round(box.y)}`;
    still = key && key === last ? still + 1 : 0;
    last = key;
    await page.waitForTimeout(80);
  }
  await locator.click({ timeout: 5000 });
}

const opened = (page) => page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").map((c) => c[1].url));

/** Resume from the card's artwork, and the url mpv was handed. */
async function resumeUrl(page) {
  await clickWhenStill(page, page.locator(".continue-card__artwrap").first());
  const got = await page
    .waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 25_000 })
    .then(() => true, () => false);
  return got ? (await opened(page))[0] : null;
}

/** Play an episode from its card, and stop the page's clock once it is on. */
async function playing(entry, opts = {}) {
  const { ctx, page } = await open(entry, { tauri: true, clock: true, ...opts });
  await clickWhenStill(page, page.locator(".continue-card").first());
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 25_000 });
  await page.waitForFunction(() => window.__tauriCalls.filter((c) => c[0] === "mpv_status").length >= 3, null, { timeout: 15_000 });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 20);
  return { ctx, page };
}

/** Advance the page's clock, then let what that woke settle. */
const pump = async (page, ms) => {
  await page.clock.runFor(ms);
  await page.waitForTimeout(120);
};
/** Pump in steps until `fn` holds in the page (or give up). */
const pumpUntil = async (page, fn, arg, { step = 250, max = 30_000 } = {}) => {
  for (let t = 0; t <= max; t += step) {
    if (await page.evaluate(fn, arg)) return true;
    await pump(page, step);
  }
  return false;
};
const playedEp = (page, id) =>
  pumpUntil(page, (id) => window.__tauriCalls.some((c) => c[0] === "inv_open" && c[1].url.includes(`${id}-`)), id, { max: 15_000 });
const cardUp = (page) => page.locator(".upnext").count();

const STEP = 20;
/** Run the episode to its end: a poll near the end, then mpv's EOF. */
async function endEpisode(page) {
  await page.evaluate((dur) => {
    window.__pos = dur - 5;
    window.__ended = false;
  }, DUR);
  await pump(page, 700);
  await page.evaluate((dur) => {
    window.__pos = dur;
    window.__ended = true;
  }, DUR);
  await pumpUntil(page, () => !!document.querySelector(".upnext"), null, { step: STEP, max: 5000 });
}

const CREDITS = [
  { title: "Part A", start: 0 },
  { title: "Credits", start: 2700 },
];
/** Into the credits: the chapter clock reads it, and the corner card opens. */
async function intoCredits(page) {
  await page.evaluate(() => (window.__pos = 2710));
  return pumpUntil(page, () => !!document.querySelector(".upnext-mini"), null, { max: 6000 });
}

// ======================================================================= 1
// The next episode's sources, at the credits.
{
  const next = "tt200001:1:2";
  const { ctx, page } = await playing(ep(1), { chapters: CREDITS });
  const base = await askedAtFake("series", next);
  await page.evaluate(() => (window.__pos = 2000));
  await pump(page, 1500);
  check("before the credits the next episode's sources have not been asked for", (await askedAtFake("series", next)) === base);
  const mini = await intoCredits(page);
  const atCredits = (await askedAtFake("series", next)) - base;
  check("the credits window opening asks for them, once", mini && atCredits === 1, JSON.stringify({ mini, atCredits }));
  await pump(page, 4000);
  check("  and not again while the window stays open", (await askedAtFake("series", next)) - base === 1);
  await endEpisode(page);
  check(
    "  nor when the file ends: the kept list is young, and the card is up",
    (await cardUp(page)) === 1 && (await askedAtFake("series", next)) - base === 1,
  );
  const rolled = await playedEp(page, next);
  check(
    "  and the roll after the countdown plays the next episode without a second ask",
    rolled && (await askedAtFake("series", next)) - base === 1,
    JSON.stringify({ rolled, asks: (await askedAtFake("series", next)) - base, played: await opened(page) }),
  );
  await ctx.close();
}
{
  // No credits to read (no chapters, no markers): the end of the file asks.
  const next = "tt200001:1:2";
  const { ctx, page } = await playing(ep(1));
  const base = await askedAtFake("series", next);
  await page.evaluate(() => (window.__pos = 2000));
  await pump(page, 1500);
  check("with no credits to read nothing is asked for while it plays", (await askedAtFake("series", next)) === base);
  await endEpisode(page);
  const atEnd = (await askedAtFake("series", next)) - base;
  const text = await page.locator(".upnext__count").first().innerText({ timeout: 2000 }).catch(() => null);
  check("the end of the file asks, with the countdown still running", atEnd === 1 && text === "Playing in 10s", JSON.stringify({ atEnd, text }));
  const rolled = await playedEp(page, next);
  check("  and the roll is not a second ask", rolled && (await askedAtFake("series", next)) - base === 1);
  await ctx.close();
}
{
  // Under 180 seconds a kept list is still the answer; past them it is asked
  // for again (AIOStreams itself holds one for 180).
  const next = "tt200001:1:2";
  for (const [waitMs, asks, name] of [
    [165_000, 1, "a card left waiting 2 minutes 45 later still plays the list it kept"],
    [190_000, 2, "a card left waiting past 180 seconds asks again"],
  ]) {
    const { ctx, page } = await playing(ep(1), { chapters: CREDITS, store: { autoplayNext: 0 } });
    const base = await askedAtFake("series", next);
    await intoCredits(page);
    await endEpisode(page);
    await pump(page, waitMs);
    const waiting = (await cardUp(page)) === 1 && (await askedAtFake("series", next)) - base === 1;
    await page.getByRole("button", { name: "Play now", exact: true }).click();
    const rolled = await playedEp(page, next);
    const asks_ = (await askedAtFake("series", next)) - base;
    check(name, waiting && rolled && asks_ === asks, JSON.stringify({ waiting, rolled, asks: asks_ }));
    await ctx.close();
  }
}
{
  // A prefetch that fails is forgotten and never shown: Play now, while the
  // kept ask is still on the wire and then when it comes back an error, asks
  // fresh and plays.
  const next = "tt200001:1:2";
  let failed = 0;
  const { ctx, page } = await playing(ep(1), {
    chapters: CREDITS,
    route: (ctx) =>
      ctx.route(/localhost:8084\/stream\/series\/tt200001(:|%3A)1(:|%3A)2/, async (r) => {
        if (failed++ > 0) return r.continue();
        await new Promise((res) => setTimeout(res, 1500));
        await r.fulfill({ status: 500, body: "AIOStreams is down" });
      }),
  });
  const base = await askedAtFake("series", next);
  const mini = await intoCredits(page);
  await page.locator(".upnext-mini").getByRole("button", { name: "Play now", exact: true }).click();
  const rolled = await playedEp(page, next);
  const sourceScreen = await page.locator(".vod-detail").count();
  check(
    "a prefetch that failed is never shown: Play now asks again and plays",
    mini && rolled && failed === 2 && sourceScreen === 0 && (await askedAtFake("series", next)) - base === 1,
    JSON.stringify({ mini, rolled, requests: failed, sourceScreen, atFake: (await askedAtFake("series", next)) - base }),
  );
  await ctx.close();
}

// ======================================================================= 2
// Resume goes back to the source you were on.
const FILE_1080 = "Two.Releases.1080p.BluRay.mkv";
const FILE_720 = "Two.Releases.720p.WEB.mkv";
const is4k = (u) => !!u && u.includes("tt500002-4k.mp4");
const is1080 = (u) => !!u && u.includes("tt500002-1080.mp4");
{
  const { ctx, page } = await open(film({ fileName: FILE_1080, bingeGroup: "fake|1080p" }), { tauri: true });
  const url = await resumeUrl(page);
  check("resume plays the file the entry was on, not the first cached", is1080(url), String(url));
  await ctx.close();
}
{
  const { ctx, page } = await open(film({ fileName: FILE_1080 }), { tauri: true });
  await goTo(page, "mylist");
  await page.locator(".continue-card").first().waitFor({ timeout: 10_000 });
  const url = await resumeUrl(page);
  check("  the Library's card resumes the same way", is1080(url), String(url));
  await ctx.close();
}
{
  const { ctx, page } = await open(film({ fileName: "Two.Releases.8K.IMAX.mkv", bingeGroup: "fake|1080p" }), { tauri: true });
  const url = await resumeUrl(page);
  check("  a file that is gone falls back to the same binge group", is1080(url), String(url));
  await ctx.close();
}
{
  const { ctx, page } = await open(film(), { tauri: true });
  const url = await resumeUrl(page);
  check("  an entry from before it remembered a source plays the first cached, as it did", is4k(url), String(url));
  await ctx.close();
}
{
  // The file it was on is no longer cached: it is not opened for you.
  const { ctx, page } = await open(film({ fileName: FILE_720, bingeGroup: "fake|720p" }), { tauri: true });
  const url = await resumeUrl(page);
  check("  never an uncached source, even the one with the entry's file name and group", is4k(url), String(url));
  await ctx.close();
}
{
  // What is written when a play starts: a pick from the source screen too.
  const { ctx, page } = await open(film(), { tauri: true });
  await page.locator("button.continue-card__sources").first().click();
  await page.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await page.locator(".vod-source", { hasText: "Two Releases 1080p" }).first().click();
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 25_000 });
  const e = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.watching")).data[0]);
  check(
    "a pick from the source screen writes the entry's file name and binge group",
    e.fileName === FILE_1080 && e.bingeGroup === "fake|1080p",
    JSON.stringify({ fileName: e.fileName, bingeGroup: e.bingeGroup }),
  );
  await ctx.close();
}
{
  // Resume rewrites it for the play it starts: the next resume follows.
  const { ctx, page } = await open(film({ fileName: FILE_1080, bingeGroup: "fake|1080p" }), { tauri: true });
  await resumeUrl(page);
  const e = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.watching")).data[0]);
  check("a resume keeps the entry on the source it played", e.fileName === FILE_1080 && e.bingeGroup === "fake|1080p", JSON.stringify(e));
  await ctx.close();
}

// ======================================================================= 3
// An episode that has not aired.
{
  const { ctx, page } = await open(ep(2, "tt500001", "Fake Series Airing"));
  await page.locator("button.continue-card__sources").first().click();
  await page.locator(".vod-sources").first().waitFor({ timeout: 15_000 });
  await page.locator(".vod-back").first().click();
  await page.locator(".episode-card").nth(3).waitFor({ timeout: 15_000 });
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll(".episode-card")].map((c) => ({
      unaired: c.classList.contains("is-unaired"),
      disabled: c.disabled,
      tag: c.tagName,
      day: c.querySelector("[data-slot=item-description]")?.textContent?.trim() ?? "",
      art: getComputedStyle(c.querySelector(".tile__art") ?? c).filter,
    })),
  );
  check("the list has the four episodes", cards.length === 4, String(cards.length));
  check(
    "the episode that has not aired says when, in the house form",
    cards[3]?.day === "Airs Mar 5, 2099" && cards.slice(0, 3).every((c) => /^[A-Z][a-z]{2} \d{1,2}, 2024$/.test(c.day)),
    JSON.stringify(cards.map((c) => c.day)),
  );
  check(
    "  it is dim, and the aired ones are not",
    cards[3]?.unaired && /grayscale/.test(cards[3].art) && cards.slice(0, 3).every((c) => !c.unaired && c.art === "none"),
    JSON.stringify(cards.map((c) => [c.unaired, c.art])),
  );
  check("  and a button that is off, the aired ones on", cards[3]?.tag === "BUTTON" && cards[3].disabled && cards.slice(0, 3).every((c) => !c.disabled));
  await page.locator(".episode-card").nth(3).click({ force: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  check(
    "  clicking it does nothing: the list stays",
    (await page.locator(".vod-sources").count()) === 0 && (await page.locator(".episode-card").count()) === 4,
  );
  // Tab from the episode before it never lands on it.
  await page.locator(".episode-card").nth(2).focus();
  await page.keyboard.press("Tab");
  const landed = await page.evaluate(() => document.activeElement?.closest(".is-unaired") !== null);
  await page.locator(".episode-card").nth(3).evaluate((el) => el.focus());
  const forced = await page.evaluate(() => document.activeElement?.closest(".is-unaired") !== null);
  check("  Tab skips it, and it cannot be focused", !landed && !forced, JSON.stringify({ landed, forced }));
  // The control: an aired one opens its sources.
  await page.locator(".episode-card").nth(2).click();
  const opens = await page
    .locator(".vod-sources")
    .first()
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false);
  check("  while an aired episode's click opens its sources", opens);
  await ctx.close();
}
{
  // The last aired episode ends: it is the end of the run.
  const lastAsk = "tt500001:1:4";
  const { ctx, page } = await playing(ep(3, "tt500001", "Fake Series Airing"), { chapters: CREDITS });
  const base = await askedAtFake("series", lastAsk);
  await intoCredits(page);
  await pump(page, 2000);
  const miniUp = await page.locator(".upnext-mini").count();
  await endEpisode(page);
  await pump(page, 3000);
  check(
    "the last aired episode's credits offer nothing, and the end of its file arms no Up Next",
    miniUp === 0 && (await cardUp(page)) === 0,
    JSON.stringify({ miniUp, card: await cardUp(page) }),
  );
  check(
    "  and the one that has not aired is never asked for, nor played",
    (await askedAtFake("series", lastAsk)) === base && (await opened(page)).length === 1,
    JSON.stringify({ asks: (await askedAtFake("series", lastAsk)) - base, opened: await opened(page) }),
  );
  await ctx.close();
}
{
  // The control, so that is not a card that never comes up: the episode
  // before it offers the last aired one.
  const nextAsk = "tt500001:1:3";
  const { ctx, page } = await playing(ep(2, "tt500001", "Fake Series Airing"), { chapters: CREDITS });
  const base = await askedAtFake("series", nextAsk);
  const mini = await intoCredits(page);
  const miniText = await page.locator(".upnext-mini__title").first().innerText().catch(() => "");
  await endEpisode(page);
  const text = await page.locator(".upnext__title").first().innerText().catch(() => "");
  check(
    "  while the episode before it offers it, in the corner and at the end",
    mini && /S1 · E3/.test(miniText) && /S1 · E3/.test(text) && (await askedAtFake("series", nextAsk)) - base === 1,
    JSON.stringify({ miniText, text }),
  );
  await ctx.close();
}

// ======================================================================= 4
// An empty source list says why.
{
  const { ctx, page } = await open({ id: "tt500003", title: "Fake Movie Notices", kind: "movie", posSec: 600, durSec: 6000 });
  await page.locator("button.continue-card__sources").first().click();
  // Not the first .state: "Finding sources…" is one too, for as long as the
  // ask takes.
  await page.locator(".vod-sources").getByText("No sources available").waitFor({ timeout: 15_000 });
  const col = await page.locator(".vod-sources").first().innerText();
  const notes = await page.locator(".vod-sources .state__note").allInnerTexts();
  check("a title nothing could be found for says there are no sources", /No sources available/.test(col) && (await page.locator(".vod-source").count()) === 0);
  check(
    "  and says why, as AIOStreams said it: the error and the statistic",
    notes.length === 2 &&
      notes[0] === "AIOStreams: Torbox: Rate limit exceeded" &&
      notes[1] === "AIOStreams: Statistics: Fetched 0 streams in 1.2s\n80 results filtered out",
    JSON.stringify(notes),
  );
  check("  and not a magnet-only entry's text, which is not a message", !/magnet-only/.test(col));
  await ctx.close();
}
{
  // With sources there is nothing new on the screen, statistic or not.
  const { ctx, page } = await open(film());
  await page.locator("button.continue-card__sources").first().click();
  await page.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const col = await page.locator(".vod-sources").first().innerText();
  check(
    "a title that has sources shows none of it, though its list ends in a statistic",
    (await page.locator(".vod-source").count()) === 3 && !/AIOStreams:|Fetched 3 streams|No sources/.test(col),
    col.slice(0, 120).replace(/\n/g, " | "),
  );
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
