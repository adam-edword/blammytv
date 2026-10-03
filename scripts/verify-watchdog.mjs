// Seam-verify the tune watchdog profiles: live = silent goLive reloads at
// 10s cadence then dead; VOD = NO reloads, dead card only after 40s.
//
// It also holds the verdict's other reader (audit LV4): the host's status poll
// slows down once the card is up, so the overlay must tell it, with
// setTuneDead, when the watchdog calls the stream dead and when Retry takes
// that back. A dead stream never presents, so `loading` can't say it.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const stub = (meta) => `
  const off = () => () => {};
  window.__goLiveCalls = 0;
  window.__tuneDead = [];
  window.overlayApi = {
    close: () => {}, setPause: () => {}, setMute: () => {}, setVolume: () => {},
    seek: () => {}, seekAbs: () => {}, setSpeed: () => {},
    expand: () => {}, collapse: () => {}, fullscreen: () => {}, exitFullscreen: () => {},
    setMouseIgnore: () => {},
    goLive: () => { window.__goLiveCalls++; },
    getMeta: async () => (${JSON.stringify(meta)}),
    onMeta: off,
    getLoading: () => true,   // never presents a frame
    onLoading: off,
    setTuneDead: (d) => { window.__tuneDead.push(d); },
    getTracks: () => null, onTracks: off,
    getTime: () => null, onTime: off,
    getChapters: () => [], onChapters: off,
  };
`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function run(meta) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.clock.install();
  await page.addInitScript(stub(meta));
  await page.goto("http://localhost:4173/?overlay=1", { waitUntil: "domcontentloaded" });
  await page.clock.runFor(500); // let the overlay mount + read meta
  const sample = async () => ({
    goLive: await page.evaluate(() => window.__goLiveCalls),
    dead: (await page.locator(".tune--dead, .tune").filter({ hasText: /responding/i }).count()) > 0,
    // The host's last word on it: undefined, true or false.
    told: await page.evaluate(() => window.__tuneDead.at(-1)),
  });
  const out = {};
  await page.clock.runFor(12_000); out.at12 = await sample();
  await page.clock.runFor(13_000); out.at25 = await sample();
  await page.clock.runFor(17_000); out.at42 = await sample();
  // Retry re-arms the watchdog, and the host's poll with it.
  await page.locator(".tune__retry").first().click();
  await page.clock.runFor(500);
  out.afterRetry = await sample();
  await page.close();
  return out;
}

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};

const live = await run({ channelName: "Sky Sports", live: true });
check("live reloads by 12s", live.at12.goLive >= 1, JSON.stringify(live.at12));
check("live 2nd reload by 25s", live.at25.goLive >= 2, JSON.stringify(live.at25));
check("live dead after retries", live.at42.dead, JSON.stringify(live.at42));
check(
  "live: the host isn't told dead while the watchdog is still retrying",
  live.at12.told !== true && live.at25.told !== true,
  JSON.stringify([live.at12.told, live.at25.told]),
);
check("live: it is told when the card comes up", live.at42.told === true, JSON.stringify(live.at42));
check(
  "live: Retry takes it back",
  !live.afterRetry.dead && live.afterRetry.told === false,
  JSON.stringify(live.afterRetry),
);

const vod = await run({ channelName: "One Piece", title: "One Piece", live: false });
check("vod NO reload at 12s", vod.at12.goLive === 0 && !vod.at12.dead, JSON.stringify(vod.at12));
check("vod NO reload at 25s", vod.at25.goLive === 0 && !vod.at25.dead, JSON.stringify(vod.at25));
check("vod dead card ~40s, still no reload", vod.at42.goLive === 0 && vod.at42.dead, JSON.stringify(vod.at42));
check(
  "vod: told dead only with the card",
  vod.at25.told !== true && vod.at42.told === true,
  JSON.stringify([vod.at25.told, vod.at42.told]),
);

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
