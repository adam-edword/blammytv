// E2E: intense theme packs + live-preview-before-buy (v0.6.0).
//
// Covers the widened engine and the preview flow:
//  - the bundled intense cards (terminal/nebula) show with a price/lock chip
//    while unowned;
//  - picking an UNOWNED pack previews it live (colors + bundled font + the
//    .app-shell::before background layer) WITHOUT persisting, and shows the
//    "Unlock to keep" banner;
//  - closing Settings (✕ / backdrop / Escape) reverts the preview;
//  - an OWNED pack (seeded entitlement) COMMITS and survives close, its
//    scoped hover renders, and its font swap resolves;
//  - a free pack leaves the background layer a no-op (opacity 0).
//
// Run: build the app, then from apps/app: `pnpm preview --port 4173`.
// Then from the repo root:
//   PW_FROM=<dir-containing-playwright-core>/x.js node scripts/verify-intense-themes.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const URL = "http://localhost:4173/";

// A dead keybox url so the startup background revalidate fails fast (fetch
// throws -> callValidate null -> state left alone) and never wipes a seeded
// entitlement by reaching the real server with a fake key.
const DEAD_KEYBOX = "http://127.0.0.1:9/";

// An entitlement envelope (storage.ts {v,data}) that owns "terminal".
const ownTerminal = () => JSON.stringify({
  v: 1,
  data: {
    pass: false,
    themes: [{ id: "terminal", name: "Terminal", blurb: "x", supportsLight: false, preview: { bg: "#000", surface: "#111", accent: "#c22727" } }],
    at: 1,
  },
});

const newPage = async (init = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { "btv:onboarded": "1", "blammytv.keyboxUrl": DEAD_KEYBOX, ...init });
  return page;
};

const openTheme = async (page) => {
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  await page.locator("button[aria-label='Settings']").click();
  await page.waitForSelector(".settings", { timeout: 8000 });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.waitForSelector(".customize-rail", { timeout: 8000 });
  await page.locator(".customize-rail").getByRole("button", { name: "Theme", exact: true }).click();
  await page.waitForSelector(".pack-row", { timeout: 8000 });
};

const state = (page) => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const shell = document.querySelector(".app-shell");
  const before = shell ? getComputedStyle(shell, "::before") : null;
  return {
    pack: document.documentElement.dataset.themePack ?? null,
    bg: cs.getPropertyValue("--bg").trim(),
    fontText: cs.getPropertyValue("--font-text").trim(),
    beforeOpacity: before ? parseFloat(before.opacity) : null,
    beforeImage: before ? before.backgroundImage : null,
    storedPack: JSON.parse(localStorage.getItem("blammytv.themePack") ?? "null"),
  };
});

const pickCard = async (page, id) => {
  await page.locator(`.pack-card[data-pack="${id}"]`).click();
  await page.waitForFunction((x) => document.documentElement.dataset.themePack === x, id, { timeout: 5000 }).catch(() => null);
};

// 1: unowned preview — cards, chips, live apply, no persist, unlock banner.
{
  const page = await newPage();
  await openTheme(page);

  const dataPacks = await page.locator(".pack-card").evaluateAll((els) => els.map((el) => el.getAttribute("data-pack")));
  check("intense cards (terminal + nebula) are present in the pack row",
    dataPacks.includes("terminal") && dataPacks.includes("nebula"), JSON.stringify(dataPacks));

  const chip = page.locator('.pack-card[data-pack="terminal"] .pack-card__lock');
  check("unowned terminal card shows a price/lock chip ($2.50)",
    (await chip.count()) === 1 && (await chip.textContent())?.trim() === "$2.50");

  const before = await state(page);
  await pickCard(page, "terminal");
  const preview = await state(page);

  check("picking terminal applies it live (dataset + --bg changed)",
    preview.pack === "terminal" && preview.bg !== "" && preview.bg !== before.bg,
    `before=${before.bg} after=${preview.bg}`);
  check("terminal swaps the bundled font (--font-text -> VT323)",
    /VT323/i.test(preview.fontText), preview.fontText);
  check("the .app-shell::before background layer paints (opacity>0, image set)",
    preview.beforeOpacity > 0 && preview.beforeImage && preview.beforeImage !== "none",
    `opacity=${preview.beforeOpacity} image=${(preview.beforeImage || "").slice(0, 40)}`);
  check("an UNOWNED preview does NOT persist (blammytv.themePack unchanged)",
    JSON.stringify(preview.storedPack) === JSON.stringify(before.storedPack),
    JSON.stringify(preview.storedPack));

  const note = page.locator(".pack-preview-note");
  const noteText = (await note.textContent().catch(() => "")) ?? "";
  const buy = page.locator(".pack-preview-note__buy");
  check("the Unlock-to-keep banner shows for the previewed pack",
    (await note.count()) === 1 && /Previewing/.test(noteText) && /Terminal/.test(noteText));
  check("the banner's buy CTA carries the price + an href",
    /\$2\.50/.test((await buy.textContent().catch(() => "")) ?? "") &&
    !!(await buy.getAttribute("href")));

  await page.close();
}

