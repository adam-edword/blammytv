// Headless verify: cancelling the resolving screen actually cancels.
//
// WHAT THIS IS ABOUT. Between "play this" and the first frame there is a
// source resolve — one or two addon round trips, and they inherit the Rust
// client's 30 second timeout. The screen shown during it (.vod-stage with
// the breathing art) offers three ways out: a Cancel button, Escape, and the
// mouse's back button. All three only ever hid the screen. The request was
// still in flight, and when it landed it called setPlaying and started the
// thing you had just refused, up to half a minute later.
//
// It predates v0.9.31 on the Watch Now and quick-resume paths. v0.9.31 is
// what made it matter: stopping the old episode before resolving the new one
// gave every episode roll a four-second window with a Cancel button in it.
//
// HOW. The Tauri IPC boundary is stubbed (the ?sportstheater=1 pattern), so
// isTauri() is true and the resolving screen renders at all — it is gated on
// it, which is why no existing harness could reach this. The stub answers
// http_get with the page's own fetch, and HOLDS the /stream/ request for a
// few seconds so the screen stays up long enough to click.
//
// The assertion is inv_open: that command is mpv being handed a url, so
// "playback started" is a fact from the native boundary rather than a guess
// at the DOM.
//
// The same stub also answers which episode a Continue Watching card
// resumes (a finished one rolls forward, audit ST1), whether a palette
// pick during a resolve cancels it (audit ST9), and what the dead card's
// Retry plays when its fresh resolve has nothing cached (audit ST6).
//
// Run, from the REPO ROOT:
//   node scripts/fake-aio.mjs                              # :8084
//   cd apps/app && pnpm exec vite --port 4173 --strictPort # or build+preview
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-resolve-cancel.mjs

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/";
const AIO = "http://localhost:8084/manifest.json";
/** Long enough to click through the screen, short enough to wait out. */
const HOLD_MS = 4000;

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// A movie fake-aio knows about, so the resolve is real: meta comes back, the
// stream list comes back, and the first entry is cached (⚡) — which is the
// only kind quick-resume will auto-play.
const ENTRY = {
  id: "tt100001",
  title: "Fake Movie One",
  kind: "movie",
  posSec: 600,
  durSec: 5400,
  at: Date.now(),
};

const stubFor = (entry, { hold = true } = {}) => `
  window.__tauriCalls = [];
  // What the fresh stream list says about the cache, for the Retry checks
  // (audit ST6). Unset: fake-aio's list as it is served. Otherwise every
  // stream carries the structured flag the app trusts first, so a list can
  // have nothing cached, or only its second source, whatever the fake says.
  const rewrite = (text) => {
    const mode = window.__streamMode;
    if (!mode) return text;
    const body = JSON.parse(text);
    body.streams = mode === "empty" ? [] : (body.streams ?? []).map((s) => {
      if (!s.url) return s;
      const cached = mode === "second-cached" && /-1080/.test(s.url);
      return { ...s, streamData: { service: { cached } } };
    });
    return JSON.stringify(body);
  };
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => { const id = ++cb; window["_" + id] = f; return id; },
    convertFileSrc: (p) => p,
    // getCurrentWindow() reads this, and setFullscreen goes through it —
    // without it the first fullscreen call throws INSIDE the play path and
    // takes StreamScreen down with it. The event plugin's unlisten reads
    // its own global; a missing one only warns, but it warns on every
    // teardown and drowns anything real in the console.
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    invoke: (cmd, args) => {
      window.__tauriCalls.push([cmd, args]);
      if (cmd === "http_get") {
        const go = () => fetch(args.url).then((r) => r.text());
        // HOLD THE SOURCE REQUEST ONLY. The meta resolve has to complete or
        // quick-resume bails to the detail page before the screen is worth
        // clicking; it is the /stream/ call that the resolving screen is
        // waiting on, and the one the user gets bored of.
        if (!/\\/stream\\//.test(args.url)) return go();
        return ${hold}
          ? new Promise((r) => setTimeout(() => r(go().then(rewrite)), ${HOLD_MS}))
          : go().then(rewrite);
      }
      if (cmd === "mpv_status") {
        return Promise.resolve(JSON.stringify({
          pos: 0, dur: 0, presenting: false, ended: false,
          buffering: false, seekable: true,
          audio: [], subs: [], chapters: [],
        }));
      }
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.aiostreams", ${JSON.stringify(
    JSON.stringify({ v: 1, data: AIO }),
  )});
  localStorage.setItem("blammytv.watching", ${JSON.stringify(
    JSON.stringify({ v: 1, data: [entry] }),
  )});
`;
const stub = stubFor(ENTRY);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

