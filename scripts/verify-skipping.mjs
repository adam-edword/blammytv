// Seam verify: Skipping and Up Next Card (plan 025, P3a; v0.11.28).
//
// Skip Behavior was one choice for the Skip chip. It is four, one per kind of
// stretch (Intro, Recap, Credits, Preview), each a Button, Automatic or Off,
// and a Combine switch. Up Next Card is when the corner card offers the next
// episode: at the credits, in the last minute, or never.
//
// Mounts the overlay standalone (?overlay=1) against a mocked overlayApi, as
// verify-credits does, and proves:
//   1. Intro on Automatic: entering an `op` interval seeks to its end, once;
//      "Skipped Intro" takes the chip's place and a click goes back to the
//      start; being back inside does not skip again (the once-per-stretch
//      guard: the position is pushed OUT of the stretch after the skip and
//      back IN after the undo, because staying in it would pass without it)
//   2. a seek of the viewer's own that lands inside (an arrow key, a scrubber
//      release) is not skipped; the chip says nothing is pending
//   3. Off draws no chip and seeks nothing; Button draws it and seeks nothing
//      until pressed; live ignores all of it
//   4. the same for a stretch named by a chapter title, with no markers; a run
//      of credits and preview chapters is one automatic jump under Combine,
//      two without, and the undo for a run says so
//   5. a Preview marker out of AIOStreams' answer reads "Skip Preview"
//   6. a stored old Skip Behavior of hidden, combine and normal each read as
//      the migration says, once, into the new key
//   7. Up Next Card: Last minute opens the window 60s from the end with no
//      markers and whatever they say; Never never opens it; At the credits is
//      what verify-credits pins; a change flips it live
//   8. Settings → Playback draws all of it and writes the keys it reads
//
// The end-of-file card is verify-upnext's.
//
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-skipping.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};

// The bridge the overlay is driven through. Everything it is asked to do is
// recorded: absolute seeks (the chip, the undo, the automatic skip, a scrubber
// release), relative ones (the arrow keys), and the credits window's signal.
const mockBridge = () => {
  window.__abs = [];
  window.__rel = [];
  window.__credits = [];
  let timeCbs = [];
  let chapterCbs = [];
  let metaCbs = [];
  let lastTime = null;
  let lastChapters = [];
  let meta = { channelName: "T", title: "Ep", live: false };
  window.__pushTime = (t) => {
    lastTime = t;
    timeCbs.slice().forEach((cb) => cb(t));
  };
  window.__pushChapters = (c) => {
    lastChapters = c;
    chapterCbs.slice().forEach((cb) => cb(c));
  };
  window.__setMeta = (m) => {
    meta = m;
    metaCbs.slice().forEach((cb) => cb(m));
  };
  const unsub = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {},
    seek(d) { window.__rel.push(d); },
    seekAbs(p) { window.__abs.push(p); },
    setSpeed() {}, expand() {}, collapse() {}, fullscreen() {},
    exitFullscreen() {}, popout() {}, sourcePanel() {}, toggleFavorite() {},
    goLive() {}, setMouseIgnore() {},
    creditsWindow(active) { window.__credits.push(active); },
    selectAudio() {}, selectSub() {},
    getMeta() { return Promise.resolve(meta); },
    onMeta(cb) { metaCbs.push(cb); return () => {}; },
    onLoading: unsub, onKey: unsub,
    getLoading() { return false; },
    getTime() { return lastTime; },
    onTime(cb) {
      timeCbs.push(cb);
      return () => { timeCbs = timeCbs.filter((x) => x !== cb); };
    },
    getTracks() { return null; },
    onTracks: unsub,
    getChapters() { return lastChapters; },
    onChapters(cb) {
      chapterCbs.push(cb);
      return () => { chapterCbs = chapterCbs.filter((x) => x !== cb); };
    },
  };
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

const DUR = 1440;
const envelope = (data) => ({ v: 1, data });
const skipping = (over = {}) =>
  envelope({ intro: "button", recap: "button", credits: "button", preview: "button", combine: false, ...over });

