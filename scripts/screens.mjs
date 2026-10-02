// Screenshots of the app's main screens, dark and light, taken so that two
// runs of the same code give the same bytes, and a compare that says which
// screens differ and by how many pixels. For changes that must not change
// how anything looks (week of 2026-09-28, item 2: colours onto tokens):
// capture before, change, capture after, compare.
//
//   node scripts/screens.mjs capture <dir>      # starts its own servers
//   node scripts/screens.mjs compare <dirA> <dirB>
//
// What makes it repeatable: Date is fixed (Playwright's setFixedTime; timers
// still run), Math.random is seeded, every host but localhost is aborted
// (ESPN gets a small board), the shot waits for the network to go quiet,
// raster is software, motion is reduced (the Stream hero stops), and the
// screenshot fast-forwards animations. Two captures of one tree are
// byte-identical. compare checks bytes first, then decodes in the browser
// only the screens that differ.
//
// Screens cannot show a hover, an error or the player over video, so each
// capture also writes sheet-<theme>.json: every colour the stylesheets
// declare, resolved and flattened to pixels (sheetColours below). That is
// the exact half of the proof; the screenshots are the half that shows it
// all put together.
//
// ONLY=guide,stream captures just those scenes.
//
// PW_FROM as for the harnesses. Ports are the board's own (verify-all.mjs):
// it refuses to start if something is already on one of them.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { goTo } from "./nav-settle.mjs";

const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = "http://localhost:4173/";
const [mode, a, b] = process.argv.slice(2);
if (!["capture", "compare"].includes(mode) || !a || (mode === "compare" && !b)) {
  console.log("usage: node scripts/screens.mjs capture <dir> | compare <dirA> <dirB>");
  process.exit(2);
}

// ---------------------------------------------------------------- compare
if (mode === "compare") {
  const names = readdirSync(a).filter((f) => f.endsWith(".png")).sort();
  const missing = readdirSync(b).filter((f) => f.endsWith(".png") && !names.includes(f));
  const differ = names.filter((f) => !existsSync(path.join(b, f)) || !readFileSync(path.join(a, f)).equals(readFileSync(path.join(b, f))));
  let bad = missing.length;
  // The stylesheets, declaration by declaration (see sheetColours below).
  for (const theme of ["dark", "light"]) {
    const f = `sheet-${theme}.json`;
    if (!existsSync(path.join(a, f)) || !existsSync(path.join(b, f))) continue;
    const [sa, sb] = [a, b].map((d) => JSON.parse(readFileSync(path.join(d, f), "utf8")));
    let n = 0;
    let info = 0;
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (sa[k] === sb[k]) continue;
      // A custom property that comes or goes is a token being added or a
      // local one moving onto :root. What reads it is a declaration of its
      // own, and that is what must not change.
      const token = / :: --/.test(k) && !(k in sa && k in sb);
      if (token) info++;
      else n++;
      if (!(k in sb)) console.log(`GONE    ${theme}: ${k}\n          was ${sa[k]}`);
      else if (!(k in sa)) console.log(`NEW     ${theme}: ${k}\n          is  ${sb[k]}`);
      else console.log(`CHANGED ${theme}: ${k}\n          was ${sa[k]}\n          is  ${sb[k]}`);
    }
    console.log(
      `${f}: ${Object.keys(sa).length} declarations, ${n ? `${n} different` : "all the same"}` +
        (info ? ` (${info} custom properties added or removed)` : ""),
    );
    bad += n;
  }
  let noise = 0;
  let shots = 0;
  if (differ.length) {
    const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
    const page = await browser.newPage();
    for (const f of differ) {
      if (!existsSync(path.join(b, f))) {
        console.log(`MISSING ${f} (not in ${b})`);
        shots++;
        continue;
      }
      const pair = [a, b].map((d) => `data:image/png;base64,${readFileSync(path.join(d, f)).toString("base64")}`);
      const out = await page.evaluate(async ([x, y]) => {
        const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
        const [ia, ib] = await Promise.all([load(x), load(y)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { size: true };
        const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
        const [da, db] = [px(ia), px(ib)];
        let n = 0; let most = 0; let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(da[i + k] - db[i + k])));
          if (d) {
            n++;
            most = Math.max(most, d);
            const p = i / 4; const X = p % ia.width; const Y = (p - X) / ia.width;
            x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
          }
        }
        return { n, most, box: n ? [x0, y0, x1, y1] : null };
      }, pair);
      if (out.size) {
        console.log(`DIFFER  ${f}: different sizes`);
        shots++;
      } else if (out.n === 0) console.log(`same    ${f} (different bytes, identical pixels)`);
      // One level off is reported and not failed: below what anyone can
      // see, and the sheet check above is the exact half of the proof.
      // Two captures of one tree come out byte-identical; where this has
      // shown up is a real render difference too small to matter, e.g. a
      // gradient whose stops became color-mix() (Chrome draws those
      // through its float path, 1/255 off on the quality badges' fills).
      else if (out.most <= 1) {
        console.log(`noise   ${f}: ${out.n} pixels off by 1/255, box ${out.box.join(",")}`);
        noise++;
      } else {
        console.log(`DIFFER  ${f}: ${out.n} pixels, up to ${out.most}/255, box ${out.box.join(",")}`);
        shots++;
      }
    }
    await browser.close();
  }
  for (const f of missing) console.log(`EXTRA   ${f} (only in ${b})`);
  console.log(
    `\n${names.length} screens, ${names.length - differ.length} byte-identical` +
      (noise ? `, ${noise} within 1/255` : "") +
      (shots ? `, ${shots} DIFFERENT` : "") +
      (bad ? `; ${bad} stylesheet declarations DIFFERENT` : ""),
  );
  bad += shots;
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- servers
const SERVERS = [
  { name: "fake-m3u", port: 8082 },
  { name: "fake-panel", port: 8081 },
  { name: "fake-stalker", port: 8083, env: { LAX: "1" } },
  { name: "fake-aio", port: 8084 },
];
const NOW = new Date("2026-09-26T19:30:00");
const kids = [];
const up = async (port, probe = "/") => {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://localhost:${port}${probe}`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
};
for (const s of [...SERVERS.map((s) => s.port), 4173]) {
  try {
    await fetch(`http://localhost:${s}/`);
    console.log(`something is already on :${s}; stop it first`);
    process.exit(2);
  } catch {
    /* free */
  }
}
for (const s of SERVERS)
  kids.push(
    spawn(process.execPath, [path.join("scripts", `${s.name}.mjs`)], {
      cwd: ROOT,
      stdio: "ignore",
      env: { ...process.env, ...(s.env ?? {}), FAKE_NOW: String(NOW.getTime()) },
    }),
  );
