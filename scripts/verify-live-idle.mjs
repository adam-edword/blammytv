// E2E: the Live screen's player-chrome host exists only while a feed plays
// (v0.9.93, audit F9).
//
// LiveScreen appended `#inv-chrome` to the body on MOUNT, and two things
// read its presence as "something is playing": the header's `/` search
// shortcut, which did nothing on the Guide, and Settings' "Restart now",
// which sat disabled with "Finish watching first". It only happens in the
// shell (INV is isTauri()), so this drives the real app under the IPC stub
// verify-sports-theater uses, with http_get answered by the page's fetch
// so the fake panel really loads.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-live-idle.mjs
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
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
    // What getCurrentWindow() reads (the fullscreen toggle asks for it).
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    invoke: (cmd, args) => {
      window.__tauriCalls.push(cmd);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      return Promise.resolve(undefined);
    },
  };
  // What @tauri-apps/api's unlisten reaches for; absent, an unmount throws.
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
const host = () => page.evaluate(() => !!document.getElementById("inv-chrome"));

check("on the Guide with nothing playing, there is no chrome host", !(await host()));

await page.mouse.click(4, 450); // off any control, so the key is the page's
await page.keyboard.press("/");
await page.waitForTimeout(800);
check(
  "and `/` opens search, as it does everywhere else",
  await page.evaluate(
    () => document.activeElement?.classList.contains("navcap__searchinput") ?? false,
  ),
);

// Back to the Guide and tune: the host comes with the feed...
await page.locator('[data-dest="guide"]').click();
await page.locator(".guide__channel").first().waitFor({ timeout: 15_000 });
await page.locator(".guide__channel button").first().click();
await page.waitForTimeout(800);
check("tuning a channel brings the host in", await host());

// ...and goes with it.
await page.locator(".mini-overlay").hover();
await page.getByRole("button", { name: "Stop", exact: true }).click();
await page.waitForTimeout(600);
check("stopping takes it away again", !(await host()));

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
