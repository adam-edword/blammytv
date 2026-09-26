// E2E: the Live sidebar shows the Xtream connection pill ("3/3") fed by
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
          // fake-panel is :8081. :8085 is the fake KEYBOX, so this fixture was
          // pointing at the wrong server entirely and the pill simply never got
          // any counters to render.
          server: "http://localhost:8081",
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
// The meter (plan 019, K5): "3 of 3", a dash a stream, all three filled.
const text = count ? (await pill.first().textContent()).trim() : null;
const dashes = count ? await pill.first().locator(".meter__dashes i.is-on").count() : 0;
const full = count
  ? await pill.first().evaluate((el) => el.classList.contains("live-conns--full"))
  : null;
console.log(`meter count=${count} text=${JSON.stringify(text)} dashes=${dashes} full=${full}`);
await page.screenshot({
  path: process.env.SHOT_DIR + "/live-conns.png",
  clip: { x: 0, y: 80, width: 320, height: 400 },
});

const ok = count === 1 && text === "3 of 3" && dashes === 3 && full === true;
console.log(ok ? "PASS: the meter reads 3 of 3, three dashes filled, marked full at the cap" : `FAIL (${dashes} dashes)`);
await browser.close();
process.exit(ok ? 0 : 1);
