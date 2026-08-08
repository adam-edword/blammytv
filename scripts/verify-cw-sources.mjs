// The Continue Watching card's two targets, headlessly.
//
// The Sources chip and the title/meta line must both land the SOURCE LIST
// without playing anything; the artwork must still quick-resume. They used to
// be the same call (`onSources` and `onOpen` were both requestResumeInStream),
// so the chip quick-resumed instead of doing what it says, and with a cached
// source that meant it silently started playback — or, with none, bounced to
// a detail page. Reported as "the Sources button doesn't do anything".
//
// Seeds a watching entry in localStorage and drives the real Library tab. No
// AIOStreams URL is configured, so resolveVodItem returns null and the source
// screen is unreachable — what this asserts is the ROUTING: the chip and the
// text must leave Home and never enter playback, which is the part that was
// broken. Network is stubbed so the run is deterministic offline.
//
// Run:
//   pnpm --filter @blammytv/app build
//   pnpm --filter @blammytv/app preview            # serves :4173
//   npm i playwright-core   (anywhere, e.g. the session scratchpad)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-cw-sources.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const ENTRY = {
  id: "tt1375666",
  episodeId: "tt1375666:1:4",
  title: "A Watched Title",
  label: "S1 · E4 — The One With The Chip",
  kind: "series",
  season: 1,
  episode: 4,
  epTitle: "The One With The Chip",
  posSec: 600,
  durSec: 5400,
  at: Date.now(),
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// Nothing external is reachable here, and a hanging request would just make
// the resolve spinner outlive the assertions.
await page.route("**://*.espncdn.com/**", (r) => r.abort());
await page.route("**://v3-cinemeta.strem.io/**", (r) => r.abort());
await page.addInitScript((entry) => {
  localStorage.setItem(
    "blammytv.watching",
    JSON.stringify({ v: 1, data: [entry] }),
  );
}, ENTRY);

/** A fresh profile lands on onboarding, which covers the shell. Dismiss it
 * the way a user does rather than guessing at its storage key. */
async function toLibrary() {
  await page.waitForLoadState("networkidle").catch(() => {});
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: /^library$/i }).first().click({ timeout: 8000 });
}

await page.goto(URL);
const gotLibrary = await toLibrary()
  .then(() => true)
  .catch(() => false);
check("the Library tab opens", gotLibrary);

const card = page.locator(".continue-card").first();
check(
  "the seeded Continue Watching card renders",
  await card
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false),
);

// Both targets must exist and be REAL buttons — the whole point is that they
// are separately clickable inside a card that is itself a click target.
check(
  "the Sources chip is a button",
  (await card.locator("button.continue-card__sources").count()) === 1,
);
check(
  "the title/meta line is a button",
  (await card.locator("button.continue-card__text").count()) === 1,
);
check(
  "the title text lives inside that button",
  (await card
    .locator("button.continue-card__text .stream-card__name")
    .innerText({ timeout: 2000 })
    .catch(() => null)) === ENTRY.title,
);

// The routing assertion. Clicking either target must leave Home for the
// resolve, and must NEVER enter playback.
async function clicksAway(label, selector) {
  await page.reload();
  await toLibrary();
  await page.locator(".continue-card").first().waitFor();
  // A missing target is a FAILURE to report, not an exception to die on —
  // the pre-fix build has no .continue-card__text at all, and that run is
  // exactly the one whose full result matters.
  const hit = await page
    .locator(selector)
    .first()
    .click({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check(`${label} exists and is clickable`, hit);
  if (!hit) return;
  // Either the resolving screen or a detail/source screen — anything but
  // the Library grid we started on, and no player.
  const left = await page
    .waitForFunction(
      () => !document.querySelector(".continue-card"),
      null,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);
  const playing = await page.locator("#inv-chrome, .theater-overlay").count();
  check(`${label} leaves the Library grid`, left);
  check(`${label} does not start playback`, playing === 0);
}

await clicksAway("the Sources chip", "button.continue-card__sources");
await clicksAway("the title/meta line", "button.continue-card__text");

// ---------------------------------------------------------------------------
// The DISCRIMINATING case. Everything above also passed before the fix,
// because with nothing cached quickResume bounced to a detail page, which
// also leaves the grid. The behaviour that actually changed only shows when
// a CACHED source exists: quickResume auto-plays it, openSources must not.
// Needs scripts/fake-aio.mjs on :8084 — skipped, loudly, when it is absent.
const addon = "http://localhost:8084/manifest.json";
const addonUp = await fetch(addon)
  .then((r) => r.ok)
  .catch(() => false);
if (!addonUp) {
  console.log(
    "\n! fake addon not running — the cached-source case was NOT covered.\n" +
      "  Start it with:  node scripts/fake-aio.mjs\n",
  );
} else {
  // A series episode the fake serves a "⚡ 4K | Debrid" stream for, i.e. one
  // pickCachedIndex will happily auto-play.
  const CACHED = { ...ENTRY, id: "tt200001", episodeId: "tt200001:1:2" };
  await page.addInitScript(
    ({ entry, url }) => {
      localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: [entry] }));
      localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: url }));
    },
    { entry: CACHED, url: addon },
  );

  for (const [label, selector] of [
    ["the Sources chip", "button.continue-card__sources"],
    ["the title/meta line", "button.continue-card__text"],
  ]) {
    await page.goto(URL);
    await toLibrary();
    await page.locator(".continue-card").first().waitFor();
    const hit = await page
      .locator(selector)
      .first()
      .click({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!hit) {
      check(`${label} exists (cached case)`, false);
      continue;
    }
    // Give quick-resume every chance to reach playback if it were going to.
    await page.waitForTimeout(4000);
    const played = await page.evaluate(
      () => !!document.querySelector(".theater-overlay, #inv-chrome video, video"),
    );
    const onSources = await page.evaluate(
      () => !!document.querySelector(".vod-detail"),
    );
    check(`${label} does NOT auto-play a cached source`, !played);
    check(`${label} lands a detail/source screen`, onSources, String(onSources));
  }
}