/** A page of its own in a context of its own: localStorage is the context's. */
async function scene({ store = {}, props } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 650 },
    screen: { width: 1920, height: 1080 },
  });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(mockBridge);
  await page.addInitScript(
    ({ store, props }) => {
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
      if (props) window.__overlayProps = props;
    },
    { store, props },
  );
  await page.goto(`${APP}?overlay=1`);
  await page.waitForSelector(".theater-overlay");
  return { ctx, page };
}
const meta = (page, skips, live = false) =>
  page.evaluate(([skips, live]) => window.__setMeta({ channelName: "T", title: "Ep", live, skips }), [skips, live]);
const chapters = (page, c) => page.evaluate((c) => window.__pushChapters(c), c);
const at = async (page, pos, dur = DUR) => {
  await page.evaluate(([pos, dur]) => window.__pushTime({ pos, dur }), [pos, dur]);
  await page.waitForTimeout(150);
};
const abs = (page) => page.evaluate(() => window.__abs.slice());
const rel = (page) => page.evaluate(() => window.__rel.slice());
const credits = (page) => page.evaluate(() => window.__credits.slice());
const chip = async (page) => {
  const c = page.locator(".skip-chip");
  return (await c.count()) ? (await c.first().innerText()).trim() : null;
};
// A chip that is not there fails the checks after it and does not stop the run.
const clickChip = (page) => page.locator(".skip-chip").first().click({ timeout: 3000 }).catch(() => {});
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const OP = { type: "op", start: 60, end: 150 };
const ED = { type: "ed", start: 1300, end: 1380 };
const CHAPTERS = [
  { title: "Opening", start: 5 },
  { title: "Part A", start: 95 },
  { title: "Credits", start: 1300 },
  { title: "Preview", start: 1390 },
];

// ============================================================ 1. Intro, Automatic
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto" }) } });
  await meta(page, [OP, ED]);
  await at(page, 30);
  check("Intro on Automatic: before the interval, nothing is skipped and nothing is drawn", same(await abs(page), []) && (await chip(page)) === null, JSON.stringify(await abs(page)));

  await at(page, 62);
  check("  entering the op interval seeks to its end, once", same(await abs(page), [150]), JSON.stringify(await abs(page)));
  check('  and "Skipped Intro" is in the chip\'s place', (await chip(page)) === "Skipped Intro", String(await chip(page)));

  await at(page, 64); // the poll before mpv has moved
  check("  more samples inside the interval do not seek again", same(await abs(page), [150]), JSON.stringify(await abs(page)));

  await at(page, 150); // mpv landed
  check('  at the landing the undo is still there', (await chip(page)) === "Skipped Intro", String(await chip(page)));

  await clickChip(page);
  check("  clicking it seeks back to the start of the interval", same(await abs(page), [150, 60]), JSON.stringify(await abs(page)));
  check("  and the undo goes", (await chip(page)) === null, String(await chip(page)));

  await at(page, 60); // back at the start, where the undo put it
  await at(page, 75);
  await at(page, 149);
  check("  being back inside the interval after an undo does not skip it again", same(await abs(page), [150, 60]), JSON.stringify(await abs(page)));
  check("  and draws nothing, Automatic having no button", (await chip(page)) === null, String(await chip(page)));

  // A second entry into the SAME interval (the viewer seeked back out and in
  // by the clock alone) is the same stretch: once per stretch per play.
  await at(page, 20);
  await at(page, 61);
  check("  nor does leaving it and coming back by the clock", same(await abs(page), [150, 60]), JSON.stringify(await abs(page)));

  // The ed interval is another stretch: Credits is a button, not automatic.
  await at(page, 1320);
  check("  other kinds keep their own setting: Credits is still a button", (await chip(page)) === "Skip Credits" && same(await abs(page), [150, 60]), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}

// "Skipped Intro" is for four seconds.
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto" }) } });
  await meta(page, [OP]);
  await at(page, 62);
  await at(page, 150);
  await page.waitForTimeout(3000);
  const early = await chip(page);
  await page.waitForTimeout(1600);
  const late = await chip(page);
  check('"Skipped Intro" stays about four seconds, then goes by itself', early === "Skipped Intro" && late === null, JSON.stringify({ at3s: early, at4_7s: late }));
  await ctx.close();
}

