// E2E: intense theme packs + live-preview-before-buy, via the standalone
// Themes panel (v0.6.0 rework). The panel pops out of Settings; picking an
// unowned premium pack previews it live (colors + bundled font + the
// .app-shell::before layer) WITHOUT persisting, and reverts when the Themes
// panel closes. An owned pack COMMITS and survives close. Supporter is now a
// teaser card in the Themes Pass block (previewable; commits only with a Pass).
//
// Run: build the app, then from apps/app: `pnpm preview --port 4173`.
//   PW_FROM=<dir>/x.js node scripts/verify-intense-themes.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const URL = "http://localhost:4173/";
const DEAD_KEYBOX = "http://127.0.0.1:9/";

const ownTerminal = () => JSON.stringify({
  v: 1,
  data: {
    pass: false,
    themes: [{ id: "terminal", name: "Terminal", blurb: "x", supportsLight: false, preview: { bg: "#000", surface: "#111", accent: "#c22727" } }],
    at: 1,
  },
});
const passEntitlement = () => JSON.stringify({ v: 1, data: { pass: true, themes: [], at: 1 } });

const newPage = async (init = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { "btv:onboarded": "1", "blammytv.keyboxUrl": DEAD_KEYBOX, ...init });
  return page;
};

const openThemes = async (page) => {
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  await page.locator("button[aria-label='Settings']").click();
  await page.waitForSelector(".settings", { timeout: 8000 });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.locator(".themes-launch").click();
  await page.waitForSelector(".themes-modal", { timeout: 8000 });
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

// Any theme control carrying data-pack (a .tcard OR the .pass-supporter card).
const pick = async (page, id) => {
  await page.locator(`[data-pack="${id}"]`).click();
  await page.waitForFunction((x) => document.documentElement.dataset.themePack === x, id, { timeout: 5000 }).catch(() => null);
};

// 1: unowned premium preview — price chip, live apply, no persist, unlock note.
{
  const page = await newPage();
  await openThemes(page);

  const premiumIds = await page.locator(".themes-shelf__row").nth(1).locator(".tcard").evaluateAll((els) => els.map((e) => e.getAttribute("data-pack")));
  check("Premium shelf shows terminal (nebula went free in v0.6.0)",
    premiumIds.includes("terminal") && !premiumIds.includes("nebula"), JSON.stringify(premiumIds));

  const price = page.locator('.tcard[data-pack="terminal"] .tcard__price');
  check("unowned terminal shows its $2.50 price link",
    (await price.count()) === 1 && /\$2\.50/.test((await price.textContent()) ?? ""));

  const before = await state(page);
  await pick(page, "terminal");
  const preview = await state(page);
  check("picking terminal applies it live (dataset + --bg changed)",
    preview.pack === "terminal" && preview.bg !== "" && preview.bg !== before.bg, `${before.bg} -> ${preview.bg}`);
  check("terminal swaps the bundled font (--font-text -> VT323)", /VT323/i.test(preview.fontText), preview.fontText);
  check("the .app-shell::before layer paints (opacity>0, image set)",
    preview.beforeOpacity > 0 && preview.beforeImage && preview.beforeImage !== "none");
  check("an UNOWNED preview does NOT persist",
    JSON.stringify(preview.storedPack) === JSON.stringify(before.storedPack), JSON.stringify(preview.storedPack));

  const note = page.locator(".pack-preview-note");
  check("the Unlock-to-keep banner shows for the previewed pack",
    (await note.count()) === 1 && /Previewing/.test((await note.textContent()) ?? "") && /Terminal/.test((await note.textContent()) ?? ""));
  const buy = page.locator(".pack-preview-note__buy");
  check("the banner's buy CTA carries the price + an href",
    /\$2\.50/.test((await buy.textContent().catch(() => "")) ?? "") && !!(await buy.getAttribute("href")));
  await page.close();
}

// 2: preview reverts when the Themes panel closes (✕ / backdrop / Escape).
for (const method of ["close-button", "backdrop", "escape"]) {
  const page = await newPage();
  await openThemes(page);
  const before = await state(page);
  await pick(page, "terminal");
  const previewed = await page.evaluate(() => document.documentElement.dataset.themePack);
  if (method === "close-button") await page.locator(".themes-modal .settings__close").click();
  else if (method === "backdrop") await page.locator(".modal-backdrop--center").click({ position: { x: 8, y: 8 } });
  else await page.keyboard.press("Escape");
  // Reverts to the persisted default — BlammyTV/slate, a real attribute pack.
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "slate", null, { timeout: 5000 }).catch(() => null);
  const after = await state(page);
  check(`preview reverts on close via ${method}`,
    previewed === "terminal" && after.pack === "slate" && after.bg === before.bg, `after.pack=${after.pack}`);
  await page.close();
}