// 2: revert on close — ✕, backdrop, and Escape all snap back to committed.
for (const method of ["close-button", "backdrop", "escape"]) {
  const page = await newPage();
  await openTheme(page);
  const before = await state(page);
  await pickCard(page, "terminal");
  const previewed = await page.evaluate(() => document.documentElement.dataset.themePack);
  if (method === "close-button") await page.locator(".settings__close").click();
  else if (method === "backdrop") await page.locator(".modal-backdrop").click({ position: { x: 8, y: 8 } });
  else await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.documentElement.dataset.themePack, null, { timeout: 5000 }).catch(() => null);
  const after = await state(page);
  check(`preview reverts on close via ${method} (pack + --bg restored)`,
    previewed === "terminal" && after.pack === null && after.bg === before.bg,
    `after.pack=${after.pack} bg=${after.bg}`);
  await page.close();
}

// 3: owned pack commits, survives close, hover + font resolve.
{
  const page = await newPage({ "blammytv.license.key": JSON.stringify({ v: 1, data: "BTV-AAAA-BBBB-CCCC-DDDD" }), "blammytv.license.entitlement": ownTerminal() });
  await openTheme(page);

  const chipCount = await page.locator('.pack-card[data-pack="terminal"] .pack-card__lock').count();
  check("owned terminal card shows NO price/lock chip", chipCount === 0);

  await pickCard(page, "terminal");
  const committed = await state(page);
  check("owning terminal COMMITS it (blammytv.themePack = {v:1,data:terminal})",
    JSON.stringify(committed.storedPack) === JSON.stringify({ v: 1, data: "terminal" }),
    JSON.stringify(committed.storedPack));
  const noteCount = await page.locator(".pack-preview-note").count();
  check("no Unlock banner for an owned pack", noteCount === 0);

  // Close Settings — an owned commit must persist (no revert).
  await page.keyboard.press("Escape");
  await page.waitForSelector(".settings", { state: "detached", timeout: 5000 }).catch(() => null);
  const afterClose = await page.evaluate(() => document.documentElement.dataset.themePack ?? null);
  check("owned terminal survives Settings close (no revert)", afterClose === "terminal", String(afterClose));

  // Font swap resolves on real content.
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check("body font resolves to the bundled VT323 face", /VT323/i.test(bodyFont), bodyFont);

  // Scoped hover renders (terminal gives .guide__cell an inset phosphor ring).
  const cell = page.locator(".guide__cell").first();
  if (await cell.count()) {
    await cell.hover();
    await page.waitForTimeout(220); // let the 140ms box-shadow transition settle
    const shadow = await cell.evaluate((el) => getComputedStyle(el).boxShadow);
    // The terminal rule is inset 1px rgba(80,255,130,.55) — assert the green
    // ring actually resolved, not just any non-"none" value.
    check("terminal's scoped .guide__cell:hover paints the phosphor ring",
      /inset/.test(shadow) && /(80|130)/.test(shadow) && /1px/.test(shadow), shadow);
  } else {
    check("guide cell present to test hover", false, "no .guide__cell found");
  }

  await page.close();
}

// 4: free pack keeps the background layer a no-op.
{
  const page = await newPage();
  await openTheme(page);
  await pickCard(page, "void");
  const s = await state(page);
  check("a free pack (void) leaves .app-shell::before a no-op (opacity 0)",
    s.pack === "void" && s.beforeOpacity === 0, `opacity=${s.beforeOpacity}`);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