// ================================================ 2. the viewer's own seek is left alone
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto" }) } });
  await meta(page, [OP]);
  await at(page, 57);
  await page.keyboard.press("ArrowRight"); // +5s: lands at 62, inside
  await page.waitForTimeout(250);
  await at(page, 62);
  await at(page, 66);
  check("an arrow key that lands inside an Automatic stretch is not skipped", same(await abs(page), []) && same(await rel(page), [5]), JSON.stringify({ abs: await abs(page), rel: await rel(page) }));
  check("  and nothing is drawn", (await chip(page)) === null, String(await chip(page)));
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto" }) } });
  await meta(page, [OP]);
  await at(page, 20);
  // Wake the chrome, then release the scrubber about 100s in: inside the interval.
  await page.mouse.move(500, 300);
  await page.mouse.move(520, 310);
  await page.waitForTimeout(200);
  const track = await page.locator(".theater-seek__track").first().boundingBox();
  const x = track.x + track.width * (100 / DUR);
  const y = track.y + track.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  const first = await abs(page);
  await at(page, 100);
  await at(page, 104);
  const all = await abs(page);
  check(
    "a scrubber release inside an Automatic stretch is the viewer's own seek, and is not skipped",
    first.length === 1 && Math.abs(first[0] - 100) < 5 && all.length === 1 && all[0] === first[0],
    JSON.stringify(all),
  );
  await ctx.close();
}

// ============================================================ 3. Off, Button, live
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "off" }) } });
  await meta(page, [OP, ED, { type: "recap", start: 0, end: 50 }]);
  await at(page, 62);
  check("Intro on Off: no chip and no seek inside an op interval", (await chip(page)) === null && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await at(page, 20);
  check("  while Recap, still a button, has its chip and has not seeked", (await chip(page)) === "Skip Recap" && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await clickChip(page);
  check("  and pressing it seeks to the end of the recap", same(await abs(page), [50]), JSON.stringify(await abs(page)));
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto", credits: "auto" }) } });
  await meta(page, [OP, ED], true);
  await at(page, 62);
  await at(page, 1320);
  check("a live stream gets no chip and no automatic seek, whatever is set", (await chip(page)) === null && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ preview: "auto" }) } });
  await meta(page, [{ type: "op", start: 0, end: 1200 }, { type: "preview", start: 0, end: 1200 }]);
  await at(page, 30);
  check("an interval over half the file is no stretch, Automatic or not", (await chip(page)) === null && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}

// ============================================================ 4. chapters
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto" }) } });
  await chapters(page, CHAPTERS);
  await at(page, 30);
  check("Intro on Automatic, from a chapter title with no markers: seeks to the next chapter", same(await abs(page), [95]), JSON.stringify(await abs(page)));
  check('  and says "Skipped Intro"', (await chip(page)) === "Skipped Intro", String(await chip(page)));
  await at(page, 95);
  await clickChip(page);
  await at(page, 5);
  await at(page, 40);
  check("  the undo goes back to the chapter's start and the chapter is not skipped again", same(await abs(page), [95, 5]), JSON.stringify(await abs(page)));
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "off" }) } });
  await chapters(page, CHAPTERS);
  await at(page, 30);
  check("Intro on Off, from a chapter title: no chip and no seek", (await chip(page)) === null && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await at(page, 1310);
  check("  Credits, a button, still has its chip", (await chip(page)) === "Skip Credits", String(await chip(page)));
  await ctx.close();
}
{
  const { ctx, page } = await scene();
  await chapters(page, [{ title: "Recap", start: 0 }, { title: "Part A", start: 60 }]);
  await at(page, 20);
  check("Recap on Button, from a chapter title: the chip, and no seek", (await chip(page)) === "Skip Recap" && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ credits: "auto", combine: true }) } });
  await chapters(page, CHAPTERS);
  await at(page, 1310);
  check("Combine on, Credits on Automatic: one seek past the credits and the preview", same(await abs(page), [DUR]), JSON.stringify(await abs(page)));
  check('  and the undo says what it undid: "Skipped Credits & Preview"', (await chip(page)) === "Skipped Credits & Preview", String(await chip(page)));
  await at(page, DUR); // where mpv puts it
  check("  the undo stays at the very end of the file, nothing left to skip there", (await chip(page)) === "Skipped Credits & Preview" && same(await abs(page), [DUR]), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await clickChip(page);
  check("  and it goes back to where the credits began", same(await abs(page), [DUR, 1300]), JSON.stringify(await abs(page)));
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ credits: "auto", combine: false }) } });
  await chapters(page, CHAPTERS);
  await at(page, 1310);
  await at(page, 1390);
  await at(page, 1395);
  check("  without Combine the same credits stop at the preview, which keeps its own button", same(await abs(page), [1390]) && (await chip(page)) === "Skip Preview", `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ combine: true }) } });
  await chapters(page, CHAPTERS);
  await at(page, 1310);
  check("Combine on with every type a button: one chip for the run, and no seek", (await chip(page)) === "Skip Credits & Preview" && same(await abs(page), []), `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}

