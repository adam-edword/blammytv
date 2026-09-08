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
// rule touching the same property, at any specificity. `.chip-tabs` sets
// `border-radius: var(--radius-track)`, which is 10px; `rounded-md` is 8px.
// If `app` is below `utilities`, the utility wins. If the layering is undone,
// this reads 10px and nothing else on the screen looks wrong.
//
// BOTH NUMBERS MOVED IN v0.9.57 and both moves are the point of that change.
// The track was 12px and `rounded-md` was Tailwind's stock 6px, because the
// app had no `--radius` at all; it now has shadcn's 0.625rem with the whole
// scale derived from it, so the track is `--radius` exactly and `rounded-md`
// is `calc(--radius - 2px)`. A 6px here again means the four `--radius-*`
// entries fell out of theme.css and every component is off shadcn's scale.
//
// `.chip-tabs` RATHER THAN a button class, deliberately. This probe needs an
// app rule that owns its own radius, and v0.9.54 handed every standalone
// button's radius to shadcn's Button (it was `.sports__morebtn` here before,
// and it silently stopped setting one). The chip rail is the safest anchor
// left: its sliding thumb is the reason it is staying hand-written rather
// than becoming a shadcn primitive, so its radius is app-owned by decision.
const pill = await computed("chip-tabs", "border-radius");
const overridden = await computed("chip-tabs rounded-md", "border-radius");
check(
  "the app's own rule still applies on its own",
  pill === "10px",
  `border-radius ${pill}, expected 10px`,
);
check(
  "and a Tailwind utility OVERRIDES it, which is what the layer order buys",
  overridden === "8px",
  `border-radius ${overridden}, expected 8px`,
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
    ring.color.match(/,\s*([\d.]+)\s*\)$/) ?? ["", "1"])[1],
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

