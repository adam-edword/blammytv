// E2E: the player's status poll slows down once the tune is called dead
// (audit LV4).
//
// useDirectOverlay polls mpv_status every 100ms while a tune is loading, so a
// channel that takes a second or two to present costs ten reads a second for
// that long. A stream that never presents leaves `loading` true for good, and
// the poll stayed at that rate for as long as the "isn't responding" card was
// up. The watchdog's verdict (TheaterOverlay) now reaches the hook through
// setTuneDead, and the poll drops to its steady 500ms.
//
// This runs the real app under the IPC stub the other player harnesses use,
// tunes a Guide channel whose status never reports a frame, and counts the
// native boundary's mpv_status calls over three seconds, first while the
// watchdog is still retrying and then once the card is up. The watchdog's
// three 10s windows are jumped with the page's clock rather than waited out.
//
//   node scripts/fake-panel.mjs   # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-dead-poll.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.clock.install();
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
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    invoke: (cmd, args) => {
      window.__tauriCalls.push(cmd);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      // A stream that never presents a frame: no `presenting`, no end.
      if (cmd === "mpv_status")
        return Promise.resolve(
          JSON.stringify({
            pos: 0, dur: 0, presenting: false, ended: false,
            buffering: false, seekable: true,
            cacheDur: 0, dvrStart: 0, dvrEnd: 0,
            audio: [], subs: [], chapters: [],
          }),
        );
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [
        {
          kind: "xtream",
          id: "t",
          name: "Test",
          enabled: true,
          server: "http://localhost:8081",
          username: "u",
          password: "p",
        },
      ],
    }),
  );
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
await page.locator(".guide__channel button").first().click();
await page.locator(".mini-overlay .tune").waitFor({ timeout: 10_000 });

const polls = () => page.evaluate(() => window.__tauriCalls.filter((c) => c === "mpv_status").length);
/** mpv_status calls over the next three seconds of the page's own time. */
const over3s = async () => {
  const before = await polls();
  await page.clock.runFor(3000);
  return (await polls()) - before;
};

// Tuning: the watchdog is still in its first window, so the poll is fast.
const tuning = await over3s();
check("while the tune is loading the status poll runs fast", tuning >= 20, `${tuning} reads in 3s`);

// Three stalls of 10s: two silent reloads, then the card.
for (let i = 0; i < 3; i++) await page.clock.runFor(10_000);
await page.locator(".mini-overlay .tune__dead").waitFor({ timeout: 5000 });
check("the watchdog calls it dead", (await page.locator(".mini-overlay .tune__dead").count()) > 0);

const dead = await over3s();
check("and with the card up the poll is the steady rate", dead > 0 && dead <= 8, `${dead} reads in 3s`);

// Retry re-arms the watchdog, and the fast poll with it.
await page.locator(".mini-overlay .tune__retry").first().click();
const retrying = await over3s();
check("Retry brings the fast poll back while it tunes again", retrying >= 20, `${retrying} reads in 3s`);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