// ============================================================ 5. a Preview marker from AIOStreams
{
  const { ctx, page } = await scene();
  // MediaSegments' answer, through the app's own reader of it.
  const got = await page.evaluate(async () => {
    const { skipsFrom } = await import("/src/features/aiojf/rules.ts");
    const seg = (Type, a, b) => ({ Id: "x", ItemId: "y", Type, StartTicks: a * 1e7, EndTicks: b * 1e7 });
    return skipsFrom({ Items: [seg("Outro", 1300, 1400), seg("Preview", 1400, 1430), seg("Commercial", 10, 20)] });
  });
  await meta(page, got);
  await at(page, 1410);
  check(
    'a Preview marker out of AIOStreams\' answer reads "Skip Preview"',
    same(got.map((g) => g.type), ["ed", "preview"]) && (await chip(page)) === "Skip Preview",
    `${JSON.stringify(got)} ${await chip(page)}`,
  );
  await clickChip(page);
  check("  and pressing it seeks to the end of the preview", same(await abs(page), [1430]), JSON.stringify(await abs(page)));
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ preview: "auto" }) } });
  await meta(page, [{ type: "preview", start: 1400, end: 1430 }]);
  await at(page, 1410);
  check('  Preview on Automatic seeks it and says "Skipped Preview"', same(await abs(page), [1430]) && (await chip(page)) === "Skipped Preview", `${await chip(page)} ${JSON.stringify(await abs(page))}`);
  await ctx.close();
}

// ============================================================ 6. the move from Skip Behavior
{
  const { ctx, page } = await scene({ store: { skipBehavior: envelope("hidden") } });
  await meta(page, [OP, ED, { type: "recap", start: 0, end: 50 }]);
  await at(page, 62);
  await at(page, 20);
  await at(page, 1320);
  const now = await stored(page, "skipping");
  check(
    "an old Skip Behavior of hidden reads as every type off: no chip, no seek",
    (await chip(page)) === null && same(await abs(page), []) && now?.intro === "off" && now.recap === "off" && now.credits === "off" && now.preview === "off" && now.combine === false,
    JSON.stringify(now),
  );
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipBehavior: envelope("combine") } });
  await chapters(page, CHAPTERS);
  await at(page, 1310);
  const now = await stored(page, "skipping");
  check(
    "an old Skip Behavior of combine reads as every type a button with combine on: one chip for the run",
    (await chip(page)) === "Skip Credits & Preview" && now?.combine === true && now.intro === "button" && now.credits === "button",
    `${await chip(page)} ${JSON.stringify(now)}`,
  );
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipBehavior: envelope("normal") } });
  await meta(page, [OP]);
  await at(page, 62);
  check("  and an old normal is today's behaviour, with nothing written", (await chip(page)) === "Skip Intro" && (await stored(page, "skipping")) === null, String(await chip(page)));
  await ctx.close();
}
{
  // Once: the new key is the answer from then on.
  const { ctx, page } = await scene({ store: { skipBehavior: envelope("hidden"), skipping: skipping({ intro: "auto" }) } });
  await meta(page, [OP]);
  await at(page, 62);
  check("  and a choice already made under the new key is not overridden by the old one", same(await abs(page), [150]), JSON.stringify(await abs(page)));
  await ctx.close();
}