/**
 * Land on Stream and click the Continue Watching card.
 *
 * The card animates in, so a click on it can be dispatched at the box it is
 * about to leave (the same trap verify-cw-sources documents). Wait for it to
 * stop moving first.
 */
async function openCard(source = stub, { clock = false } = {}) {
  const page = await ctx.newPage();
  // A page clock lets the dead-card checks jump the watchdog's 40 seconds.
  if (clock) await page.clock.install();
  await page.addInitScript(source);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: /^stream$/i }).first().click({ timeout: 15_000 });
  const card = page.locator(".continue-card").first();
  await card.waitFor({ timeout: 20_000 });
  let last = null;
  let same = 0;
  for (let i = 0; i < 25 && same < 2; i++) {
    const box = await card.boundingBox().catch(() => null);
    const key = box && `${Math.round(box.x)},${Math.round(box.y)}`;
    same = key && key === last ? same + 1 : 0;
    last = key;
    await page.waitForTimeout(80);
  }
  await card.click({ timeout: 5000 });
  return page;
}
/** Land on Stream with the resolving screen up. */
async function toResolving(source = stub) {
  const page = await openCard(source);
  await page.waitForSelector(".tune__vodcancel", { timeout: 15_000 });
  return page;
}

/** Did mpv get handed a url? The one fact that says playback started. */
const opened = (page) =>
  page.evaluate(() => window.__tauriCalls.some((c) => c[0] === "inv_open"));

