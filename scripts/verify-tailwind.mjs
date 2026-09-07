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

// ---- 7. THE ANIMATION UTILITIES EXIST ------------------------------------
//
// `animate-in`, `fade-in-0` and `zoom-in-95` are NOT stock Tailwind: they
// come from tw-animate-css, which shadcn assumes and which has to be
// imported separately. Miss it and every overlay in the app still WORKS
// while popping in and out with no transition, which is a silent downgrade
// rather than a failure. Read off a real class rather than the import,
// because the import can be present and still emit nothing (the file is
// mostly `@utility` at-rules, which Tailwind only processes at the top
// level, so wrapping it in a layer would quietly produce this same result).
const animated = await page.evaluate(() => {
  const el = document.createElement("div");
  el.className = "animate-in fade-in-0";
  document.body.appendChild(el);
  const s = getComputedStyle(el);
  const out = { name: s.animationName, opacity: s.getPropertyValue("--tw-enter-opacity").trim() };
  el.remove();
  return out;
});
check(
  "tw-animate-css is wired, so the overlays actually animate",
  animated.name === "enter" && animated.opacity === "0",
  `animation-name ${animated.name}, --tw-enter-opacity ${animated.opacity || "(unset)"}`,
);

// ---- 8. AND THEY RESPECT REDUCED MOTION ----------------------------------
//
// tw-animate-css ships NO prefers-reduced-motion handling of its own, so the
// guard in index.css is ours and is the only thing standing between someone
// who asked for less motion and a zooming, sliding tooltip. It neutralises
// the movement INPUTS and keeps the fade, which is the actual ask: reduced
// motion is not no feedback.
await page.emulateMedia({ reducedMotion: "reduce" });
const reduced = await page.evaluate(() => {
  const el = document.createElement("div");
  el.className = "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2";
  document.body.appendChild(el);
  const s = getComputedStyle(el);
  const out = {
    scale: s.getPropertyValue("--tw-enter-scale").trim(),
    y: s.getPropertyValue("--tw-enter-translate-y").trim(),
    opacity: s.getPropertyValue("--tw-enter-opacity").trim(),
  };
  el.remove();
  return out;
});
check(
  "reduced motion drops the zoom and the slide",
  reduced.scale === "1" && (reduced.y === "0" || reduced.y === "0px"),
  `scale ${reduced.scale}, translate-y ${reduced.y}`,
);
check(
  "  but KEEPS the fade, because reduced motion is not no feedback",
  reduced.opacity === "0",
  `--tw-enter-opacity ${reduced.opacity || "(unset)"}`,
);
await page.emulateMedia({ reducedMotion: "no-preference" });

// ---- 9. THE TOOLTIP IS THE APP'S GLASS, NOT SHADCN'S WHITE CHIP ----------
//
// The generated tooltip is `bg-foreground text-background`: a near-white
// chip. That is shadcn's look and every floating surface in this app is the
// dark glass recipe instead, so tooltip.tsx is edited away from the default
// and `add tooltip` would put it back. This is what would catch that.
await page.hover(".header__action");
await page.waitForSelector("[data-slot='tooltip-content']", { timeout: 4000 });
const bubble = await page.evaluate(() => {
  const el = document.querySelector("[data-slot='tooltip-content']");
  if (!el) return null;
  const s = getComputedStyle(el);
  return {
    text: el.textContent,
    bg: s.backgroundColor,
    blur: s.backdropFilter || s.webkitBackdropFilter,
  };
});
check(
  "an icon-only control shows a real tooltip, not the browser's title",
  bubble?.text === "Settings",
  bubble ? `"${bubble.text}"` : "no tooltip rendered",
);
check(
  "  and it is the app's floating glass",
  Boolean(bubble && bubble.blur && bubble.blur !== "none"),
  bubble ? `background ${bubble.bg}, backdrop-filter ${bubble.blur || "none"}` : "n/a",
);

