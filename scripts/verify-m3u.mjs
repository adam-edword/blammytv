// Headless verify: the M3U source path end-to-end against the fake M3U
// provider (scripts/fake-m3u.mjs). The browser build's httpGetText uses
// plain fetch, and the fake panel serves CORS-open, so seeding an M3U
// playlist in localStorage exercises the real parse → group → channel
// pipeline through loadLive.
//
// Run:
//   node scripts/fake-m3u.mjs                 # :8082
//   pnpm --filter @blammytv/app build
//   pnpm --filter @blammytv/app preview       # :4173
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-m3u.mjs

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
      kind: "m3u",
      id: "m1",
      name: "Test M3U",
      enabled: true,
      url: "http://localhost:8082/playlist.m3u",
    },
  ],
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
}, PLAYLIST);
await page.goto(URL);
// Wait for the M3U channels to render (the last innocent one).
await page
  .waitForFunction(
    () => document.body.innerText.includes("Fake Weather Now"),
    null,
    { timeout: 30_000 },
  )
  .catch(() => {});
const text = await page.evaluate(() => document.body.innerText);

check(
  "M3U channels render (Sports + News groups)",
  text.includes("Fake ESPN 4K") &&
    text.includes("Fake Sky Sports FHD") &&
    text.includes("Fake News Channel") &&
    text.includes("Fake Weather Now"),
);
check(
  "the bare (Ungrouped) entry renders",
  text.includes("Mystery Stream"),
);
check(
  "the adult group is dropped by default",
  !text.includes("Late Night Feature"),
);

// The guide, from the playlist's url-tvg: plainly, and as a .xml.gz file
// (the body is the gzip itself, no Content-Encoding). The second was read
// as text and matched nothing. Landed on the Guide, whose lanes show the
// programmes by title.
for (const [label, path] of [
  ["the guide from url-tvg renders", "/playlist.m3u"],
  ["  and one served as a .xml.gz file renders too", "/playlist-gz.m3u"],
]) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  await p.addInitScript((pl) => {
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  }, { v: 1, data: [{ ...PLAYLIST.data[0], url: `http://localhost:8082${path}` }] });
  await p.goto(URL);
  const shown = await p
    .waitForFunction(() => document.body.innerText.includes("ESPN Hour"), null, { timeout: 20_000 })
    .then(() => true, () => false);
  check(label, shown);
  await c.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
