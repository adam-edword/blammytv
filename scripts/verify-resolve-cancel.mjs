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

const stub = `
  window.__tauriCalls = [];
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
        return /\\/stream\\//.test(args.url)
          ? new Promise((r) => setTimeout(() => r(go()), ${HOLD_MS}))
          : go();
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
    JSON.stringify({ v: 1, data: [ENTRY] }),
  )});
`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

/**
 * Land on Stream with the resolving screen up.
 *
 * The Continue Watching card animates in, so a click on it can be dispatched
 * at the box it is about to leave — the same trap verify-cw-sources
 * documents. Wait for it to stop moving first.
 */
async function toResolving() {
  const page = await ctx.newPage();
  await page.addInitScript(stub);
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
  check("nothing is playing yet", (await opened(page)) === false);
  await page.waitForFunction(
    () => window.__tauriCalls.some((c) => c[0] === "inv_open"),
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  check("left alone, the resolve starts playback", await opened(page));
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

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
