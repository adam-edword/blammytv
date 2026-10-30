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

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const SERVER = process.env.M3U ?? "http://localhost:8082";
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
      url: `${SERVER}/playlist.m3u`,
    },
  ],
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
/** A context that reaches only localhost: the fake and the app are all this
 * talks to, so no external host is left to the live service. */
async function offline() {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  return c;
}
const ctx = await offline();
const page = await ctx.newPage();
await page.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
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
  const c = await offline();
  const p = await c.newPage();
  await p.addInitScript((pl) => {
    localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  }, { v: 1, data: [{ ...PLAYLIST.data[0], url: `${SERVER}${path}` }] });
  await p.goto(URL);
  const shown = await p
    .waitForFunction(() => document.body.innerText.includes("ESPN Hour"), null, { timeout: 20_000 })
    .then(() => true, () => false);
  check(label, shown);
  await c.close();
}

// A link that serves something that is not a playlist (a share link, a block
// page, a lapsed account's notice: a web page, with a 200). It used to load as
// a playlist with no channels and no error: "No Channels Here Yet" for an only
// playlist, and with others its channels vanished while Settings said
// "Channels OK". Now it is the playlist's error, and a playlist that loaded
// before keeps its channels.
const m3u = (id, name, path) => ({ kind: "m3u", id, name, enabled: true, url: `${SERVER}${path}` });
async function openWith(playlists) {
  const c = await offline();
  const p = await c.newPage();
  p.logs = [];
  p.on("console", (m) => p.logs.push(m.text()));
  await p.addInitScript((pl) => {
    localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  }, { v: 1, data: playlists });
  await p.goto(URL);
  return p;
}
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
const shown = (p, text) => p.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 20_000 }).then(() => true, () => false);
/** The status line Settings → Sources puts under one playlist. */
const statusOf = async (p, name) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click();
  const row = p.locator(".playlist-item", { has: p.locator(".playlist-row__name", { hasText: new RegExp(`^${name}$`) }) });
  await row.waitFor({ timeout: 15_000 });
  return row;
};
await fetch(`${SERVER}/__flaky?html=0`);

{
  // The only playlist is a web page.
  const p = await openWith([m3u("m1", "Page M3U", "/page.m3u")]);
  const said = await shown(p, "Couldn\u2019t Load Your Playlists");
  const text = await p.evaluate(() => document.body.innerText);
  check("an only playlist that is a web page says so, and not that no playlist is added", said && text.includes("the link didn\u2019t return a playlist") && !text.includes("No Channels Here Yet"), text.slice(0, 200));
  // Settings has no row to put it on: a load where every playlist failed is not
  // kept (the next mount tries again), and Settings reads the kept catalog. The
  // Guide's card is where an only playlist says it, as it does for a refused login.
  await p.context().close();
}
{
  // A real playlist with nothing in it yet is not an error.
  const p = await openWith([m3u("m1", "Empty M3U", "/empty.m3u")]);
  const said = await shown(p, "No Channels Here Yet");
  const text = await p.evaluate(() => document.body.innerText);
  check("a real playlist with no channel in it yet is not an error", said && !text.includes("Couldn\u2019t Load"), text.slice(0, 200));
  const row = await statusOf(p, "Empty M3U");
  check("  and Settings shows no error for it", (await row.locator(".playlist-row__status--error").count()) === 0);
  await p.context().close();
}
{
  // Loaded once, then the link serves a page. Two playlists, so a total
  // failure does not hide the other half of the story (an uncached catalog).
  const p = await openWith([m3u("m1", "Flaky M3U", "/flaky.m3u"), m3u("m2", "Empty M3U", "/empty.m3u")]);
  const loaded = await shown(p, "Fake Weather Now");
  // The catalog is on disk once the guide has landed and the write has run.
  const onDisk = () =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("blammytv", 1);
          open.onerror = () => resolve(false);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("liveCache")) return resolve(false), db.close();
            const rq = db.transaction("liveCache").objectStore("liveCache").get("live");
            rq.onsuccess = () => {
              resolve(!!rq.result);
              db.close();
            };
            rq.onerror = () => resolve(false);
          };
        }),
    );
  const written = await waitFor(onDisk, 20_000);
  check("(control) the playlist loaded, and its catalog is on disk", loaded && written, `${loaded} ${written}`);
  await fetch(`${SERVER}/__flaky?html=1`);
  p.logs.length = 0;
  await p.reload({ waitUntil: "domcontentloaded" });
  const failed = await waitFor(async () => p.logs.some((l) => /Flaky M3U.*failed, keeping its \d+ channels/.test(l)), 20_000);
  check("(control) the relaunch read the page and failed that playlist", failed, JSON.stringify(p.logs.filter((l) => l.includes("[live]")).slice(0, 4)));
  const text = await p.evaluate(() => document.body.innerText);
  check("its channels are still there", text.includes("Fake ESPN 4K") && text.includes("Fake Weather Now") && text.includes("Mystery Stream"), text.slice(0, 200));
  const row = await statusOf(p, "Flaky M3U");
  const line = await row.locator(".playlist-row__status--error").innerText().catch(() => "");
  check("  and Settings \u2192 Sources says why it failed, next to that playlist", line === "Couldn\u2019t load: the link didn\u2019t return a playlist", JSON.stringify(line));
  await fetch(`${SERVER}/__flaky?html=0`);
  await p.context().close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