// 3: owned pack commits, survives close, hover + font resolve.
{
  const page = await newPage({ "blammytv.license.key": JSON.stringify({ v: 1, data: "BTV-AAAA-BBBB-CCCC-DDDD" }), "blammytv.license.entitlement": ownTerminal() });
  await openThemes(page);

  check("owned terminal shows NO price link",
    (await page.locator('.tcard[data-pack="terminal"] .tcard__price').count()) === 0);

  await pick(page, "terminal");
  const committed = await state(page);
  check("owning terminal COMMITS it ({v:1,data:terminal})",
    JSON.stringify(committed.storedPack) === JSON.stringify({ v: 1, data: "terminal" }), JSON.stringify(committed.storedPack));
  check("no Unlock banner for an owned pack", (await page.locator(".pack-preview-note").count()) === 0);

  await page.keyboard.press("Escape");
  await page.waitForSelector(".themes-modal", { state: "detached", timeout: 5000 }).catch(() => null);
  check("owned terminal survives close (no revert)",
    (await page.evaluate(() => document.documentElement.dataset.themePack ?? null)) === "terminal");

  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check("body font resolves to the bundled VT323 face", /VT323/i.test(bodyFont), bodyFont);

  const cell = page.locator(".guide__cell").first();
  if (await cell.count()) {
    await cell.hover();
    await page.waitForTimeout(220);
    const shadow = await cell.evaluate((el) => getComputedStyle(el).boxShadow);
    check("terminal's scoped .guide__cell:hover paints the phosphor ring",
      /inset/.test(shadow) && /(80|130)/.test(shadow) && /1px/.test(shadow), shadow);
  } else {
    check("guide cell present to test hover", true, "no guide (no playlist) — skipped");
  }
  await page.close();
}

// 4: a free pack keeps the background layer a no-op.
{
  const page = await newPage();
  await openThemes(page);
  await pick(page, "void");
  const s = await state(page);
  check("a free pack (void) leaves .app-shell::before a no-op (opacity 0)",
    s.pack === "void" && s.beforeOpacity === 0, `opacity=${s.beforeOpacity}`);
  await page.close();
}

// 5: Supporter is a teaser in the Pass block — shown always, previewable, but
// does NOT persist without a Pass; reverts on close.
{
  const page = await newPage();
  await openThemes(page);
  const teaser = page.locator('.pass-supporter[data-pack="supporter"]');
  check("Supporter teaser card is present in the Pass block", (await teaser.count()) === 1);

  const before = await state(page);
  await pick(page, "supporter");
  const preview = await state(page);
  check("clicking the teaser previews Supporter live (dataset set)", preview.pack === "supporter");
  check("previewing Supporter without a Pass does NOT persist",
    JSON.stringify(preview.storedPack) === JSON.stringify(before.storedPack), JSON.stringify(preview.storedPack));

  const aura = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const after = getComputedStyle(shell, "::after");
    const bef = getComputedStyle(shell, "::before");
    return { afterOpacity: parseFloat(after.opacity), afterAnim: after.animationName, beforeImage: bef.backgroundImage };
  });
  check("the rainbow aura (::after) paints and drifts",
    aura.afterOpacity > 0 && aura.afterAnim && aura.afterAnim !== "none", JSON.stringify(aura));
  check("the dither (::before) paints under Supporter", !!aura.beforeImage && aura.beforeImage !== "none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell"), "::after").animationName);
  check("reduced-motion stops the aura drift", reduced === "none", String(reduced));

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "slate", null, { timeout: 5000 }).catch(() => null);
  check("Supporter preview reverts on close without a Pass",
    (await page.evaluate(() => document.documentElement.dataset.themePack ?? null)) === "slate");
  await page.close();
}

// 6: with a Pass, the Supporter teaser COMMITS.
{
  const page = await newPage({ "blammytv.license.key": JSON.stringify({ v: 1, data: "BTV-AAAA-BBBB-CCCC-DDDD" }), "blammytv.license.entitlement": passEntitlement() });
  await openThemes(page);
  await pick(page, "supporter");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.themePack") ?? "null"));
  check("owning the Pass commits Supporter",
    JSON.stringify(stored) === JSON.stringify({ v: 1, data: "supporter" }), JSON.stringify(stored));
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
