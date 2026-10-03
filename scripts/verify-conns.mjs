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
// Wait for a channel fake-panel serves ("Fake Sports HD" is fake-stalker's, so
// this used to sit out the whole 30s on every run and move on). A page that
// never lists one has failed, so say so instead of reading a pill that was
// never going to be there.
const listed = await page
  .waitForFunction(() => document.body.innerText.includes("Fake ESPN 4K"), null, {
    timeout: 30_000,
  })
  .then(
    () => true,
    () => false,
  );
if (!listed) {
  console.log("FAIL: the Live page never listed Fake ESPN 4K, the first channel fake-panel serves");
  await browser.close();
  process.exit(1);
}

const pill = page.locator(".live-conns");
// The count rides its own poll, not the catalog's request, so give it a beat
// after the channels show. If it never comes, the check below fails on it.
await pill.first().waitFor({ timeout: 10_000 }).catch(() => {});
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