// ---- The control: left alone, the resolve plays ------------------------
// Without this the three checks below would pass against a build where the
// resolve simply never works, which is not the same claim at all.
{
  const page = await toResolving();
  check("the resolving screen appears while sources are fetched", true);
  // v0.10.21: the first half of the loading screen the player finishes, so
  // it starts with the same bar at its first stage, the Cancel under the art.
  const stage = await page.evaluate(() => ({
    label: document.querySelector(".vodload__label")?.textContent,
    cancelInside: !!document.querySelector(".vodload .tune__vodcancel"),
  }));
  check(
    "  it is the loading screen at its first stage, Finding a source, with Cancel on it",
    stage.label === "Finding a source…" && stage.cancelInside,
    JSON.stringify(stage),
  );
  check("nothing is playing yet", (await opened(page)) === false);
  await page.waitForFunction(
    () => window.__tauriCalls.some((c) => c[0] === "inv_open"),
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  check("left alone, the resolve starts playback", await opened(page));
  // v0.10.77: only a live channel opens with subtitles off. A film keeps
  // mpv's own pick, with the remembered language on top (TheaterOverlay).
  const live = await page.evaluate(
    () => window.__tauriCalls.find((c) => c[0] === "inv_open")?.[1]?.live,
  );
  check("  and opens it as VOD, keeping its subtitles", live === false, JSON.stringify({ live }));
  await page.close();
}

// ---- The three ways out ------------------------------------------------
for (const [label, dismiss] of [
  ["the Cancel button", (page) => page.click(".tune__vodcancel")],
  ["Escape", (page) => page.keyboard.press("Escape")],
  // Button 3 is "back" on a mouse. useMouseNav listens for mouseup.
  [
    "the mouse back button",
    (page) =>
      page.evaluate(() => {
        for (const type of ["mousedown", "mouseup"])
          window.dispatchEvent(
            new MouseEvent(type, { button: 3, buttons: 8, bubbles: true }),
          );
      }),
  ],
]) {
  const page = await toResolving();
  await dismiss(page);
  const gone = await page
    .waitForSelector(".tune__vodcancel", { state: "detached", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check(`${label} closes the resolving screen`, gone);
  // Wait out the held request AND the round trip after it, then check that
  // the answer was thrown away rather than acted on.
  await page.waitForTimeout(HOLD_MS + 3000);
  check(
    `${label} means the resolve never starts playback`,
    (await opened(page)) === false,
    JSON.stringify(
      await page.evaluate(() => window.__tauriCalls.map((c) => c[0])),
    ),
  );
  await page.close();
}

// ---- A finished episode's card plays the next one (audit ST1) ----------
// Leaving in the credits and clicking the card used to start the same
// episode at 0:00. The card now rolls forward; a part-watched one still
// resumes where it was, and a finished finale plays as it did. The stream
// list comes from fake-aio, whose series have 2 seasons of 3 episodes and
// whose urls carry the episode id, so inv_open says which one played.
const SERIES = {
  id: "tt200001",
  title: "Fake Series One",
  kind: "series",
  at: Date.now(),
};
const episodeEntry = (s, e, posSec, durSec) => ({
  ...SERIES,
  episodeId: `tt200001:${s}:${e}`,
  season: s,
  episode: e,
  epTitle: `S${s}E${e} Title`,
  label: `S${s} · E${e}: S${s}E${e} Title`,
  posSec,
  durSec,
});
/** Click the card's artwork and report what played: the url mpv got, where
 * it started, every source list asked for (by episode id), and the
 * Continue Watching entry as the play left it, before any progress tick. */
async function resumeOf(entry) {
  const page = await toResolving(stubFor(entry));
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 25_000 }).catch(() => {});
  const seen = await page.evaluate(() => ({
    open: window.__tauriCalls.find((c) => c[0] === "inv_open")?.[1] ?? null,
    asked: window.__tauriCalls
      .filter((c) => c[0] === "http_get" && /\/stream\//.test(c[1].url))
      .map((c) => decodeURIComponent(c[1].url).replace(/^.*\/stream\/series\//, "").replace(/\.json.*$/, "")),
    entry: JSON.parse(localStorage.getItem("blammytv.watching") ?? "null")?.data?.[0] ?? null,
  }));
  await page.close();
  return seen;
}
{
  const r = await resumeOf(episodeEntry(1, 1, 2700, 2800));
  check(
    "a finished episode's card plays the NEXT episode, from its start",
    !!r.open && r.open.url.includes("tt200001:1:2-") && r.open.start == null,
    JSON.stringify({ url: r.open?.url, start: r.open?.start }),
  );
  check(
    "  and asks for the next episode's sources only, not the finished one's",
    r.asked.length > 0 && r.asked.every((id) => id === "tt200001:1:2"),
    JSON.stringify(r.asked),
  );
}
{
  const r = await resumeOf(episodeEntry(1, 3, 2700, 2800));
  check(
    "  a season's last episode rolls into the next season's first",
    !!r.open && r.open.url.includes("tt200001:2:1-") && r.open.start == null,
    JSON.stringify({ url: r.open?.url, start: r.open?.start }),
  );
}
{
  const r = await resumeOf(episodeEntry(1, 2, 600, 2800));
  check(
    "a part-watched episode's card still resumes the same episode at its point",
    !!r.open && r.open.url.includes("tt200001:1:2-") && r.open.start === 597,
    JSON.stringify({ url: r.open?.url, start: r.open?.start }),
  );
  check("  and asks for its sources at once", r.asked.length > 0 && r.asked.every((id) => id === "tt200001:1:2"), JSON.stringify(r.asked));
  check(
    "  and keeps its progress in the entry",
    r.entry?.posSec === 600 && r.entry.durSec === 2800,
    JSON.stringify({ posSec: r.entry?.posSec, durSec: r.entry?.durSec }),
  );
}
{
  const r = await resumeOf(episodeEntry(2, 3, 2700, 2800));
  check(
    "a finished finale plays as before: the same episode, from its start",
    !!r.open && r.open.url.includes("tt200001:2:3-") && r.open.start == null,
    JSON.stringify({ url: r.open?.url, start: r.open?.start }),
  );
  // Audit ST2: started over, it writes none of the old progress. The old
  // 96% sat in the entry until the first tick, and a stop on leaving before
  // that read it and told Trakt it was watched again.
  check(
    "  and starting it over leaves none of the finished watch's progress in its entry",
    r.entry?.episodeId === "tt200001:2:3" && r.entry.posSec === undefined && r.entry.durSec === undefined,
    JSON.stringify({ posSec: r.entry?.posSec, durSec: r.entry?.durSec }),
  );
}
// The Sources chip lists the same episode a click on the artwork would play.
for (const [what, entry, label] of [
  ["a finished episode's", episodeEntry(1, 1, 2700, 2800), "S1 · E2: S1E2 Title"],
  ["a part-watched one's", episodeEntry(1, 1, 600, 2800), "S1 · E1: S1E1 Title"],
]) {
  const page = await ctx.newPage();
  await page.addInitScript(stubFor(entry));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: /^stream$/i }).first().click({ timeout: 15_000 });
  const chip = page.locator("button.continue-card__sources").first();
  await chip.waitFor({ timeout: 20_000 });
  let last = null;
  let same = 0;
  for (let i = 0; i < 25 && same < 2; i++) {
    const box = await chip.boundingBox().catch(() => null);
    const key = box && `${Math.round(box.x)},${Math.round(box.y)}`;
    same = key && key === last ? same + 1 : 0;
    last = key;
    await page.waitForTimeout(80);
  }
  await chip.click({ timeout: 5000 });
  const shown = await page.locator(".vod-detail__episode").first().innerText({ timeout: 15_000 }).catch(() => null);
  check(`the Sources chip on ${what} card lists ${label.slice(0, 7)}`, shown === label, String(shown));
  await page.close();
}

// ---- A palette pick during a resolve cancels it (audit ST9) -------------
// The pick stopped a playing stream but not a resolving one, so the older
// resolve landed after it and played the first title over the second.
{
  const page = await toResolving();
  await page.keyboard.press("Control+k");
  const up = await page.locator(".palette").waitFor({ timeout: 4000 }).then(() => true, () => false);
  await page.keyboard.type("series one");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  const picked = await page.locator(".vod-detail").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("a palette pick during a resolve opens the picked title", up && picked, JSON.stringify({ up, picked }));
  // Wait out the held request AND the round trip after it.
  await page.waitForTimeout(HOLD_MS + 3000);
  check(
    "  and the resolve it overtook never starts playback",
    (await opened(page)) === false,
    JSON.stringify(await page.evaluate(() => window.__tauriCalls.map((c) => c[0]))),
  );
  await page.close();
}

// ---- Retry on the dead card never opens an uncached source (audit ST6) --
// Opening an uncached debrid source starts a torrent download on the
// viewer's account, so only a click on a row may do it. Retry re-resolves,
// and used to play the first source when none was cached. Now it opens the
// player's Sources panel on the list it just got and plays nothing; a pick
// there is the viewer's own say-so.
//
// The dead card is the real one: the stub's mpv never presents a frame, and
// the page clock jumps the VOD watchdog's 40 seconds. What mpv was handed is
// read off inv_open, and what the app asked the addon off the /stream/ calls.
// Playback starts from the served list (4K cached); the mode set after that
// is what Retry's fresh resolve sees.
const opens = (page) =>
  page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").map((c) => c[1]));
const streamAsks = (page) =>
  page.evaluate(
    () => window.__tauriCalls.filter((c) => c[0] === "http_get" && /\/stream\//.test(c[1].url)).length,
  );
async function toDeadCard() {
  const page = await openCard(stubFor(ENTRY, { hold: false }), { clock: true });
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 20_000 });
  for (let i = 0; i < 6 && (await page.locator(".tune__dead").count()) === 0; i++)
    await page.clock.runFor(10_000);
  await page.locator(".tune__dead").waitFor({ timeout: 5000 });
  return page;
}
/** Retry with the fresh resolve in `mode`; resolves once it has been asked. */
async function retryWith(page, mode) {
  await page.evaluate((m) => { window.__streamMode = m; }, mode);
  const before = await streamAsks(page);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(
    (n) => window.__tauriCalls.filter((c) => c[0] === "http_get" && /\/stream\//.test(c[1].url)).length > n,
    before,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(600);
  return before;
}
{
  const page = await toDeadCard();
  const first = await opens(page);
  check("the dead card is up on a film that opened one stream", first.length === 1, JSON.stringify(first.map((o) => o.url)));
  const asked = await retryWith(page, "none-cached");
  const after = await opens(page);
  check(
    "Retry with nothing cached opens no stream",
    after.length === first.length,
    JSON.stringify(after.map((o) => o.url)),
  );
  const panel = await page.evaluate(() => ({
    open: !!document.querySelector(".vod-panel"),
    rows: document.querySelectorAll(".vod-panel .vod-source").length,
    uncached: document.querySelectorAll('.vod-panel .vod-source[data-cache="uncached"]').length,
    group: document.querySelector('.vod-panel [role="group"]')?.getAttribute("aria-label"),
  }));
  check(
    "  and the Sources panel is open on the sources, labelled Not cached",
    panel.open && panel.rows === 2 && panel.uncached === 2 && /^Not cached/.test(panel.group ?? ""),
    JSON.stringify(panel),
  );
  check(
    "  from the list Retry resolved, not a second request",
    (await streamAsks(page)) === asked + 1,
    `${(await streamAsks(page)) - asked} requests`,
  );
  // The viewer's click on a Not cached row is the approval.
  await page.locator('.vod-panel .vod-source[data-cache="uncached"]').nth(1).click({ timeout: 3000 }).catch(() => {});
  await page.waitForFunction(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").length > 1, null, { timeout: 5000 }).catch(() => {});
  const picked = await opens(page);
  check(
    "picking a Not cached row opens that source, at the saved position",
    picked.length === first.length + 1 && /-1080/.test(picked.at(-1)?.url ?? "") && picked.at(-1)?.start === 597,
    JSON.stringify(picked.map((o) => [o.url, o.start])),
  );
  await page.close();
}
{
  const page = await toDeadCard();
  const first = await opens(page);
  await retryWith(page, "second-cached");
  const after = await opens(page);
  check(
    "Retry with a cached source plays it (the second here, not the list's first)",
    after.length === first.length + 1 && /-1080/.test(after.at(-1)?.url ?? ""),
    JSON.stringify(after.map((o) => o.url)),
  );
  check("  and opens no Sources panel", (await page.locator(".vod-panel").count()) === 0);
  await page.close();
}
{
  // The source that died can be the viewer's own uncached pick, and the
  // addon hands its url back unchanged. Picking that row in the panel Retry
  // opened is asking to try it again: it opens again, where the panel's
  // "already playing this one" used to swallow the click and leave the
  // dead card up.
  const page = await toDeadCard();
  const first = await opens(page);
  await retryWith(page, "none-cached");
  const row = page.locator(".vod-panel .vod-source--current");
  const marked = await row.count();
  await row.first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForFunction((n) => window.__tauriCalls.filter((c) => c[0] === "inv_open").length > n, first.length, { timeout: 5000 }).catch(() => {});
  const again = await opens(page);
  check(
    "picking the source that died, in the panel Retry opened, opens it again at the saved position",
    marked === 1 && again.length === first.length + 1 && again.at(-1)?.url === first[0]?.url && again.at(-1)?.start === 597,
    JSON.stringify({ marked, opens: again.map((o) => [o.url, o.start]) }),
  );
  await page.close();
}
{
  const page = await toDeadCard();
  const first = await opens(page);
  await retryWith(page, "empty");
  check(
    "Retry with no sources at all falls back to the plain reload: nothing new opened, no panel",
    (await opens(page)).length === first.length &&
      (await page.locator(".vod-panel").count()) === 0 &&
      (await page.evaluate(() => window.__tauriCalls.some((c) => c[0] === "mpv_go_live"))),
  );
  await page.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