// ---------------------------------------------------------------------------
// THE STREAM TAB, which is a different call site from the Library and was the
// literally-dead one. Stream Home renders the same Continue Watching row, but
// its handler used to be `if (item) void open(item)` where `item` comes from
// the loaded catalog map — and Continue Watching renders from localStorage,
// so anything not in the currently-loaded rows resolved to undefined and the
// click did NOTHING. This uses an id no catalog serves, which is the exact
// miss case.
{
  const STRANGER = {
    ...ENTRY,
    id: "tt9999999",
    episodeId: "tt9999999:1:1",
    title: "Not In Any Catalog",
  };
  await page.addInitScript((entry) => {
    localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: [entry] }));
  }, STRANGER);

  for (const [label, selector] of [
    ["Stream tab: the Sources chip", "button.continue-card__sources"],
    ["Stream tab: the title/meta line", "button.continue-card__text"],
  ]) {
    await page.goto(URL);
    await page.waitForLoadState("networkidle").catch(() => {});
    const skip = page.getByRole("button", { name: /skip setup/i }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    // Stream Home is the default landing tab; the CW row renders there too.
    const card = page.locator(".continue-card").first();
    const there = await card
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check(`${label}: the card renders on Stream Home`, there);
    if (!there) continue;
    const hit = await page
      .locator(selector)
      .first()
      .click({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!hit) {
      check(`${label} exists`, false);
      continue;
    }
    // The whole assertion: SOMETHING happened. Pre-fix this stayed put.
    const moved = await page
      .waitForFunction(() => !document.querySelector(".continue-card"), null, {
        timeout: 8000,
      })
      .then(() => true)
      .catch(() => false);
    check(`${label} is not a dead click`, moved);
  }
}

// ---------------------------------------------------------------------------
// Quick-resume must fire the META and STREAM requests CONCURRENTLY.
//
// They are independent — resolveVodSources takes only an id — but ran strictly
// one after the other, so a resume paid both round trips end to end. Against a
// real addon each is 1.1-2.1s, so that was an avoidable ~1.5s between the
// click and the picture. Proven by overlap in time, not by reading the code:
// the /stream/ request must be ISSUED before the /meta/ response FINISHES.
if (addonUp) {
  const RESUME = { ...ENTRY, id: "tt200001", episodeId: "tt200001:1:2" };
  await page.addInitScript(
    ({ entry, url }) => {
      localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: [entry] }));
      localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: url }));
    },
    { entry: RESUME, url: addon },
  );

  const started = [];
  const finished = [];
  const onReq = (r) => started.push([r.url(), Date.now()]);
  const onFin = (r) => finished.push([r.url(), Date.now()]);
  page.on("request", onReq);
  page.on("requestfinished", onFin);

  await page.goto(URL);
  await toLibrary();
  await page.locator(".continue-card").first().waitFor();
  // ONLY requests caused by the click. The app fetches a pile of /meta/ on
  // startup for the catalog rows, and taking the first one repo-wide meant
  // comparing the click's stream request against a page-load meta from
  // seconds earlier — which reported a real parallel fetch as serial.
  started.length = 0;
  finished.length = 0;
  // The CARD BODY, not the chip — quick-resume, which is the path with the
  // two round trips in it.
  await page.locator(".continue-card__artwrap").first().click();
  await page.waitForTimeout(6000);
  page.off("request", onReq);
  page.off("requestfinished", onFin);

  const firstAt = (list, part) =>
    list.filter(([u]) => u.includes(part)).map(([, t]) => t).sort((a, b) => a - b)[0];
  const metaDone = firstAt(finished, "/meta/");
  const streamStart = firstAt(started, "/stream/");

  check("quick-resume asks the addon for streams", streamStart !== undefined);
  if (metaDone === undefined) {
    // NOT a failure, and worth stating rather than hiding: when the entry is
    // already in the loaded catalog rows, quickResume skips the meta resolve
    // entirely and makes ONE request. The parallelisation is a no-op there.
    // It only pays when the item is absent — a title started from Discover,
    // from My List, or from a row that has rotated out.
    //
    // This fixture cannot reach that case: fake-aio's fullMeta() serves only
    // ids present in BY_ID, so every id it has meta for is also in a catalog
    // and is therefore always `known`. Covering it needs a fixture id with
    // meta+streams but no catalog entry.
    console.log(
      "  ....  single request (entry already in the catalog) — the parallel\n" +
        "        path was NOT exercised; see the note in this script.",
    );
  } else {
    check(
      "the stream request starts before the meta response lands (parallel)",
      streamStart <= metaDone,
      `${metaDone - streamStart}ms of overlap`,
    );
  }
}

await page.screenshot({ path: "cw-sources.png" });
await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
