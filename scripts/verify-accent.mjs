// E2E: the accent picker in Settings → Customize (v0.9.79).
//
// The picker came back from old/themes on its own (ROADMAP decision 1), and
// the parts of it that can break do so SILENTLY, which is why this exists:
//
//   - the boot line in main.tsx. Drop it and every pick still works until
//     the next launch, when it quietly reverts to the default.
//   - the contrast rule. `--accent-ink` has to flip between a light and a
//     dark swatch, or a primary button carries unreadable text.
//   - the popover's layer. At the registry's z-50 it paints BEHIND the
//     Settings sheet (z 60), and a Custom button that opens nothing looks
//     exactly like one that works.
//   - Reset. It clears storage; the picker has to stop ticking the old
//     swatch when it does.
//
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-accent.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (
  await browser.newContext({ viewport: { width: 1400, height: 900 } })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page.goto(process.env.APP_URL ?? "http://localhost:4173/", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector(".navcap", { timeout: 20_000 });

const root = () =>
  page.evaluate(() => ({
    inline: document.documentElement.style.getPropertyValue("--accent"),
    ink: getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-ink")
      .trim(),
  }));
const openCustomize = async () => {
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const group = page.getByRole("group", { name: "Accent colour" });
  await group.waitFor({ timeout: 10_000 });
  return group;
};

let group = await openCustomize();

// 1. A fresh profile applies NOTHING: the default is the token, which flips
//    with the theme, not a stored hex.
check("fresh profile writes no inline accent", (await root()).inline === "");
check(
  "Default is the ticked swatch on a fresh profile",
  (await group.getByRole("button", { name: /Default/ }).getAttribute("aria-pressed")) === "true",
);

// 2. The contrast rule, on the two presets that need opposite inks.
await group.getByRole("button", { name: "Yellow", exact: true }).click();
const yellow = await root();
check("Yellow applies", yellow.inline === "#ffd500", yellow.inline);
check("Yellow gets DARK ink", yellow.ink === "oklch(0.205 0 0)", yellow.ink);
await group.getByRole("button", { name: "Blue", exact: true }).click();
const blue = await root();
check("Blue gets LIGHT ink", blue.ink === "oklch(0.985 0 0)", blue.ink);

// 3. The custom popover is ABOVE the Settings sheet, proven by hit-testing
//    its own centre rather than trusting a z-index.
await group.getByRole("button", { name: /Custom/ }).click();
const pop = page.locator("[data-slot='popover-content']");
await pop.waitFor({ timeout: 5_000 });
const onTop = await page.evaluate(() => {
  const p = document.querySelector("[data-slot='popover-content']");
  const r = p.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && p.contains(hit);
});
check("custom popover paints above the Settings sheet", onTop);
await page.locator("input[aria-label='Hex colour']").fill("ff6a00");
check("typing a full hex applies it", (await root()).inline === "#ff6a00");
await page.keyboard.press("Escape");

// 4. THE BOOT LINE. A reload must bring the pick back.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".navcap", { timeout: 20_000 });
check(
  "a stored accent is re-applied at launch (main.tsx)",
  (await root()).inline === "#ff6a00",
  (await root()).inline,
);

// 5. The Custom chip shows the ACTIVE colour, even with no custom slot
//    stored beside it (an older profile). It drew the empty rainbow once.
await page.evaluate(() => localStorage.removeItem("blammytv.accent-custom"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".navcap", { timeout: 20_000 });
group = await openCustomize();
const chipFill = await group
  .getByRole("button", { name: /Custom/ })
  .locator("span")
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundColor);
check("Custom chip draws the active colour", chipFill === "rgb(255, 106, 0)", chipFill);

// 6. Reset clears storage, the DOM and the picker's tick together.
await page.getByRole("button", { name: "Reset", exact: true }).click();
check("Reset removes the inline accent", (await root()).inline === "");
check(
  "Reset re-ticks Default",
  (await page
    .getByRole("group", { name: "Accent colour" })
    .getByRole("button", { name: /Default/ })
    .getAttribute("aria-pressed")) === "true",
);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
