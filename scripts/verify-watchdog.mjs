// Seam-verify the tune watchdog profiles: live = silent goLive reloads at
// 10s cadence then dead; VOD = NO reloads, dead card only after 40s.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const stub = (meta) => `
  const off = () => () => {};
  window.__goLiveCalls = 0;
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
  });
  const out = {};
  await page.clock.runFor(12_000); out.at12 = await sample();
  await page.clock.runFor(13_000); out.at25 = await sample();
  await page.clock.runFor(17_000); out.at42 = await sample();
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

const vod = await run({ channelName: "One Piece", title: "One Piece", live: false });
check("vod NO reload at 12s", vod.at12.goLive === 0 && !vod.at12.dead, JSON.stringify(vod.at12));
check("vod NO reload at 25s", vod.at25.goLive === 0 && !vod.at25.dead, JSON.stringify(vod.at25));
check("vod dead card ~40s, still no reload", vod.at42.goLive === 0 && vod.at42.dead, JSON.stringify(vod.at42));

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