kids.push(spawn("pnpm", ["exec", "vite", "--port", "4173", "--strictPort"], { cwd: path.join(ROOT, "apps", "app"), stdio: "ignore" }));
const stop = () => kids.forEach((k) => k.kill("SIGTERM"));
process.on("exit", stop);
if (!(await Promise.all([...SERVERS.map((s) => up(s.port)), up(4173)])).every(Boolean)) {
  console.log("a server did not come up");
  process.exit(2);
}

// ---------------------------------------------------------------- scenes
const XTREAM = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
const M3U = { v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] };
const AIO = "http://localhost:8084/manifest.json";

/** A small Sports board: one league, a game before, during and after. */
const espn = (url) => {
  const u = new URL(url);
  const at = (h) => new Date(NOW.getTime() + h * 3600_000).toISOString();
  const team = (id, name, abbr) => ({ id, location: name, name, abbreviation: abbr, displayName: name, shortDisplayName: name });
  const game = (id, h, state, detail, [hs, as]) => ({
    id, date: at(h), name: `Away ${id} at Home ${id}`, shortName: `A${id} @ H${id}`,
    status: { type: { state, completed: state === "post", shortDetail: detail, name: state === "post" ? "STATUS_FINAL" : "STATUS_SCHEDULED" } },
    competitions: [{ id, date: at(h), status: { type: { state, completed: state === "post", shortDetail: detail } },
      competitors: [
        { id: `h${id}`, homeAway: "home", team: team(`h${id}`, `Home ${id}`, "HOM"), score: String(hs) },
        { id: `a${id}`, homeAway: "away", team: team(`a${id}`, `Away ${id}`, "AWY"), score: String(as) },
      ],
      broadcasts: [{ market: "national", names: ["ESPN"] }] }],
  });
  const today = NOW.toISOString().slice(0, 10).replace(/-/g, "");
  const events = u.pathname.includes("basketball/nba") && u.searchParams.get("dates") === today
    ? [game("1", -3, "post", "Final", [101, 99]), game("2", -0.5, "in", "Q3 4:11", [66, 70]), game("3", 2, "pre", "8:30 PM", [0, 0])]
    : [];
  return { leagues: [{ id: "46", name: "NBA", abbreviation: "NBA", slug: "nba" }], events };
};

