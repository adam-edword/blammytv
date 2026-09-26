// E2E: Settings → General's update row reports a hot-channel bundle that is
// waiting, however it got there (v0.10.4).
//
// 0.10.3 was the hot channel's first real update. The launch-time check
// staged it 4 seconds in, and "Check for updates" then said "You're up to
// date": its hot check answered "" (the bundle was already staged, so
// nothing new to do), and the row only ever learnt about a waiting bundle
// from that answer or from the status it read as Settings opened. Adam:
// "checking for update doesn't do anything".
//
// The IPC stub stands in for the native side: frontend_status reports
// whatever the page has staged, frontend_check reports nothing new, and the
// native updater has nothing either.
//
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-updates.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Offline, like every harness: nothing here needs the network.
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  window.__staged = "";
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
    invoke: (cmd) => {
      if (cmd === "frontend_status") {
        window.__statusAsked = (window.__statusAsked ?? 0) + 1;
        return Promise.resolve({ serving: "", pending: window.__staged });
      }
      // Already staged, so nothing NEW to do: the case that went wrong.
      if (cmd === "frontend_check") return Promise.resolve("");
      if (cmd === "check_update") return Promise.resolve(null);
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Settings", exact: true }).first().click();
const row = page.locator(".customize-row", { hasText: "BlammyTV v" });
await row.waitFor({ timeout: 15_000 });
const note = () => row.locator(".settings__section-note").innerText();

// Nothing waiting: Check says so, and offers no restart.
const asked = await page.evaluate(() => window.__statusAsked ?? 0);
await row.getByRole("button", { name: "Check for updates" }).click();
// Until this Check has read the status, staging below would race it: a
// slow page (the full board, run side by side) answered it AFTER the
// bundle was staged, showed Restart now, and the second Check had no
// button to press (v0.10.10's local board).
await page.waitForFunction((n) => (window.__statusAsked ?? 0) > n, asked, { timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(400);
check(
  "with nothing waiting, Check for updates says you're up to date",
  (await row.getByRole("button", { name: /up to date/ }).count()) === 1 && !/is ready/.test(await note()),
  await note(),
);

// Staged behind Settings' back, as the launch-time check does 4s in.
await page.waitForTimeout(4200);
await page.evaluate(() => {
  window.__staged = "0.10.9";
});
await row.getByRole("button", { name: /Check for updates|up to date/ }).click();
await page.waitForTimeout(400);
check(
  "a bundle staged after Settings opened: Check for updates says it's ready",
  /Version 0\.10\.9 is ready\. It applies the next time you open BlammyTV\./.test(await note()),
  await note(),
);
check(
  "and offers Restart now",
  (await row.getByRole("button", { name: "Restart now" }).count()) === 1,
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
