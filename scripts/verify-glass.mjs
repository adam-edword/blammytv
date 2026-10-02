// E2E: the glass, in two tiers (plan 022, call 1, B).
//
// Thin glass on the small floats (Ctrl+K and multi-view's picker, menus,
// popovers, tooltips), thick, nearly solid glass on the Settings sheet, and
// a lighter dim behind a dialog. What can go wrong is quiet: a float whose
// component lost its classes goes back to opaque, text over a bright picture
// through glass can drop below AA, and the two ways glass must go solid
// (prefers-reduced-transparency, and mpv's video under the page, which no
// backdrop-filter reaches) leave nothing on screen to say they failed.
//
// Contrast is read off pixels: the float's contents are hidden, the glass is
// screenshotted with what is behind it, and every pixel inside its edge is
// measured against the text colour. The worst 1% has to clear 4.5.
//
//   node scripts/fake-panel.mjs; node scripts/fake-aio.mjs   # :8081, :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-glass.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({ v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] }),
  );
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
});

/** Background alpha and backdrop-filter of the first match. */
const material = (sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const a = /\/\s*([\d.]+)\s*\)$/.exec(cs.backgroundColor);
    return { alpha: a ? Number(a[1]) : 1, blur: cs.backdropFilter, bg: cs.backgroundColor };
  }, sel);

/** The worst contrast (1st percentile) of the element's text colour against
 * every pixel of its ground: its contents hidden, 10px in from its edge. */
async function contrast(sel) {
  const text = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).color, sel);
  // Everything inside hidden, not just the text: a swatch, a badge or a
  // logo is not the ground the words sit on, the glass is.
  await page.addStyleTag({ content: `${sel} * { visibility: hidden !important; }` }).then((h) => h.evaluate((n) => n.setAttribute("data-probe", "")));
  const png = await page.locator(sel).first().screenshot();
  await page.evaluate(() => document.querySelector("style[data-probe]")?.remove());
  return page.evaluate(
    async ({ b64, text }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      // The text colour, resolved to sRGB by the canvas itself.
      g.fillStyle = text;
      g.fillRect(0, 0, 1, 1);
      const [tr, tg, tb] = g.getImageData(0, 0, 1, 1).data;
      g.drawImage(img, 0, 0);
      const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      const lt = lum(tr, tg, tb);
      const edge = 10;
      const d = g.getImageData(edge, edge, img.width - 2 * edge, img.height - 2 * edge).data;
      const ratios = [];
      for (let i = 0; i < d.length; i += 16) {
        const l = lum(d[i], d[i + 1], d[i + 2]);
        ratios.push((Math.max(l, lt) + 0.05) / (Math.min(l, lt) + 0.05));
      }
      ratios.sort((x, y) => x - y);
      return Math.round(ratios[Math.floor(ratios.length * 0.01)] * 100) / 100;
    },
    { b64: png.toString("base64"), text },
  );
}

const openPalette = async () => {
  await page.keyboard.press("Control+k");
  await page.locator(".mvpick").waitFor({ timeout: 10_000 });
  await page.keyboard.type("fake");
  await page.waitForTimeout(300);
};
const closeAll = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
};
const openSettings = async () => {
  await page.locator("button[aria-label='Settings']").click();
  await page.locator(".settings").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
};
const setTheme = (t) =>
  page.evaluate((t) => {
    if (t === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  }, t);

// Stream first: the hero's art behind the floats is the bright case. (Init
// scripts run on every load, so only when nothing has chosen a tab yet.)
await page.addInitScript(() => {
  if (!localStorage.getItem("blammytv.startupTab"))
    localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
});
await page.goto(URL);
await page.locator(".shero__card--active .shero__art[data-loaded]").waitFor({ timeout: 30_000 });
await page.mouse.move(2, 890);

const rows = [];
for (const theme of ["dark", "light"]) {
  await setTheme(theme);
  await openPalette();
  const thin = await material(".mvpick");
  const thinC = await contrast(".mvpick");
  const dim = await material('[data-slot="dialog-overlay"]');
  await closeAll();
  await openSettings();
  const thick = await material(".settings");
  const thickC = await contrast(".settings");
  await closeAll();
  rows.push({ theme, thin, thinC, thick, thickC, dim });
}
for (const r of rows) {
  check(
    `${r.theme}: Ctrl+K is the thin glass (72%, blur 30, saturate 1.6)`,
    r.thin?.alpha === 0.72 && r.thin?.blur === "blur(30px) saturate(1.6)",
    JSON.stringify(r.thin),
  );
  check(
    `${r.theme}: Settings is the thick glass (90%, blur 40, saturate 1.4)`,
    r.thick?.alpha === 0.9 && r.thick?.blur === "blur(40px) saturate(1.4)",
    JSON.stringify(r.thick),
  );
  check(`${r.theme}: text over the hero through each tier clears 4.5:1`, r.thinC >= 4.5 && r.thickC >= 4.5, `thin ${r.thinC}, thick ${r.thickC}`);
}
check("the dim behind a dialog is 30% black", rows[0].dim?.bg === "rgba(0, 0, 0, 0.3)", rows[0].dim?.bg);

// A tooltip is its own component (the kit's Hint): the same thin tier.
await setTheme("dark");
await page.locator("button[aria-label='Settings']").hover();
await page.locator('[data-slot="tooltip-content"]').first().waitFor({ timeout: 5_000 }).catch(() => {});
const tip = await material('[data-slot="tooltip-content"]');
check("a tooltip is the thin glass too", tip?.alpha === 0.72 && tip?.blur === "blur(30px) saturate(1.6)", JSON.stringify(tip));
await page.mouse.move(2, 890);

// The plain page: the Guide, no picture behind the palette.
await page.evaluate(() => localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" })));
await page.goto(URL);
await page.waitForFunction(() => document.body.innerText.includes("ESPN Hour"), null, { timeout: 30_000 });
const plain = {};
for (const theme of ["dark", "light"]) {
  await setTheme(theme);
  await openPalette();
  plain[theme] = await contrast(".mvpick");
  await closeAll();
}
check("over the plain page, Ctrl+K's text clears 4.5:1 in both themes", plain.dark >= 4.5 && plain.light >= 4.5, JSON.stringify(plain));

// mpv's video under the page: the thin tier goes solid (no backdrop-filter
// reaches below the page); Settings keeps its glass, for mpv's own frost.
await setTheme("dark");
await page.evaluate(() => {
  document.querySelector(".app-shell").style.clipPath = "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
});
await openPalette();
const overVideo = await material(".mvpick");
await closeAll();
await openSettings();
const sheetOverVideo = await material(".settings");
await closeAll();
await page.evaluate(() => {
  document.querySelector(".app-shell").style.clipPath = "";
});
check(
  "over mpv's video the thin tier is solid, Settings keeps its glass",
  overVideo?.alpha === 1 && overVideo?.blur === "none" && sheetOverVideo?.alpha === 0.9,
  JSON.stringify({ overVideo, sheetOverVideo }),
);

// Windows' Transparency effects off: every tier solid.
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
await openPalette();
const reducedThin = await material(".mvpick");
await closeAll();
await openSettings();
const reducedThick = await material(".settings");
await closeAll();
await cdp.send("Emulation.setEmulatedMedia", { features: [] });
check(
  "with reduced transparency every tier is solid",
  reducedThin?.alpha === 1 && reducedThin?.blur === "none" && reducedThick?.alpha === 1 && reducedThick?.blur === "none",
  JSON.stringify({ reducedThin, reducedThick }),
);

await browser.close();
process.exit(fail ? 1 : 0);