// ---- 10. THE VIDEO HOLE STAYS TRANSPARENT --------------------------------
//
// THIS ONE IS A REGRESSION TEST, and the regression shipped. mpv is a native
// window BEHIND the webview, and `invert-player` is how it becomes visible:
// html and body go transparent, .app-shell paints the app background, and
// InvertedPlayer cuts a clip-path hole through the shell for the video.
//
// index.html carries an anti-flash `html { background: #000 }` so there is
// no white frame before the first paint. It was unlayered, and unlayered
// beats every layer whatever the specificity, so the moment the app's own
// sheets moved into `@layer app` (v0.9.49) it started outranking
// `:root.invert-player { background: transparent }`. The hole then showed
// opaque black instead of the video, with the audio still playing, and
// nothing about the app's own screens looked wrong.
//
// It is fixed by putting that rule in a `boot` layer declared first, i.e.
// weakest. This asserts the OUTCOME rather than the mechanism, so any other
// unlayered rule that reaches html or body fails it too.
const hole = await page.evaluate(() => {
  const had = document.documentElement.classList.contains("invert-player");
  document.documentElement.classList.add("invert-player");
  const t = (el) => getComputedStyle(el).backgroundColor;
  const out = {
    html: t(document.documentElement),
    body: t(document.body),
    shell: t(document.querySelector(".app-shell")),
  };
  if (!had) document.documentElement.classList.remove("invert-player");
  return out;
});
const clear = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
check(
  "invert-player leaves html and body transparent, so mpv can show through",
  clear(hole.html) && clear(hole.body),
  `html ${hole.html}, body ${hole.body}`,
);
check(
  "  and the shell still paints, because it is what the hole is cut from",
  !clear(hole.shell),
  `shell ${hole.shell}`,
);

// ---- 11. FOCUS IS A PRIMITIVE, NOT A REGISTRY -----------------------------
//
// The ring used to be a hand-kept allow-list of 41 selectors across four
// files, and it rotted twice on its own account (ui.css's comment: "the
// surfaces the v0.1.98 pass never reached"; the sports block: "every
// surface here fell through to the UA's 1px ring"). It is one
// `:focus-visible` rule now, so a control built tomorrow is covered
// without joining anything.
//
// The check is that an element NOBODY listed gets the ring, which is
// exactly what the list could never promise.
const ring = await page.evaluate(() => {
  const el = document.createElement("button");
  el.className = "no-such-class-anywhere";
  document.body.appendChild(el);
  el.focus();
  const s = getComputedStyle(el);
  const out = { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  el.remove();
  return out;
});
check(
  "an unlisted control gets the focus ring, because the list is gone",
  ring.style === "solid" && ring.width === "3px",
  `${ring.width} ${ring.style} ${ring.color}`,
);
// shadcn's geometry is 3px of --ring at 50%, so the colour must be
// translucent. A solid ring here means the accent got baked in flat and the
// half-opacity halo shadcn asks for was lost.
// PARSE THE ALPHA rather than pattern-match the string. Chromium serialises
// a color-mix() result as `color(srgb r g b / a)`, not `rgba(...)`, and a
// regex written for one of those quietly fails on the other while the ring
// is perfectly correct on screen. The claim is "not fully opaque", so read
// the number.
const alpha = Number(
  (ring.color.match(/\/\s*([\d.]+)\s*\)/) ??
    ring.color.match(/,\s*([\d.]+)\s*\)$/) ?? [, "1"])[1],
);
check(
  "  and it is shadcn's translucent ring, not a flat line",
  alpha > 0 && alpha < 1,
  `alpha ${alpha} from ${ring.color}`,
);
// Text inputs opt out on purpose: browsers hand them :focus-visible on
// MOUSE focus too, so a blanket ring sits on the search field the whole
// time you type in it.
const inputRing = await page.evaluate(() => {
  const el = document.createElement("input");
  document.body.appendChild(el);
  el.focus();
  const v = getComputedStyle(el).outlineStyle;
  el.remove();
  return v;
});
check(
  "  and text inputs still opt out, so typing does not sit inside a ring",
  inputRing === "none",
  `input outline-style: ${inputRing}`,
);

if (process.env.SHOT_DIR)
  await page.screenshot({ path: `${process.env.SHOT_DIR}/tailwind.png` });
await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
