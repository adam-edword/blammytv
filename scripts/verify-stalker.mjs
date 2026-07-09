// Headless verify: the Stalker source path end-to-end against the fake
// portal (scripts/fake-stalker.mjs). Browser mode can't send Cookie (a
// forbidden fetch header), so run the fixture with LAX=1 — the Bearer-token
// flow (handshake → authorized itv calls) is still enforced end-to-end;
// full MAG header assembly is covered by src/data/stalker.test.ts, whose
// mock captures headers. Seeding a Stalker playlist in localStorage
// exercises the real probe → handshake → genres → channels → EPG pipeline
// through loadLive.
//
// Run:
//   LAX=1 node scripts/fake-stalker.mjs           # :8083
//   pnpm --filter @blammytv/app build
//   pnpm --filter @blammytv/app preview           # :4173
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-stalker.mjs

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const PLAYLIST = {
  v: 1,
  data: [
    {
      kind: "stalker",
      id: "s1",
      name: "Test Portal",
      enabled: true,
      portal: "http://localhost:8083",
      mac: "00:1A:79:AA:BB:CC",
    },
  ],
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript((pl) => {
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
}, PLAYLIST);
await page.goto(URL);
// Wait for the portal's channels to land (the probe tries load.php first,
// so this also proves endpoint discovery).
await page
  .waitForFunction(
    () => document.body.innerText.includes("Fake Sports HD"),
    null,
    { timeout: 30_000 },
  )
  .catch(() => {});
const text = await page.evaluate(() => document.body.innerText);

check(
  "Stalker channels render (News + Sports genres)",
  text.includes("Fake News One") &&
    text.includes("Fake News Two") &&
    text.includes("Fake Weather Now") &&
    text.includes("Fake Sports HD"),
);
check(
  "the adult genre is dropped by default",
  !text.includes("Late Night Feature") && !text.includes("XXX Adult"),
);
check(
  "the censored channel in an innocent genre is dropped",
  !text.includes("Sneaky Flagged Stream"),
);
check(
  "EPG listings from get_epg_info render",
  // The fixture generates programme titles per channel; the airing one
  // shows in the hero/guide.
  /Programme|Now on|Fake .* (Show|Hour|News)/i.test(text) ||
    (await page.evaluate(
      () => document.querySelectorAll("[class*=guide], [class*=cell]").length,
    )) > 0,
);

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