// ============================================================ live flips
{
  const { ctx, page } = await scene({ store: { skipping: skipping() } });
  await meta(page, [OP]);
  await at(page, 62);
  const before = await chip(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:skipping", { detail: { intro: "off", recap: "button", credits: "button", preview: "button", combine: false } })));
  await page.waitForTimeout(150);
  const afterOff = await chip(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:skipping", { detail: { intro: "auto", recap: "button", credits: "button", preview: "button", combine: false } })));
  await page.waitForTimeout(150);
  check(
    "a change in Settings flips the overlay live: chip, then gone on Off, then a skip on Automatic",
    before === "Skip Intro" && afterOff === null && same(await abs(page), [150]),
    JSON.stringify({ before, afterOff, abs: await abs(page) }),
  );
  await ctx.close();
}

// ============================================================ with a stream key
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "auto" }) }, props: { vod: true, playbackKey: "k1" } });
  await meta(page, [OP]);
  await at(page, 62);
  check("under a playback key, as in the app, the automatic skip still fires once", same(await abs(page), [150]), JSON.stringify(await abs(page)));
  await ctx.close();
}

// ============================================================ 7. Up Next Card
const last = (c) => c[c.length - 1];
{
  const { ctx, page } = await scene({ store: { upNextCard: envelope("last") } });
  await at(page, 600);
  await at(page, 1379);
  const early = await credits(page);
  await at(page, 1380);
  const atSixty = await credits(page);
  await at(page, 1439);
  const late = await credits(page);
  await at(page, 100);
  const back = await credits(page);
  check(
    "Last minute: the window opens 60s from the end with no markers, and not before",
    !early.includes(true) && last(atSixty) === true && last(late) === true && last(back) === false,
    JSON.stringify({ early, atSixty, late, back }),
  );
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { upNextCard: envelope("last") } });
  await meta(page, [ED]);
  await at(page, 1320); // inside an ending, 120s from the end
  const inEnding = await credits(page);
  await at(page, 1390);
  const lastMin = await credits(page);
  check(
    "  whatever the markers say: inside an ed interval 120s out it is shut, and open in the last minute",
    !inEnding.includes(true) && last(lastMin) === true,
    JSON.stringify({ inEnding, lastMin }),
  );
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { upNextCard: envelope("never") } });
  await meta(page, [ED]);
  await chapters(page, [{ title: "Part 1", start: 0 }, { title: "Credits", start: 1310 }]);
  await at(page, 1320);
  await at(page, 1385);
  await at(page, 1430);
  const c = await credits(page);
  check("Never: the window never opens, in an ending or in the last minute", c.length > 0 && !c.includes(true), JSON.stringify(c));
  await ctx.close();
}
{
  const { ctx, page } = await scene();
  await meta(page, [ED]);
  await at(page, 1320);
  const inside = await credits(page);
  await at(page, 1390);
  const out = await credits(page);
  check("At the credits (the default) is the ending's window, as verify-credits pins", last(inside) === true && last(out) === false, JSON.stringify({ inside, out }));
  await ctx.close();
}
{
  const { ctx, page } = await scene({ store: { skipping: skipping({ intro: "off", recap: "off", credits: "off", preview: "off" }) } });
  await meta(page, [ED]);
  await at(page, 1320);
  check("  and it opens with every skip type off, as the old hidden did", last(await credits(page)) === true && (await chip(page)) === null);
  await ctx.close();
}
{
  const { ctx, page } = await scene();
  await meta(page, [ED]);
  await at(page, 1320);
  const open = last(await credits(page));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:up-next-card", { detail: "never" })));
  await page.waitForTimeout(150);
  const shut = last(await credits(page));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("blammytv:up-next-card", { detail: "last" })));
  await page.waitForTimeout(150);
  const inLastMinute = last(await credits(page));
  await at(page, 1400);
  check("a change in Settings flips the window live: open, shut on Never, and on Last minute it follows the clock", open === true && shut === false && inLastMinute === false && last(await credits(page)) === true, JSON.stringify(await credits(page)));
  await ctx.close();
}

