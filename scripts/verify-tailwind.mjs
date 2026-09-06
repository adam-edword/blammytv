// Headless verify: TAILWIND'S FOUNDATION, which is invisible until it is wrong.
//
// Tailwind landed in v0.9.49 on top of 13,828 lines of hand-written CSS, and
// the parts that make that work are all cascade plumbing: a layer order, a
// token bridge, and one file deliberately left OUT of a layer. None of it
// renders anything, so none of it fails loudly. It fails as "that utility
// didn't apply" months later, on one screen, and the fix looks like
// `!important`.
//
// So this locks the plumbing rather than any component. Every check here
// would have passed before Tailwind existed except by being impossible, and
// every one of them fails if the layer order in styles/index.css is edited
// without understanding it.
//
// NO PROBE FIXTURE ON PURPOSE. The utilities asserted below are ones the
// GENERATED shadcn components already use, so they are in the emitted CSS
// because the app really needs them. Inventing classes for the harness would
// have meant Tailwind emitting styles that ship for no reason, and would
// have tested a stylesheet nobody else uses.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-tailwind.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await (
  await browser.newContext({ viewport: { width: 1400, height: 900 } })
).newPage();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page.goto(process.env.APP_URL ?? "http://localhost:4173/", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector(".navcap", { timeout: 20_000 });

/** Mount a throwaway element, read a computed property, remove it. */
const computed = (className, prop) =>
  page.evaluate(
    ([cls, p]) => {
      const el = document.createElement("div");
      el.className = cls;
      document.body.appendChild(el);
      const v = getComputedStyle(el).getPropertyValue(p);
      el.remove();
      return v.trim();
    },
    [className, prop],
  );

const cssVar = (name) =>
  page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

// ---- 1. THE LAYER ORDER, which is the whole reason index.css exists -------
//
// Cascade layers sort BEFORE specificity, and unlayered beats every layer. So
// with the app's sheets left unlayered, a utility would have lost to any app
// rule touching the same property, at any specificity. `.sports__morebtn`
// sets `border-radius: var(--radius-pill, 999px)`; `rounded-md` is 0.375rem.
// If `app` is below `utilities`, the utility wins. If the layering is undone,
// this reads 999px and nothing else on the screen looks wrong.
const pill = await computed("sports__morebtn", "border-radius");
const overridden = await computed("sports__morebtn rounded-md", "border-radius");
check(
  "the app's own rule still applies on its own",
  pill.startsWith("999"),
  `border-radius ${pill}`,
);
check(
  "and a Tailwind utility OVERRIDES it, which is what the layer order buys",
  overridden === "6px",
  `border-radius ${overridden}, expected 6px`,
);

// ---- 2. THE TOKEN BRIDGE -------------------------------------------------
//
// styles/theme.css republishes the app's palette into Tailwind's `--color-*`
// namespace, so shadcn's vocabulary reaches the real colours instead of a
// stock zinc. Asserted through a REAL generated class rather than the
// variable, because the variable being right does not prove the utility was
// generated from it.
const accent = await cssVar("--accent");
const primaryBg = await computed("bg-primary", "background-color");
const muted = await cssVar("--text-muted");
const mutedFg = await computed("text-muted-foreground", "color");
check(
  "bg-primary reaches the app's accent, not a stock palette",
  primaryBg.length > 0 && primaryBg !== "rgba(0, 0, 0, 0)",
  `--accent ${accent} -> ${primaryBg}`,
);
check(
  "text-muted-foreground reaches the app's middle text tier",
  mutedFg.length > 0 && mutedFg !== "rgba(0, 0, 0, 0)",
  `--text-muted ${muted} -> ${mutedFg}`,
);

// ---- 3. THE ACCENT IS LIVE, NOT A BUILD-TIME COPY ------------------------
//
// THE ONE MOST LIKELY TO REGRESS. `@theme inline` is what makes the utility
// emit `var(--accent)` rather than a snapshot of whatever red was in
// tokens.css at build time. Drop the `inline` keyword and everything above
// still passes while every custom accent silently stops reaching anything
// written with a utility. The Customize picker writes --accent onto :root,
// which is exactly what this does.
const before = await computed("bg-primary", "background-color");
await page.evaluate(() =>
  document.documentElement.style.setProperty("--accent", "#1e90ff"),
);
const after = await computed("bg-primary", "background-color");
check(
  "bg-primary FOLLOWS a runtime accent change (`@theme inline`)",
  after !== before && after === "rgb(30, 144, 255)",
  `${before} -> ${after}, expected rgb(30, 144, 255)`,
);
await page.evaluate(() =>
  document.documentElement.style.removeProperty("--accent"),
);

// ---- 4. THE SURFACE TOKENS ARE BY REFERENCE TOO --------------------------
//
// Same mechanism as 3 on a different token, because `@theme inline` is
// per-entry: someone can copy one line out of theme.css into a plain
// `@theme` and break only that colour. The accent passing does not prove
// `--bg` does.
//
// IT DOES NOT DRIVE THE THEME TOGGLE, deliberately. Flipping
// `data-theme="light"` does NOT move `--bg` on its own: the default pack
// (`:root[data-theme-pack="slate"]`, packs.css) pins it at the same
// specificity from a later file, so the pack wins. That dark-pack versus
// light-theme interaction is real, pre-dates Tailwind, and is already
// verify-themes' subject. Re-testing it here would duplicate that harness
// and fail for a reason that has nothing to do with the bridge.
const bgBefore = await computed("bg-background", "background-color");
await page.evaluate(() =>
  document.documentElement.style.setProperty("--bg", "#123456"),
);
const bgAfter = await computed("bg-background", "background-color");
check(
  "bg-background tracks --bg by reference, not by a build-time copy",
  bgAfter === "rgb(18, 52, 86)" && bgAfter !== bgBefore,
  `${bgBefore} -> ${bgAfter}, expected rgb(18, 52, 86)`,
);
await page.evaluate(() =>
  document.documentElement.style.removeProperty("--bg"),
);

// ---- 5. PREFLIGHT IS OFF ------------------------------------------------
//
// styles/index.css declares the `base` layer and deliberately does not fill
// it. Preflight is a reset that would zero every margin and border, flatten
// h1-h6, and make img/svg/video `display: block`. All questions base.css
// already answered differently. Turning it on is its own change with its own
// screenshot pass, so this asserts it has not happened by accident (an
// `@import "tailwindcss"` pasted in from any tutorial would do it).
const imgDisplay = await page.evaluate(() => {
  const el = document.createElement("img");
  document.body.appendChild(el);
  const v = getComputedStyle(el).display;
  el.remove();
  return v;
});
check(
  "Preflight has not been switched on behind our backs",
  imgDisplay === "inline",
  `a bare <img> computes display: ${imgDisplay} (Preflight would say block)`,
);

// ---- 6. THE VENDOR OVERRIDES STAY UNLAYERED ------------------------------
//
// react-colorful injects its own stylesheet from JS at runtime, and a
// runtime-injected sheet is unlayered. Unlayered beats every layer whatever
// the specificity, so the app's overrides of it have to be unlayered too or
// the accent picker quietly reverts to the library's own look. That is the
// entire reason styles/vendor.css exists as a separate file.
const vendor = await page.evaluate(() => {
  const out = { layered: 0, unlayered: 0 };
  // SELECTOR FIRST, THEN RECURSE, and the order is the bug this had.
  // Chromium implements nested CSS, so a plain CSSStyleRule now carries a
  // `cssRules` list of its own. Testing `r.cssRules` before `r.selectorText`
  // sent every style rule down the recursion branch and counted nothing at
  // all, which reads as "the file is missing" rather than "the walker is
  // wrong". Those are the two failure modes this check exists to separate.
  const walk = (rules, inLayer) => {
    for (const r of rules) {
      if (r.selectorText?.includes("react-colorful")) {
        out[inLayer ? "layered" : "unlayered"]++;
        continue;
      }
      const nested = r.cssRules;
      if (!nested) continue;
      walk(nested, inLayer || r instanceof CSSLayerBlockRule);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, false);
    } catch {
      /* cross-origin sheet, not ours */
    }
  }
  return out;
});
check(
  "the react-colorful overrides are unlayered, so they can beat the library",
  vendor.unlayered > 0 && vendor.layered === 0,
  `${vendor.unlayered} unlayered, ${vendor.layered} layered`,
);

if (process.env.SHOT_DIR)
  await page.screenshot({ path: `${process.env.SHOT_DIR}/tailwind.png` });
await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
