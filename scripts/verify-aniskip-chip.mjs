// Seam-verify Skip Intro Phase 2: meta.skips → skip chip precedence.
// Drives the ?overlay=1 harness with a stubbed window.overlayApi.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const stub = (meta, time, chapters) => `
  const off = () => () => {};
  window.overlayApi = {
    close: () => {},
    setPause: () => {},
    setMute: () => {},
    setVolume: () => {},
    seek: () => {},
    seekAbs: () => {},
    setSpeed: () => {},
    expand: () => {}, collapse: () => {},
    fullscreen: () => {}, exitFullscreen: () => {},
    setMouseIgnore: () => {},
    getMeta: async () => (${JSON.stringify(meta)}),
    onMeta: off,
    getLoading: () => false,
    onLoading: off,
    getTracks: () => null,
    onTracks: off,
    getTime: () => (${JSON.stringify(time)}),
    onTime: off,
    getChapters: () => (${JSON.stringify(chapters)}),
    onChapters: off,
  };
`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

async function chipText(meta, time, chapters = []) {
  await page.addInitScript(stub(meta, time, chapters));
  await page.goto("http://localhost:4173/?overlay=1", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(400);
  const chip = page.locator(".skip-chip");
  return (await chip.count()) ? (await chip.textContent()).trim() : null;
}

const vodMeta = { channelName: "One Piece", title: "One Piece", live: false };
const skips = [
  { type: "op", start: 10, end: 95 },
  { type: "ed", start: 1320, end: 1410 },
];
const t = (pos) => ({ pos, dur: 1415 });

let fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// 1. Inside the op window → Skip Intro.
check("op window", await chipText({ ...vodMeta, skips }, t(30)), "Skip Intro");
// 2. Inside the ed window → Skip Credits.
check("ed window", await chipText({ ...vodMeta, skips }, t(1350)), "Skip Credits");
// 3. Between windows → no chip.
check("gap", await chipText({ ...vodMeta, skips }, t(600)), null);
// 4. Precedence: a mislabeled chapter under the op window must NOT win —
//    remote label comes from the aniskip type, and jump target from its end.
check(
  "precedence over chapters",
  await chipText({ ...vodMeta, skips }, t(30), [
    { title: "Preview", start: 0 },
    { title: "Part A", start: 200 },
  ]),
  "Skip Intro", // chapter path would have said "Skip Preview"
);
// 5. Chapters still work when no skips are present (Phase 1 fallback).
check(
  "chapter fallback",
  await chipText(vodMeta, t(30), [
    { title: "Opening", start: 5 },
    { title: "Part A", start: 95 },
  ]),
  "Skip Intro",
);
// 6. recap + mixed-ed labels.
check(
  "recap label",
  await chipText(
    { ...vodMeta, skips: [{ type: "recap", start: 0, end: 60 }] },
    t(20),
  ),
  "Skip Recap",
);
check(
  "mixed-ed label",
  await chipText(
    { ...vodMeta, skips: [{ type: "mixed-ed", start: 1300, end: 1400 }] },
    t(1350),
  ),
  "Skip Credits",
);
// 7. Half-file guard: an absurd 20-minute "op" is ignored.
check(
  "half-file guard",
  await chipText(
    { ...vodMeta, skips: [{ type: "op", start: 0, end: 1200 }] },
    t(30),
  ),
  null,
);
// 8. Live streams never show remote skips.
check(
  "live ignores skips",
  await chipText({ channelName: "Sky", live: true, skips }, t(30)),
  null,
);

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
