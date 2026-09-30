// E2E: Settings → Customize → Appearance, light mode's way back (plan 022).
//
// Dark, Light, or Match Windows (prefers-color-scheme, which WebView2 takes
// from Windows). From v0.9.58 to v0.10.64 main.tsx forced dark whatever was
// stored; the parts of this that can break do so quietly:
//   - the boot line. Drop it and a pick works until the next launch.
//   - Match Windows following Windows while the app is open, not only at
//     launch.
//   - the grey page: light's page is a grey with white cards on it, not
//     shadcn's white on white.
//   - Reset going back to Dark.
//
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-appearance.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
});
const boot = async () => {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
};
const state = () =>
  page.evaluate(() => {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    return {
      theme: root.dataset.theme ?? "dark",
      page: getComputedStyle(document.body).backgroundColor,
      card: css.getPropertyValue("--surface").trim(),
      track: css.getPropertyValue("--surface-track").trim(),
    };
  });
const group = () => page.getByRole("group", { name: "Appearance" });
const openCustomize = async () => {
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Customize", exact: true }).click();
  await group().waitFor({ timeout: 10_000 });
};
const pick = async (label) => {
  await group().getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(100);
};
const pressed = async () =>
  group().locator("button[aria-pressed='true']").getAttribute("aria-label");

await boot();
const fresh = await state();
check("a fresh profile opens dark", fresh.theme === "dark" && fresh.page === "oklch(0.145 0 0)", JSON.stringify(fresh));

await openCustomize();
check("Dark is the chosen option on a fresh profile", (await pressed()) === "Dark");
await pick("Light");
const light = await state();
check(
  "Light turns the app light, on a grey page with white cards",
  light.theme === "light" && light.page === "oklch(0.965 0 0)" && light.card === "oklch(1 0 0)" && light.track === "oklch(0.93 0 0)",
  JSON.stringify(light),
);

// On a picture (the player's chrome, multi-view's tiles, the hero), the
// theme's own accent gives way to dark's: light's is near-black, and the
// seek bar and sound ring would be dark on video. A picked colour stays.
const accents = () =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "on-picture";
    document.body.append(probe);
    const read = (el) => getComputedStyle(el).getPropertyValue("--accent").trim();
    const out = { page: read(document.documentElement), picture: read(probe) };
    probe.remove();
    return out;
  });
const defaultAccent = await accents();
const blue = page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: "Blue", exact: true });
await blue.click();
const pickedAccent = await accents();
check(
  "in light, a picture takes dark's accent unless a colour was picked",
  defaultAccent.page === "oklch(0.205 0 0)" && defaultAccent.picture === "oklch(0.922 0 0)" &&
    pickedAccent.page === pickedAccent.picture && pickedAccent.picture.startsWith("#"),
  JSON.stringify({ defaultAccent, pickedAccent }),
);
await page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: /Default/ }).click();

await boot();
check("and it is still light after a restart", (await state()).theme === "light");

// Match Windows: follows the OS at launch and while open.
await openCustomize();
check("the restarted Settings shows Light chosen", (await pressed()) === "Light");
await pick("Match Windows");
const withDarkOs = (await state()).theme;
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(150);
const osTurnedLight = (await state()).theme;
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(150);
const osTurnedDark = (await state()).theme;
check(
  "Match Windows follows Windows while the app is open",
  withDarkOs === "dark" && osTurnedLight === "light" && osTurnedDark === "dark",
  `${withDarkOs} → ${osTurnedLight} → ${osTurnedDark}`,
);
await page.emulateMedia({ colorScheme: "light" });
await boot();
check("and at launch", (await state()).theme === "light");

// Picking a theme stops following Windows.
await openCustomize();
await pick("Dark");
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(150);
check("Dark stays dark whatever Windows says", (await state()).theme === "dark");

// Reset Appearance goes back to Dark.
await pick("Light");
await page.getByRole("button", { name: "Reset", exact: true }).click();
await page.waitForTimeout(150);
check(
  "Reset Appearance goes back to Dark",
  (await state()).theme === "dark" && (await pressed()) === "Dark",
);
check("no page errors", errors.length === 0, errors[0]?.slice(0, 160));

await browser.close();
process.exit(fail ? 1 : 0);