// ============================================================ 8. Settings → Playback
async function settings(store, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((store) => {
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
  }, { aiostreams: envelope("http://localhost:8084/manifest.json"), startupTab: envelope("stream"), settingsTab: envelope("playback"), ...store });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.locator(".settings__body [data-setting='skipping']").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  try {
    await fn(page);
  } finally {
    await ctx.close();
  }
}
const pressed = (page, group) =>
  page.evaluate(
    (g) => [...document.querySelectorAll(`.settings__body [role=group][aria-label='${g}'] button[aria-pressed=true]`)].map((b) => b.getAttribute("aria-label")).join(),
    group,
  );
const grp = (page, name) => page.locator(`.settings__body [role=group][aria-label='${name}']`);

await settings({}, async (page) => {
  const lines = {};
  for (const t of ["Intro", "Recap", "Credits", "Preview"]) lines[t] = await pressed(page, t);
  const sw = await page.getByRole("switch", { name: "Combine credits and preview" }).getAttribute("aria-checked");
  check(
    "Settings → Playback on a fresh profile: every type a Button, Combine off, Autoplay 10s, Up Next Card at the credits",
    Object.values(lines).every((v) => v === "Button") && sw === "false" && (await pressed(page, "Autoplay next episode")) === "10s" && (await pressed(page, "Up next card")) === "At the credits",
    JSON.stringify({ lines, sw }),
  );
  await grp(page, "Intro").getByRole("button", { name: "Automatic", exact: true }).click();
  await grp(page, "Credits").getByRole("button", { name: "Off", exact: true }).click();
  await page.getByRole("switch", { name: "Combine credits and preview" }).click();
  await grp(page, "Autoplay next episode").getByRole("button", { name: "5s", exact: true }).click();
  await grp(page, "Up next card").getByRole("button", { name: "Last minute", exact: true }).click();
  await page.waitForTimeout(200);
  const s = await stored(page, "skipping");
  check(
    "  the controls write what they say: skipping, autoplayNext (seconds) and upNextCard",
    s?.intro === "auto" && s.credits === "off" && s.recap === "button" && s.preview === "button" && s.combine === true && (await stored(page, "autoplayNext")) === 5 && (await stored(page, "upNextCard")) === "last",
    JSON.stringify({ s, a: await stored(page, "autoplayNext"), c: await stored(page, "upNextCard") }),
  );
  check(
    "  and Intro shows Automatic, Credits Off, the switch on, 5s and Last minute",
    (await pressed(page, "Intro")) === "Automatic" && (await pressed(page, "Credits")) === "Off" && (await page.getByRole("switch", { name: "Combine credits and preview" }).getAttribute("aria-checked")) === "true" && (await pressed(page, "Autoplay next episode")) === "5s" && (await pressed(page, "Up next card")) === "Last minute",
  );
  await grp(page, "Autoplay next episode").getByRole("button", { name: "Off", exact: true }).click();
  await page.waitForTimeout(150);
  check("  Autoplay Off stores 0", (await stored(page, "autoplayNext")) === 0, String(await stored(page, "autoplayNext")));
});
await settings({ skipBehavior: envelope("hidden") }, async (page) => {
  const lines = [];
  for (const t of ["Intro", "Recap", "Credits", "Preview"]) lines.push(await pressed(page, t));
  check("an old hidden shows as Off on every line when Settings is opened", lines.every((v) => v === "Off"), JSON.stringify(lines));
});
await settings({ skipBehavior: envelope("combine") }, async (page) => {
  const lines = [];
  for (const t of ["Intro", "Recap", "Credits", "Preview"]) lines.push(await pressed(page, t));
  const sw = await page.getByRole("switch", { name: "Combine credits and preview" }).getAttribute("aria-checked");
  check("an old combine shows as Button on every line with Combine on", lines.every((v) => v === "Button") && sw === "true", JSON.stringify({ lines, sw }));
});

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