const SCENES = [
  { name: "guide", store: { playlists: XTREAM, startupTab: "live" }, ready: (p) => p.waitForFunction(() => document.body.innerText.includes("ESPN Hour"), null, { timeout: 30_000 }) },
  { name: "stream", store: { aiostreams: AIO, startupTab: "stream" }, ready: (p) => p.locator(".stream-card").first().waitFor({ timeout: 30_000 }) },
  { name: "discover", store: { aiostreams: AIO, startupTab: "stream" }, go: "discover", ready: (p) => p.locator(".stream-card").first().waitFor({ timeout: 30_000 }) },
  { name: "library", store: { aiostreams: AIO, startupTab: "stream" }, go: "mylist", ready: (p) => p.locator(".library__card, .library__empty").first().waitFor({ timeout: 30_000 }) },
  {
    name: "sports",
    store: { playlists: M3U, startupTab: "live", "sports-follows": { v: 1, data: { leagues: ["basketball/nba"], teams: [] } } },
    go: "sports",
    ready: (p) => p.locator(".sports__grid > *").first().waitFor({ timeout: 30_000 }),
  },
  { name: "multiview", store: { playlists: XTREAM, startupTab: "live" }, go: "multiview", ready: (p) => p.locator(".mvtab").waitFor({ timeout: 30_000 }) },
  {
    name: "settings-general",
    store: { playlists: XTREAM, aiostreams: AIO, startupTab: "stream" },
    ready: async (p) => {
      await p.locator(".stream-card").first().waitFor({ timeout: 30_000 });
      await p.getByRole("button", { name: "Settings", exact: true }).first().click();
      await p.getByRole("switch", { name: "Test enabled" }).waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "settings-customize",
    store: { playlists: XTREAM, aiostreams: AIO, startupTab: "stream", settingsTab: "customize" },
    ready: async (p) => {
      await p.locator(".stream-card").first().waitFor({ timeout: 30_000 });
      await p.getByRole("button", { name: "Settings", exact: true }).first().click();
      await p.getByRole("group", { name: "Accent color" }).waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "palette",
    store: { playlists: XTREAM, aiostreams: AIO, startupTab: "live" },
    ready: async (p) => {
      await p.waitForFunction(() => document.body.innerText.includes("ESPN Hour"), null, { timeout: 30_000 });
      await p.keyboard.press("Control+k");
      await p.keyboard.type("fake");
      await p.waitForTimeout(300);
    },
  },
  { name: "onboarding", store: { onboarded: false }, hide: ".boot-scene, .onb-cursor-glow", ready: (p) => p.locator(".onb-stage").waitFor({ timeout: 30_000 }) },
  {
    name: "overlay",
    url: `${APP}?overlay=1`,
    viewport: { width: 1100, height: 650 },
    init: () => {
      const unsub = () => () => {};
      window.overlayApi = {
        close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {}, seekTo() {}, setSpeed() {}, expand() {},
        collapse() {}, fullscreen() {}, exitFullscreen() {}, popout() {}, panel() {}, toggleFavorite() {}, goLive() {},
        setMouseIgnore() {}, selectAudio() {}, selectSub() {},
        getMeta() { return Promise.resolve({ channelName: "Test One", title: "The Evening News", live: true, progressPct: 40, startLabel: "7:00 PM" }); },
        onMeta: unsub, onLoading: unsub, onKey: unsub, onTime: unsub, onTracks: unsub,
        getLoading() { return false; }, getTime() { return null; }, getTracks() { return null; },
      };
    },
    ready: async (p) => {
      await p.locator(".theater-overlay").first().waitFor({ timeout: 15_000 });
      // Wake the chrome.
      await p.mouse.move(550, 325);
      await p.mouse.move(560, 330);
      await p.waitForTimeout(400);
    },
  },
];

/**
 * Every declaration in the app's stylesheets that can paint a colour, keyed
 * by where it is, resolved against the tokens and flattened to 8-bit pixels.
 * This is what covers the states no screen above shows: a hover, an error,
 * the player's chrome over video.
 *
 * Each rule's declarations go onto one probe element, so a custom property
 * the rule sets resolves too, and ones set on an ancestor (a card's
 * --card-ink) are seeded on the probe's parent from wherever they are
 * declared. Every colour in the computed value is then drawn over black and
 * over white: two colours that composite the same over both are the same
 * pixels, however they are spelled (`rgba(255,255,255,.62)` and
 * `color-mix(in srgb, var(--on-image) 62%, transparent)` are).
 */
const sheetColours = () => {
  const LONGHANDS = [
    "color", "background-color", "background-image", "border-top-color", "border-right-color",
    "border-bottom-color", "border-left-color", "border-image-source", "outline-color", "box-shadow",
    "text-shadow", "text-decoration-color", "caret-color", "accent-color", "fill", "stroke", "stop-color",
    "filter", "backdrop-filter", "mask-image", "-webkit-mask-image", "column-rule-color",
    "-webkit-text-fill-color", "-webkit-text-stroke-color", "scrollbar-color", "flood-color",
  ];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true });
  const px = (c) => {
    g.fillStyle = "#010203";
    g.fillStyle = c;
    if (g.fillStyle === "#010203" && !/^#010203$/i.test(c)) return `?${c}`;
    const over = (bg) => {
      g.globalCompositeOperation = "copy";
      g.fillStyle = bg;
      g.fillRect(0, 0, 1, 1);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = c;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
    };
    return `[${over("#000")}/${over("#fff")}]`;
  };
  const COLOUR =
    /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|#[0-9a-fA-F]{3,8}\b|\b(?:transparent|white|black)\b/g;
  const flatten = (v) => v.replace(COLOUR, px);

  // Each entry is one rule's declarations as CSS text, with the blocks
  // nested in it that apply here folded in, in order. Tailwind's optimiser
  // turns every `color-mix(... var() ...)` into a plain fallback plus a
  // nested `@supports` block holding the real value, so reading a rule's own
  // block alone reads the fallback, and missing the nested one misses the
  // colour.
  const rules = [];
  const nestedIn = (list, layers, where) => {
    for (const c of list) {
      if (c.constructor.name === "CSSNestedDeclarations") layers.push(c.style.cssText);
      else if (c instanceof CSSSupportsRule && CSS.supports(c.conditionText)) nestedIn(c.cssRules, layers, where);
      else if (c instanceof CSSStyleRule) walk([c], where);
      else if (c.cssRules) {
        // A nested @media or @container: its own entry, keyed by its
        // condition, so it is checked whether or not it matches here.
        const head = c.cssText.slice(0, c.cssText.indexOf("{")).trim();
        const inner = [];
        nestedIn(c.cssRules, inner, `${where}${head} `);
        if (inner.length) rules.push({ where: `${where}${head}`, css: inner.join(" ") });
      }
    }
  };
  const walk = (list, where) => {
    for (const r of list) {
      if (r instanceof CSSStyleRule) {
        const layers = [r.style.cssText];
        if (r.cssRules?.length) nestedIn(r.cssRules, layers, `${where}${r.selectorText} & `);
        rules.push({ where: `${where}${r.selectorText}`, css: layers.join(" ") });
      } else if (r instanceof CSSKeyframesRule) {
        for (const k of r.cssRules) rules.push({ where: `${where}@keyframes ${r.name} ${k.keyText}`, css: k.style.cssText });
      } else if (r instanceof CSSImportRule) {
        if (r.styleSheet) walk(r.styleSheet.cssRules, where);
      } else if (r.cssRules) {
        const head = r.cssText.slice(0, r.cssText.indexOf("{")).trim();
        walk(r.cssRules, r instanceof CSSLayerBlockRule ? where : `${where}${head} `);
      }
    }
  };
  for (const s of document.styleSheets) {
    try {
      walk(s.cssRules, "");
    } catch {
      /* cross-origin: not the app's */
    }
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const rootish = /^:root(\[[^\]]*\])?$|^html$/;
  const scratch = document.createElement("div");
  for (const { where, css } of rules) {
    if (rootish.test(where)) continue;
    scratch.style.cssText = css;
    for (let i = 0; i < scratch.style.length; i++) {
      const p = scratch.style[i];
      // Not a token: a local copy of one would stand in for it everywhere.
      if (p.startsWith("--") && !host.style.getPropertyValue(p) && !getComputedStyle(document.documentElement).getPropertyValue(p))
        host.style.setProperty(p, scratch.style.getPropertyValue(p));
    }
  }

  const out = {};
  const seen = new Map();
  for (const { where, css } of rules) {
    scratch.style.cssText = css;
    const names = new Set();
    for (let i = 0; i < scratch.style.length; i++) names.add(scratch.style[i]);
    const wanted = [...names].filter((p) => p.startsWith("--") || LONGHANDS.includes(p));
    if (!wanted.length) continue;
    // A fresh probe each time, with transitions and animations off: a rule
    // that declares `transition: border-color` otherwise reads back the
    // start of a transition from the previous rule's colour.
    host.replaceChildren();
    const probe = document.createElement("div");
    probe.style.cssText = css;
    probe.style.setProperty("transition", "none", "important");
    probe.style.setProperty("animation", "none", "important");
    host.appendChild(probe);
    const cs = getComputedStyle(probe);
    const n = (seen.get(where) ?? 0) + 1;
    seen.set(where, n);
    const at = n > 1 ? `${where} (#${n})` : where;
    for (const p of wanted) out[`${at} :: ${p}`] = flatten(cs.getPropertyValue(p).trim());
  }
  host.remove();
  return out;
};

mkdirSync(a, { recursive: true });
// Software raster: through SwiftShader, rounded corners came out a few
// levels different from one run of the same tree to the next.
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--disable-gpu", "--disable-gpu-rasterization", "--disable-checker-imaging", "--disable-partial-raster"],
});
let failed = 0;
const only = process.env.ONLY?.split(",");
for (const theme of ["dark", "light"]) {
  let sheet = false;
  for (const s of SCENES) {
    if (only && !only.includes(s.name)) continue;
    // Reduced motion, because the Stream hero advances every 8s on a real
    // timer and a shot could land either side of a step. The app stops it,
    // and anything else that moves on its own, under this preference.
    const ctx = await browser.newContext({
      viewport: s.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) =>
      /site\.api\.espn\.com/.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(espn(r.request().url())) })
        : r.abort(),
    );
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(
      ({ store, theme }) => {
        // Seeded, so shuffles and picks come out the same every run.
        let seed = 42;
        Math.random = () => {
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        sessionStorage.setItem("btv:welcome-played", "1");
        if (store.onboarded !== false) localStorage.setItem("btv:onboarded", "1");
        localStorage.setItem("blammytv.theme", JSON.stringify({ v: 1, data: theme }));
        for (const [k, v] of Object.entries(store)) {
          if (k === "onboarded") continue;
          localStorage.setItem(`blammytv.${k}`, JSON.stringify(v && typeof v === "object" && "v" in v ? v : { v: 1, data: v }));
        }
      },
      { store: s.store ?? {}, theme },
    );
    if (s.init) await page.addInitScript(s.init);
    // Requests in flight, so the shot waits for the last one: a card's year
    // and runtime arrive in a second request, and a shot taken before it
    // lands shows "Movie" where the next run shows "2024 · 118 min · Movie".
    let inflight = 0;
    let lastNet = Date.now();
    page.on("request", () => {
      inflight++;
      lastNet = Date.now();
    });
    const done = () => {
      inflight--;
      lastNet = Date.now();
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
    const file = path.join(a, `${s.name}-${theme}.png`);
    try {
      await page.goto(s.url ?? APP, { waitUntil: "domcontentloaded" });
      // The app boots dark whatever is stored (plan 016, D1) until light
      // gets its control back, so light is put on the way that control
      // will: the attribute on the root, after boot.
      if (theme === "light") await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
      if (s.go) await goTo(page, s.go);
      await s.ready(page);
      // Let art fade in and the layout settle.
      await page.waitForTimeout(1500);
      for (const end = Date.now() + 15_000; Date.now() < end && (inflight > 0 || Date.now() - lastNet < 1000); )
        await page.waitForTimeout(100);
      if (inflight > 0) console.log(`note    ${s.name}-${theme}: ${inflight} requests still open`);
      await page.mouse.move(1, 1);
      if (s.name === "overlay") {
        await page.mouse.move(550, 325);
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(300);
      // Every picture decoded and every font in, or a poster that landed a
      // frame late reads as a difference.
      await page.evaluate(async () => {
        await document.fonts.ready;
        // Loaded ones only: a lazy image below the fold never loads at all.
        const decoded = Promise.all([...document.images].filter((i) => i.complete).map((i) => i.decode().catch(() => {})));
        await Promise.race([decoded, new Promise((r) => setTimeout(r, 3000))]);
      });
      await page.waitForTimeout(300);
      // Onboarding's backdrop is a live scene that never holds still: it is
      // hidden, and the step is shot over the page's black. The scene's own
      // colours are in the sheet check below.
      if (s.hide) await page.addStyleTag({ content: `${s.hide} { visibility: hidden !important; }` });
      writeFileSync(file, await page.screenshot({ animations: "disabled", caret: "hide" }));
      console.log(`captured ${path.basename(file)}`);
      if (!sheet && !s.url) {
        writeFileSync(path.join(a, `sheet-${theme}.json`), JSON.stringify(await page.evaluate(sheetColours), null, 1));
        sheet = true;
      }
    } catch (e) {
      failed++;
      console.log(`FAILED  ${s.name}-${theme}: ${String(e).split("\n")[0]}`);
    }
    await ctx.close();
  }
}
await browser.close();
stop();
process.exit(failed ? 1 : 0);