// ---- 7. NO APP RULE TRYING TO OUT-STYLE A COMPONENT'S UTILITIES --------
//
// This is a SOURCE check, not a page one, and it is here because it is the
// same fact the layer order above states, read from the other end.
//
// A shadcn component paints with utilities. `utilities` sits above `app`.
// So the moment a call site puts an app class on a <Button>, every rule in
// styles/*.css that sets a property Button already sets goes dead — quietly,
// with no error and no visual clue except that a state stops appearing.
// v0.9.54 shipped six of these in one afternoon: the armed danger button,
// the "update ready" accent, the pressed meta chip, the up-next compact
// size, the chevron's 13px, and aurora's gradient face. All six were
// written before the component existed and all six had stopped working.
//
// So: read which app classes actually ride on a <Button>, then read the
// stylesheets for rules that target one of them and set something Button
// owns. Derived from the source rather than listed here on purpose — the
// list would rot the first time a primitive converts, and this is the exact
// moment the check needs to be right.
//
// The fix for a hit is never `!important`. It is one of the three moves
// v0.9.54 used: pick the variant/size from the state in JSX, write a utility
// at the call site, or take a property the component does not touch (aurora
// went from the `background` shorthand to `background-image`).
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  const src = join(root, "apps/app/src");

  const tsx = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !p.includes("/components/ui/"))
        tsx.push(p);
    }
  };
  walk(src);

  // Every className on a <Button …>, split into bare app classes.
  //
  // EVERY string literal in the className, not the first one. Half of these
  // call sites are conditional now (`"season-chip" + (on ? " …--on" : " …")`)
  // and a match that stopped at the opening quote read `)` and `aria-label=`
  // as class names while missing the classes that were actually there. The
  // props are read off the tag with a matching-brace scan for the same
  // reason: `[\s\S]*?>` ends at the first `>` inside an arrow function.
  //
  // A token counts as an app class when the app's own stylesheets define it,
  // which is exact where a shape test is not: `btn-primary` and
  // `rounded-full` are the same shape, and every heuristic that told them
  // apart would need editing the first time someone names a class oddly.
  // Cross-referencing the sheets is also the only thing this check is
  // ultimately about.
  const stylesDir = join(src, "styles");
  const sheets = readdirSync(stylesDir).filter((n) => n.endsWith(".css"));
  const defined = new Set();
  for (const f of sheets)
    for (const m of readFileSync(join(stylesDir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g))
      defined.add(m[1]);

  const onButton = new Set();
  for (const f of tsx) {
    const s = readFileSync(f, "utf8");
    for (const at of [...s.matchAll(/<Button\b/g)].map((m) => m.index)) {
      // Walk to the tag's real end, tracking quotes, comments and brace
      // depth. A lazy `[\s\S]*?>` would stop at the first `>` inside an
      // arrow function.
      //
      // COMMENTS ARE SKIPPED, and that is not defensive coding. JSX allows
      // `//` between props and these call sites use it; an apostrophe in one
      // ("Button's own utilities") opens a quote that never closes, the scan
      // runs to the end of the file, and it silently reads every class in
      // the portal below as if it were on the button. That is the second
      // time an apostrophe inside a comment has broken a scanner in this
      // migration — the first ate a closing </button> in SportsTheater.tsx.
      let i = at, depth = 0, q = "";
      for (; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q && s[i - 1] !== "\\") q = ""; continue; }
        if (c === "/" && s[i + 1] === "/") { i = s.indexOf("\n", i); if (i < 0) break; continue; }
        if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i) + 1; if (i < 1) break; continue; }
        if (c === '"' || c === "'" || c === "`") q = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const tag = s.slice(at, i);
      // The className ATTRIBUTE'S VALUE, not every literal after it. Reading
      // to the end of the tag swept in `title=`, `aria-label=` and
      // `data-*` too, which put words like "settings" and "live" into the
      // class set — and since both are real CSS classes, the check then
      // reported the Settings card and the Live screen as button paint.
      const cn = tag.indexOf("className=");
      if (cn < 0) continue;
      let j = cn + "className=".length;
      while (tag[j] === " ") j++;
      let value = "";
      if (tag[j] === '"') {
        const end = tag.indexOf('"', j + 1);
        value = end < 0 ? "" : tag.slice(j, end + 1);
      } else if (tag[j] === "{") {
        let d = 0, qq = "", k = j;
        for (; k < tag.length; k++) {
          const c = tag[k];
          if (qq) { if (c === qq && tag[k - 1] !== "\\") qq = ""; continue; }
          if (c === '"' || c === "'" || c === "`") qq = c;
          else if (c === "{") d++;
          else if (c === "}") { d--; if (!d) break; }
        }
        value = tag.slice(j, k + 1);
      }
      for (const lit of value.matchAll(/["'`]([^"'`]*)["'`]/g))
        for (const c of lit[1].split(/\s+/))
          if (defined.has(c)) onButton.add(c);
    }
  }

  // What Button sets NO MATTER WHICH VARIANT: its cva base string plus every
  // size. Colour is deliberately absent — `background`, `color`,
  // `border-color` and `box-shadow` are set by SOME variants and not others,
  // so listing them here would flag `.vod-back`'s scrim (correct, `ghost`
  // paints no background) alongside a real break, and a check that cries
  // wolf four times out of six is a check nobody reads. The variant-painted
  // half is covered live below instead, where the real element can be
  // measured rather than guessed at.
  const OWNED = new Set([
    "display", "flex-shrink", "align-items", "justify-content", "gap",
    "border-radius", "font-size", "font-weight", "white-space", "transition",
    "outline", "height", "padding", "padding-left", "padding-right",
    "padding-top", "padding-bottom",
  ]);

  const dead = [];
  const styles = join(src, "styles");
  for (const f of readdirSync(styles).filter((n) => n.endsWith(".css"))) {
    const css = readFileSync(join(styles, f), "utf8");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Only the LAST simple selector matters: `.leaguepick__clearcount` is
      // a span inside the button and owns itself. `<class> svg` counts,
      // because Button sizes its own svgs.
      //
      // EVERY class in that last simple selector has to be a Button class,
      // and every comma arm of the rule has to pass. Both narrowings are
      // load-bearing. `.sports__toggle.is-on` shares `is-on` with
      // `.player__btn.is-open`, so a `.some()` test would report paint on a
      // control that was never converted. And a rule grouped with something
      // that is NOT a button — the theme packs put `.navcap__item:hover`
      // and `.live-folder:hover` on one text-shadow — is a shared rule a
      // button happens to be in, not an app rule fighting the component;
      // its declaration still does its job for the other arm.
      const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const arms = sel.split(",").map((a) => a.trim()).filter(Boolean);
      const allMine = arms.every((one) => {
        const parts = one.split(/\s+|>/).filter(Boolean);
        const tail = parts.at(-1) ?? "";
        const target = tail === "svg" ? (parts.at(-2) ?? "") : tail;
        const cls = (target.match(/\.([A-Za-z0-9_-]+)/g) ?? []).map((c) => c.slice(1));
        return cls.length && cls.every((c) => onButton.has(c));
      });
      if (allMine) {
        const props = m[2]
          .split(";")
          .map((d) => d.trim().split(":")[0].trim())
          .filter((p) => OWNED.has(p));
        if (props.length) dead.push(`${f} ${arms[0]} { ${props.join(", ")} }`);
      }
    }
  }
  check(
    "no app rule sets a property shadcn's Button already owns",
    dead.length === 0,
    dead.length
      ? `${dead.length} dead rule(s), first: ${dead[0]}`
      : `${onButton.size} app classes ride on a <Button>, none fight it`,
  );
}

// ---- 8. THE OTHER HALF: a theme pack still repaints a shadcn variant ----
//
// The static check above deliberately says nothing about colour, so this
// says it about the one case with real stakes. Under the Aurora accent the
// primary button is not accent-coloured at all: it is a conic wash over
// black with an iridescent ring, and that recipe is written in ui.css, in
// the app layer, against a face `default` paints with `bg-primary` from the
// utilities layer.
//
// It survives only because the rule names `background-image` rather than the
// `background` shorthand — the shorthand would also have set
// background-color, lost that half to the utility, and taken the whole
// declaration down with it. That is a one-word difference with no visible
// warning, so it gets a check.
const aurora = await page.evaluate(() => {
  const root = document.documentElement;
  const had = root.dataset.accentStyle;
  root.dataset.accentStyle = "aurora";
  const el = document.createElement("div");
  // The classes a <Button variant="default"> really carries, plus the app
  // class the pack rule targets.
  el.className = "bg-primary text-primary-foreground btn-primary";
  document.body.appendChild(el);
  const s = getComputedStyle(el);
  const out = { image: s.backgroundImage, color: s.backgroundColor };
  el.remove();
  if (had === undefined) delete root.dataset.accentStyle;
  else root.dataset.accentStyle = had;
  return out;
});
check(
  "Aurora still repaints the primary button, over shadcn's own fill",
  aurora.image.includes("gradient"),
  `background-image ${aurora.image.slice(0, 70)}…`,
);

// ---- 9. THE DESIGN SYSTEM ITSELF, not just the plumbing -----------------
//
// Checks 1-8 lock the cascade. These lock the LOOK, because v0.9.64 spent a
// whole pass moving the app's own surfaces, type and edges onto shadcn's and
// every one of them is a value somebody could put back without noticing.

// 9a. NO SUB-PIXEL BORDERS. shadcn draws every edge at 1px. This app had ten
// `0.5px solid` hairlines on chips and thumbs, which render as a dithered
// grey at 1x and a real line at 2x — the same control, two different edges,
// depending on the monitor. A source check because a computed style reports
// the used value, not the authored one.
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = new URL("../apps/app/src/styles/", import.meta.url).pathname;
  const bad = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".css")))
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(
      /border(?:-[a-z]+)?:\s*(0?\.\d+|1\.\d+)px\s+solid/g,
    ))
      bad.push(`${f}: ${m[1]}px`);
  check(
    "every border is a whole pixel, the way shadcn draws them",
    bad.length === 0,
    bad.length ? bad.slice(0, 3).join(", ") : "no sub-pixel or 1.5px edges",
  );
}

// 9b. THE CARD SURFACE. shadcn's Card is `bg-card border shadow-sm`, and the
// app's chrome cards were `#00000050` + an 18px backdrop blur until v0.9.64.
// Read live off a real chrome card rather than off the stylesheet, because
// the thing that matters is what paints.
//
// The probe is `.vod-source`, a source row on the title screen. It was
// `.episode-card` until v0.9.67, when the episode row became a shadcn
// <Item> and its CSS paint went away with it — the probe then read a bare
// div and this check would have started asserting against nothing. Any
// class this points at has to be one that still paints from CSS; a control
// that has been converted to a shadcn component never is.
const card = await page.evaluate(() => {
  const el = document.createElement("div");
  el.className = "vod-source";
  document.body.appendChild(el);
  const s = getComputedStyle(el);
  const out = {
    bg: s.backgroundColor,
    blur: s.backdropFilter,
    shadow: s.boxShadow,
    radius: s.borderRadius,
  };
  el.remove();
  return out;
});
check(
  "a chrome card is shadcn's opaque surface, not the old glass",
  card.blur === "none" && !/rgba\(0, 0, 0, 0\.3/.test(card.bg),
  `background ${card.bg}, backdrop-filter ${card.blur}`,
);
check(
  "  and it carries shadow-sm, which is what makes it read as a card",
  card.shadow !== "none" && card.radius === "14px",
  `${card.radius}, shadow ${card.shadow.slice(0, 34)}…`,
);

// 9c. THE INPUT. shadcn's is h-9 / rounded-md / bg-input/30, and it RINGS on
// focus — reversing an opt-out this app carried for years. The ring is the
// only thing marking which field has the caret in a column of identical
// boxes, so its absence is the regression worth catching.
const field = await page.evaluate(() => {
  const el = document.createElement("input");
  el.className = "settings-input";
  document.body.appendChild(el);
  const s = getComputedStyle(el);
  const rest = { h: el.getBoundingClientRect().height, r: s.borderRadius };
  el.focus();
  const lit = getComputedStyle(el).boxShadow;
  el.remove();
  return { ...rest, lit };
});
check(
  "a text field is shadcn's Input box",
  Math.round(field.h) === 36 && field.r === "8px",
  `${Math.round(field.h)}px tall, radius ${field.r}`,
);
check(
  "  and it takes a focus ring, which shadcn's does and this app used not to",
  /\d/.test(field.lit) && field.lit !== "none",
  field.lit.slice(0, 46) + "…",
);

// 9d. THE TYPE SCALE. A dialog's title cannot be larger than a page's
// heading, and this one was 32px — bigger than shadcn uses anywhere. The
// check is the RELATIONSHIP, not the number, so a later retune is free.
const type = await page.evaluate(() => {
  const read = (cls, tag = "div") => {
    const el = document.createElement(tag);
    el.className = cls;
    document.body.appendChild(el);
    const px = parseFloat(getComputedStyle(el).fontSize);
    el.remove();
    return px;
  };
  return {
    dialogTitle: read("settings__title", "h2"),
    group: read("settings__group", "h3"),
    label: read("settings-field__label"),
    row: read("media-row__title", "h2"),
  };
});
check(
  "the type scale descends: row title > dialog title > group > label",
  type.row > type.dialogTitle &&
    type.dialogTitle > type.group &&
    type.group > type.label,
  `row ${type.row} > dialog ${type.dialogTitle} > group ${type.group} > label ${type.label}`,
);
check(
  "  and nothing in the chrome is over 24px, shadcn's largest",
  Math.max(type.row, type.dialogTitle, type.group, type.label) <= 24,
  `largest is ${Math.max(type.row, type.dialogTitle, type.group, type.label)}px`,
);

// 9e. EVERY REF HANDED TO A PRIMITIVE LANDS SOMEWHERE. Source check, not a
// live one: a dropped ref has no computed style to read, which is the whole
// problem with it.
//
// The registry writes its components for React 19, where a function
// component takes `ref` as an ordinary prop. This app is on React 18, where
// React strips it and logs a warning nobody sees in a production build. So
// `ref={x}` on a plain-function primitive leaves `x.current` null and the
// code reading it does nothing at all — Settings' "add sources" menu never
// opened for twelve versions on exactly this, and the tournament draw quietly
// stopped focusing its back button.
//
// The check pairs the two halves rather than hard-coding a list: find every
// `ref=` on a `components/ui/` component at a call site, then assert that
// component's own file forwards refs. It stays right when a new primitive is
// installed and when one stops needing the wrapper.
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  const src = join(root, "apps/app/src");
  const uiDir = join(src, "components/ui");

  // component name -> the file that defines it, from the ui folder's exports.
  const owner = new Map();
  for (const f of readdirSync(uiDir).filter((n) => n.endsWith(".tsx"))) {
    const body = readFileSync(join(uiDir, f), "utf8");
    const ex = body.match(/export\s*\{([^}]*)\}/g) ?? [];
    for (const block of ex)
      for (const name of block.replace(/export\s*\{|\}/g, "").split(","))
        if (/^[A-Z]/.test(name.trim())) owner.set(name.trim(), f);
  }

  const tsx = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !p.startsWith(uiDir)) tsx.push(p);
    }
  };
  walk(src);

  const dropped = [];
  for (const f of tsx) {
    const body = readFileSync(f, "utf8");
    for (const name of owner.keys()) {
      const re = new RegExp("<" + name + "\\b", "g");
      let m;
      while ((m = re.exec(body))) {
        // The same brace/quote/comment-aware walk the dead-rules check uses:
        // a lazy `[\s\S]*?>` ends at the first `>` inside an arrow function,
        // and an apostrophe in a `//` comment runs the scan off the end.
        let i = m.index, depth = 0, q = "";
        for (; i < body.length; i++) {
          const c = body[i];
          if (q) { if (c === q && body[i - 1] !== "\\") q = ""; continue; }
          if (c === "/" && body[i + 1] === "/") { i = body.indexOf("\n", i); if (i < 0) break; continue; }
          if (c === "/" && body[i + 1] === "*") { i = body.indexOf("*/", i) + 1; if (i < 1) break; continue; }
          if (c === '"' || c === "'" || c === "`") q = c;
          else if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === ">" && depth === 0) break;
        }
        if (!/\sref=/.test(body.slice(m.index, i))) continue;
        const def = readFileSync(join(uiDir, owner.get(name)), "utf8");
        // Radix-backed primitives forward through the primitive itself, so
        // either the wrapper forwards or it spreads onto a Radix component.
        const forwards =
          /forwardRef/.test(def) ||
          new RegExp("function " + name + "\\b[\\s\\S]{0,600}?<\\w+Primitive\\.").test(def);
        if (!forwards)
          dropped.push(`${f.slice(src.length + 1)}: <${name} ref=…>`);
      }
    }
  }
  check(
    "every ref handed to a components/ui primitive is actually forwarded",
    dropped.length === 0,
    dropped.length ? dropped.slice(0, 3).join(", ") : "no dropped refs",
  );
}

if (process.env.SHOT_DIR)
  await page.screenshot({ path: `${process.env.SHOT_DIR}/tailwind.png` });
await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
