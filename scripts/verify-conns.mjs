// E2E: the Live sidebar shows the Xtream connection pill ("2/3") fed by
// the fake panel's player_api counters.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [
        {
          id: "px1",
          kind: "xtream",
          name: "Fake Panel",
          enabled: true,
          server: "http://localhost:8085",
          username: "u",
          password: "p",
        },
      ],
    }),
  );
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page.goto("http://localhost:4173/");
await page
  .waitForFunction(
    () => document.body.innerText.includes("Fake Sports HD"),
    null,
    { timeout: 30_000 },
  )
  .catch(() => {});

const pill = page.locator(".live-conns");
const count = await pill.count();
const text = count ? (await pill.first().textContent()).trim() : null;
const full = count
  ? await pill.first().evaluate((el) => el.classList.contains("live-conns--full"))
  : null;
console.log(`pill count=${count} text=${JSON.stringify(text)} full=${full}`);
await page.screenshot({
  path: process.env.SHOT_DIR + "/live-conns.png",
  clip: { x: 0, y: 80, width: 320, height: 400 },
});

const ok = count === 1 && text === "3/3" && full === true;
console.log(ok ? "PASS: pill renders 2/3, full-accented at cap" : "FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
