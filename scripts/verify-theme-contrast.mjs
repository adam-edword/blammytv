// E2E: every control's ink is readable against what is actually behind it, in
// every themed face (Classic Dark and Light, Fluent Dark and Light).
//
// Why this exists: twice the harnesses passed while the pictures were broken.
// Accent swatches painted grey, and a QA sweep then found text unreadable
// against its background in seven places (white on grey chips in Classic's
// theater, dark buttons on a dark capsule in Fluent Light, black-on-black on
// onboarding), because both packs repaint every shadcn Button with !important
// rules and nothing ever looked at the result. verify-theme-consistency
// compares one place with another; this one asks the only question that
// matters on each: can you read it?
//
// HOW IT MEASURES. For each face it tours the scenes below. In each scene it
// takes ONE screenshot, finds every visible control that has text or an icon
// (buttons, tabs, options, menu items, tree items, radios, switches, links,
// inputs with a value or a placeholder, chips, rows), and for each one reads
// the pixels of its own rectangle: the most common colour is the background,
// the colour furthest from it that covers a few pixels is the ink. Contrast is
// WCAG's ratio of the two. Pixels, not computed styles, because a computed
// colour says nothing about a gradient, a checker, a translucent capsule or the
// video hole behind a player control: what is painted is what a person reads.
//
//   needs 4.5:1 for normal text, 3:1 for icons and large text (24px, or 18.66px
//   bold).
//
// EXEMPT, and counted in the output: a disabled control (WCAG exempts it); a
// control over a picture (a poster, a thumbnail: no single background to read
// against, so it is skipped, not passed); a control another thing is drawn on
// top of, or that is clipped to under half; one with no text or icon; and a
// PART of a control that is scrolled out of its list or under something else
// (hit-tested at its middle: the pixels there are not its own). A scene with
// fewer than 3 controls measured FAILS ("only N controls found"; What's New
// has two in all): a page that came up empty must never read as green.
//
// HOVER too, for the on-picture surfaces (theater, mini player, mini-guide,
// Multi-View tiles) and each pack's toolbar or nav: every such control is
// hovered and measured again, since a hover rule is where a pack's !important
// colours go wrong.
//
// The last section runs in a browser that keeps its scrollbars (headless hides
// them): the poster rows, the Guide and a film page must have the same
// scrollbar gutters in every pack as in Default, and no page may scroll
// sideways where Default's does not.
//
// Not covered, and said so: what is behind the controls over REAL video (the
// player's hole is a flat colour here), and the film player, which needs mpv.
//
// Offline: the fake M3U, Xtream panel and AIOStreams; ESPN and TMDB answered
// in the shapes the app parses; every other host aborted. The native side is
// stubbed as the QA sweep's did, so Accounts and the player have content.
//
//   node scripts/fake-m3u.mjs; node scripts/fake-panel.mjs; node scripts/fake-aio.mjs
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-theme-contrast.mjs
//   FACES=classic-light SCENES=Theater node scripts/verify-theme-contrast.mjs   # a slice
import { createRequire } from "node:module";
import http from "node:http";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const T0 = Date.now();
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};
// Detail lines under a check. They must not start with a tick word: the board
// counts those.
const note = (s) => console.log(`  - ${s}`);

// ------------------------------------------------------------------ fixtures
const XT = { kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" };
const PINS = { kind: "xtream", id: "p", name: "Pins", enabled: true, server: "http://localhost:8081", username: "pins", password: "p" };
const M3U = { kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" };
const AIO = "http://localhost:8084/manifest.json";

const dayAt = (offset, hour) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const team = (id, name, abbr, color) => ({ id: String(id), location: name, name, abbreviation: abbr, displayName: name, shortDisplayName: name, color });
const STATE = {
  pre: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false } },
  live: { clock: 151, displayClock: "2:31", period: 4, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "4th 2:31" } },
  final: { clock: 0, displayClock: "0:00", period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } },
};
const event = (id, when, st, home, away, scores, broadcasts) => ({
  id,
  date: when.toISOString(),
  name: `${away.name} at ${home.name}`,
  status: STATE[st],
  competitions: [
    {
      id,
      date: when.toISOString(),
      competitors: [
        { id: `h${id}`, homeAway: "home", team: home, score: String(scores[0]) },
        { id: `a${id}`, homeAway: "away", team: away, score: String(scores[1]) },
      ],
      status: STATE[st],
      broadcasts: broadcasts ? [{ market: "national", names: broadcasts }] : [],
    },
  ],
});
const BOARDS = {
  "football/nfl": {
    leagues: [{ id: "28", name: "NFL", abbreviation: "NFL", slug: "nfl" }],
    events: [
      event("n1", dayAt(0, 12), "live", team("h1", "Lions", "DET", "1f6fb2"), team("a1", "Bears", "CHI", "c0392b"), [14, 21], ["Fake Sky Sports", "ESPN"]),
      event("n2", dayAt(0, 9), "final", team("h2", "Cowboys", "DAL", "003594"), team("a2", "Seahawks", "SEA", "69be28"), [3, 7], ["ESPN"]),
      event("n3", dayAt(0, 23), "pre", team("h3", "Dolphins", "MIA", "008e97"), team("a3", "Broncos", "DEN", "fb4f14"), [0, 0], null),
      event("n4", dayAt(1, 15), "pre", team("h4", "Giants", "NYG", "0b2265"), team("a4", "Celtics", "BOS", "000000"), [0, 0], null),
    ],
  },
  "basketball/nba": {
    leagues: [{ id: "46", name: "NBA", abbreviation: "NBA", slug: "nba" }],
    events: [event("b1", dayAt(0, 20), "pre", team("h5", "Knicks", "NYK", "006bb6"), team("a5", "Heat", "MIA", "98002e"), [0, 0], null)],
  },
};
const espn = (route) => {
  const url = new URL(route.request().url());
  const dates = url.searchParams.get("dates") ?? "";
  const path = Object.keys(BOARDS).find((p) => url.pathname.includes(`/${p}/`));
  const board = path ? BOARDS[path] : { events: [] };
  const events = dates.length === 8 ? board.events.filter((e) => ymd(new Date(e.date)) === dates) : [];
  return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ...board, events }) });
};
const tmdb = (route) => {
  const u = new URL(route.request().url());
  let body = {};
  if (u.pathname.includes("/genre/")) body = { genres: [{ id: 27, name: "Horror" }, { id: 35, name: "Comedy" }] };
  else if (u.pathname.endsWith("/search/keyword")) body = { results: [{ id: 9882, name: u.searchParams.get("query") }] };
  else if (u.pathname.includes("/discover/")) body = { results: [{ id: 348, title: "Alien", release_date: "1979-05-25", overview: "A crew answers a distress call." }] };
  else if (u.pathname.includes("external_ids")) body = { imdb_id: "tt100001" };
  return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
};

// A stand-in stream proxy, so a Multi-View tile has something to play.
const proxy = http.createServer((rq, rs) => {
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => clearInterval(t));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PROXY = proxy.address().port;

// --------------------------------------------------------------------- faces
const FACES = [
  { id: "classic-dark", pack: "classic", light: false },
  { id: "classic-light", pack: "classic", light: true },
  { id: "fluent-dark", pack: "fluent", light: false },
  { id: "fluent-light", pack: "fluent", light: true },
  // Default is not on the tour: the packs are the subject. FACES=default-dark
  // asks for it, to tell a pack's fault from the app's own (its Settings and
  // Go To scenes cannot be reached: they are entered from a pack's chrome).
  ...(process.env.FACES?.includes("default") ? [{ id: "default-dark", pack: null, light: false }, { id: "default-light", pack: null, light: true }] : []),
].filter((f) => !process.env.FACES || process.env.FACES.split(",").includes(f.id));
const WANT_SCENE = (n) => !process.env.SCENES || process.env.SCENES.split(",").includes(n);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** A page in `pack` (null = Default), the native side stubbed. */
async function open(b, { pack, light, startup = "stream", pins = false, onboarded = true, whats = "999.0", version = null, store = {}, size = [1600, 900] }) {
  const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, colorScheme: light ? "light" : "dark", reducedMotion: "reduce" });
  await ctx.route(
    (u) => !["localhost", "127.0.0.1"].includes(u.hostname),
    (r) => {
      const u = r.request().url();
      if (u.includes("site.api.espn.com")) return espn(r);
      if (u.includes("api.themoviedb.org")) return tmdb(r);
      return r.abort();
    },
  );
  if (version) await ctx.route("**/src/lib/version.ts*", (r) => r.fulfill({ contentType: "text/javascript", body: `export const APP_VERSION = "${version}";` }));
  const page = await ctx.newPage();
  page.__classic = pack === "classic";
  page.on("pageerror", (e) => errors.push(`${pack ?? "default"}: ${e}`));
  const all = {
    playlists: onboarded ? (pins ? [PINS] : [XT, M3U]) : [],
    aiostreams: onboarded ? AIO : "",
    startupTab: startup,
    multiviewNoticeSeen: true,
    recordingNotice: false,
    tmdbKey: "harness-key",
    "sports-follows": { leagues: ["football/nfl", "basketball/nba"], teams: [] },
    ...(pack ? { themePack: pack } : {}),
    ...(light ? { theme: "light" } : {}),
    ...store,
  };
  await page.addInitScript(
    ({ all, port, onboarded, whats }) => {
      if (onboarded) localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: whats }));
      if (onboarded) sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("cx-seeded")) {
        sessionStorage.setItem("cx-seeded", "1");
        for (const [k, v] of Object.entries(all)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
      }
      MediaSource.isTypeSupported = () => true;
      window.__presenting = false;
      const listeners = {};
      let cb = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => {
          const id = ++cb;
          window["_" + id] = f;
          return id;
        },
        convertFileSrc: (p) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        invoke: (cmd, args) => {
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "plugin:event|listen") {
            (listeners[args.event] ??= []).push(args.handler);
            return Promise.resolve(++cb);
          }
          if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv`);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          if (cmd === "trakt_status" || cmd === "mal_status") return Promise.resolve({ configured: true, connected: false });
          if (cmd === "frontend_status") return Promise.resolve({ serving: "", pending: "" });
          if (cmd === "mpv_status" && window.__presenting)
            return Promise.resolve(JSON.stringify({ pos: 10, dur: 0, presenting: true, ended: false, buffering: false, seekable: true, cacheDur: 0, dvrStart: 0, dvrEnd: 0, audio: window.__audio ?? [], subs: window.__subs ?? [], chapters: [] }));
          if (cmd === "rec_default_folder") return Promise.resolve("C:\\Users\\sam\\Videos\\BlammyTV");
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    { all, port: PROXY, onboarded, whats },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

let TIMING = process.env.TIMING;
let CUR = "";
async function settle(page, ms = 250) {
  const a = Date.now();
  await page
    .waitForFunction(() => !document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity), null, { timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
  if (TIMING) console.log(`    settle ${Date.now() - a}ms`);
}

// ------------------------------------------------------------- the measuring
/**
 * Runs in the page. mode "all": find every control, tag it in window.__cx, and
 * measure each against `b64` (a viewport screenshot). mode "one": measure
 * window.__cx[idx] against `b64`, a clip of the page at (ox, oy).
 */
async function inPage({ mode, b64, ox = 0, oy = 0, idx = -1, scopes = [], grayText = false }) {
  const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([u8], { type: "image/png" }));
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);

  const LUT = Array.from({ length: 256 }, (_, v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = (r, gg, b) => 0.2126 * LUT[r] + 0.7152 * LUT[gg] + 0.0722 * LUT[b];
  const parse = (c) => {
    const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)/.exec(c ?? "");
    if (!m) return null;
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
    return { rgb: [Math.round(m[1]), Math.round(m[2]), Math.round(m[3])], a };
  };

  /** One part's pixels. Background = the most common colour in the rect (binned
   * to 4 bits a channel, so a gentle gradient is one bin). Ink = the painted
   * pixel that is closest to the colour the part SAYS it is (its computed
   * colour), among those that differ from the background at all: then white
   * text on a grey face reads as white on grey even when something darker is
   * drawn nearby. If the computed colour is translucent or nothing painted is
   * near it (a filter, a gradient clip), ink is the pixel furthest from the
   * background instead. Each is the third best, so one stray pixel cannot stand
   * for it: thin 12px text is mostly anti-aliased. A rect whose three biggest
   * bins cover under 35% is a picture: no background to read against. */
  const sample = (rx, ry, rw, rh, target, inner = null) => {
    const x0 = Math.max(0, Math.round(rx - ox));
    const y0 = Math.max(0, Math.round(ry - oy));
    const x1 = Math.min(bmp.width, Math.round(rx - ox + rw));
    const y1 = Math.min(bmp.height, Math.round(ry - oy + rh));
    const w = x1 - x0;
    if (w < 2 || y1 - y0 < 2) return null;
    const d = g.getImageData(x0, y0, w, y1 - y0).data;
    // With `inner` (a solid icon fills most of its own rect, so "most common" would be
    // the icon), the background is read from the ring around it and the ink from inside.
    const ix0 = inner ? Math.round(inner[0] - ox) - x0 : 0;
    const iy0 = inner ? Math.round(inner[1] - oy) - y0 : 0;
    const ix1 = inner ? Math.round(inner[2] - ox) - x0 : w;
    const iy1 = inner ? Math.round(inner[3] - oy) - y0 : y1 - y0;
    const inside = (i) => {
      const px = (i >> 2) % w;
      const py = Math.floor(i / 4 / w);
      return px >= ix0 && px < ix1 && py >= iy0 && py < iy1;
    };
    const bins = new Map();
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250 || (inner && inside(i))) continue;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const b = bins.get(k) ?? [0, 0, 0, 0];
      b[0]++;
      b[1] += d[i];
      b[2] += d[i + 1];
      b[3] += d[i + 2];
      bins.set(k, b);
      n++;
    }
    if (n < 8) return null;
    const list = [...bins.values()].map(([c, r, gg, b]) => ({ c, rgb: [Math.round(r / c), Math.round(gg / c), Math.round(b / c)] }));
    list.sort((a, b) => b.c - a.c);
    const top3 = list.slice(0, 3).reduce((s, b) => s + b.c, 0) / n;
    const bg = list[0].rgb;
    const bgL = lum(...bg);
    // Keep only the best three of each kind as the pixels go by.
    const far = []; // furthest from the background
    const near = []; // closest to the stated colour, among the differing
    const keep = (arr, item, better) => {
      if (arr.length < 3) arr.push(item);
      else if (better(item, arr[2])) arr[2] = item;
      else return;
      arr.sort((a, b) => (better(a, b) ? -1 : 1));
    };
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250 || (inner && !inside(i))) continue;
      const L = lum(d[i], d[i + 1], d[i + 2]);
      const r = (Math.max(L, bgL) + 0.05) / (Math.min(L, bgL) + 0.05);
      if (r < 1.05) continue;
      const px = [d[i], d[i + 1], d[i + 2]];
      keep(far, { r, px }, (a, b) => a.r > b.r);
      if (target) keep(near, { dist: Math.hypot(px[0] - target[0], px[1] - target[1], px[2] - target[2]), r, px }, (a, b) => a.dist < b.dist);
    }
    let pick = null;
    if (near.length === 3 && near[2].dist <= 80) pick = near[2];
    else if (far.length === 3) pick = far[2];
    return { bg, ink: pick?.px ?? bg, ratio: pick?.r ?? 1, picture: top3 < 0.35, n };
  };

  const SEL =
    'button, a[href], [role=button], [role=tab], [role=option], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=treeitem], [role=radio], [role=switch], [role=checkbox], [role=combobox], [role=link], input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, summary, [tabindex]:not([tabindex="-1"]), [class*="chip"]';

  const effectiveOpacity = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };

  /** The things a control shows: its own text, the elements that hold text
   * inside it, its icons. A field is its own part. */
  const partsOf = (el, isField) => {
    if (isField) return [el];
    const parts = [];
    const hasOwnText = (e) => [...e.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim());
    if (hasOwnText(el)) parts.push(el);
    for (const e of el.querySelectorAll("*")) {
      if (parts.length >= 14) break;
      if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue;
      const tg = e.tagName.toLowerCase();
      if (tg === "svg" || tg === "img" || hasOwnText(e)) parts.push(e);
    }
    return parts;
  };

  const measure = (el, i) => {
    const cs0 = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const isField = tag === "input" || tag === "textarea" || tag === "select";
    const text = isField ? el.value || el.placeholder || "" : (el.innerText || "").trim();
    const icon = !!el.querySelector('svg, img, [class*="icon"]') || tag === "svg";
    const label = (el.getAttribute("aria-label") || text || el.title || el.getAttribute("data-hint") || el.getAttribute("data-dest") || "").replace(/\s+/g, " ").trim().slice(0, 32);
    const classes = [...el.classList].filter((c) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9-]+)?(--[a-z0-9-]+)?$/.test(c) && !/^(flex|grid|inline|items|justify|gap|shrink|grow|rounded|border|font|text|bg|px|py|pt|pb|pl|pr|mt|mb|ml|mr|w|h|size|min|max|hidden|block|relative|absolute|transition|ease|whitespace|cursor|opacity|overflow|group|ring|outline|shadow|select|pointer|z|top|left|right|bottom|inset|space|truncate|underline|uppercase|tabular|leading|tracking|disabled|aria|data|hover|focus|dark|sm|md|lg|xl)(-|$)/.test(c));
    const hint = tag + (el.getAttribute("role") ? `[${el.getAttribute("role")}]` : "") + (classes.length ? "." + classes.slice(0, 2).join(".") : "") + (el.dataset.dest ? `[data-dest=${el.dataset.dest}]` : "");
    const base = { i, label, hint, kind: text ? "text" : "icon", need: text ? 4.5 : 3 };
    const r = el.getBoundingClientRect();
    if (cs0.visibility === "hidden" || cs0.display === "none" || r.width < 6 || r.height < 6) return { ...base, status: "gone" };
    if (!text && !icon) return { ...base, status: "empty" };
    if (effectiveOpacity(el) < 0.05) return { ...base, status: "gone" };
    const cx0 = Math.max(0, r.left);
    const cy0 = Math.max(0, r.top);
    const cx1 = Math.min(innerWidth, r.right);
    const cy1 = Math.min(innerHeight, r.bottom);
    if (cx1 - cx0 < 6 || cy1 - cy0 < 6) return { ...base, status: "gone" };
    if (((cx1 - cx0) * (cy1 - cy0)) / (r.width * r.height) < 0.5) return { ...base, status: "clipped" };
    const pts = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
    const onTop = pts.some(([px, py]) => {
      const hit = document.elementFromPoint(cx0 + (cx1 - cx0) * px, cy0 + (cy1 - cy0) * py);
      return hit && el.contains(hit);
    });
    if (!onTop) return { ...base, status: "covered" };
    const disabled = el.disabled || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled") || !!el.closest("fieldset:disabled");
    if (disabled) return { ...base, status: "disabled" };

    let worst = null;
    let sawPicture = false;
    let sawHidden = false;
    for (const part of partsOf(el, isField)) {
      const pcs = getComputedStyle(part);
      const pr = part.getBoundingClientRect();
      if (pcs.visibility === "hidden" || pcs.display === "none" || pr.width < 3 || pr.height < 3 || effectiveOpacity(part) < 0.05) continue;
      // The part, with a pixel of background around it, inside the control. (More
      // would swallow the page around a small badge that has a background of its own.)
      // A part with a box of its own (a badge, a pill) is read inside that box, a little in
      // from its edge, since its rect can be taller than what is painted.
      const bgc = parse(pcs.backgroundColor);
      const boxed = pcs.backgroundImage !== "none" || (bgc && bgc.a > 0.05);
      const pad = boxed && pr.width >= 10 && pr.height >= 10 ? -2 : 1;
      const x0 = Math.max(cx0, pr.left - pad);
      const y0 = Math.max(cy0, pr.top - pad);
      const x1 = Math.min(cx1, pr.right + pad);
      const y1 = Math.min(cy1, pr.bottom + pad);
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      // A poster, thumbnail or picture behind it: no single background to read against.
      const mx = (Math.max(cx0, pr.left) + Math.min(cx1, pr.right)) / 2;
      const my = (Math.max(cy0, pr.top) + Math.min(cy1, pr.bottom)) / 2;
      // A title that fades out where it is cut off (live.css, the last 22px), in a
      // box narrower than two fades: a letter of a programme that began before
      // the Guide's first column. Nothing is there to read, in Default either.
      if (pcs.maskImage.includes("gradient") && pr.width < 44) {
        sawHidden = true;
        continue;
      }
      // A part scrolled out of its list, or under something else (the last row
      // of a strip, half under the status bar): what is painted there is not it.
      const hit = document.elementFromPoint(mx, my);
      if (!hit || !(el.contains(hit) || part.contains(hit))) {
        sawHidden = true;
        continue;
      }
      if (document.elementsFromPoint(mx, my).some((e) => ["IMG", "PICTURE", "CANVAS"].includes(e.tagName) || getComputedStyle(e).backgroundImage.includes("url("))) {
        if (part.tagName.toLowerCase() !== "img") sawPicture = true;
        continue;
      }
      const ptag = part.tagName.toLowerCase();
      const isIcon = ptag === "svg" || ptag === "img";
      if (!isIcon && !isField && /^[\W_]*$/.test([...part.childNodes].filter((nd) => nd.nodeType === 3).map((nd) => nd.textContent).join(""))) continue;
      let color = pcs.color;
      if (ptag === "svg") {
        // The paint is the svg's or its shapes' (a path with a stroke of its
        // own, under an svg whose fill is the default black: read as black ink,
        // the changelog's Back arrow measured 1.06 against the page's dots).
        const paints = [pcs, ...[...part.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse")].map((e) => getComputedStyle(e))];
        const visible = (v) => (parse(v)?.a ?? 0) > 0;
        color = paints.map((p) => p.stroke).find(visible) ?? paints.slice(paints.length > 1 ? 1 : 0).map((p) => p.fill).find(visible) ?? pcs.color;
      }
      const c = parse(color);
      const target = c && c.a >= 0.99 && ptag !== "img" ? c.rgb : null;
      let s;
      if (isIcon) {
        const R = 3;
        const ox0 = Math.max(cx0, pr.left - R);
        const oy0 = Math.max(cy0, pr.top - R);
        const ox1 = Math.min(cx1, pr.right + R);
        const oy1 = Math.min(cy1, pr.bottom + R);
        s = sample(ox0, oy0, ox1 - ox0, oy1 - oy0, target, [pr.left, pr.top, pr.right, pr.bottom]);
      } else s = sample(x0, y0, x1 - x0, y1 - y0, target);
      if (!s) continue;
      if (s.picture) {
        sawPicture = true;
        continue;
      }
      const fs = parseFloat(pcs.fontSize);
      const fw = Number(pcs.fontWeight) || 400;
      const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
      // A placeholder is a hint inside an empty field, drawn grey on purpose
      // (Windows' own GrayText is 3.95:1 on white): held to the 3:1 of a graphic.
      const hintOnly = isField && !el.value;
      // Classic draws secondary text in Windows' GrayText, #808080: 3.95:1 on white and
      // 2.57:1 on the face. On white that is the system's own look and is held to 3:1;
      // on the face it still has to clear 3:1 and does not.
      const grayInk = grayText && s.ink.every((v) => Math.abs(v - 128) <= 4) && s.bg.every((v) => v >= 250);
      const need = isIcon || large || hintOnly || grayInk ? 3 : 4.5;
      const margin = s.ratio / need;
      if (!worst || margin < worst.margin) {
        const own = isField ? text : [...part.childNodes].filter((nd) => nd.nodeType === 3).map((nd) => nd.textContent).join(" ").replace(/\s+/g, " ").trim();
        worst = { margin, ratio: s.ratio, ink: s.ink, bg: s.bg, need, part: isIcon ? "icon" : own.slice(0, 24) };
      }
    }
    if (!worst) return { ...base, status: sawPicture ? "picture" : sawHidden ? "clipped" : "gone" };
    return { ...base, status: "ok", ratio: worst.ratio, ink: worst.ink, bg: worst.bg, need: worst.need, part: worst.part, rect: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] };
  };

  if (mode === "one") {
    const el = window.__cx[idx];
    if (!el?.isConnected) return { status: "gone" };
    return measure(el, idx);
  }

  const seen = new Set();
  window.__cx = [];
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    // The same box twice (a button wrapping a span with a tabindex): the outer one.
    const key = [r.x, r.y, r.width, r.height].map((n) => Math.round(n)).join();
    if (seen.has(key)) continue;
    seen.add(key);
    const i = window.__cx.length;
    window.__cx.push(el);
    const m = measure(el, i);
    m.scopes = scopes.filter((s) => el.closest(s));
    out.push(m);
  }
  return out;
}

const bad = (m) => m.status === "ok" && m.ratio < m.need;
const rgbs = (c) => `rgb(${c.join(",")})`;

/** One scene's accumulated numbers. */
class Tally {
  constructor() {
    this.measured = 0;
    this.hovered = 0;
    this.skips = {};
    this.failing = [];
  }
  add(list, tag) {
    for (const m of list) {
      if (m.status === "ok") {
        this.measured++;
        if (bad(m)) this.failing.push({ ...m, tag });
      } else if (["disabled", "picture", "covered", "clipped"].includes(m.status)) this.skips[m.status] = (this.skips[m.status] ?? 0) + 1;
    }
  }
}

/**
 * Measure the page as it is. `hover` lists scopes (CSS selectors): every
 * measured control inside one is hovered and measured again.
 */
async function look(page, tally, { tag = "", hover = [], cap = 60 } = {}) {
  await settle(page);
  const png = await page.screenshot();
  const shot = png.toString("base64");
  if (process.env.SHOT) (await import("node:fs")).writeFileSync(`${process.env.SHOT}/${CUR.replace(/[^a-z0-9]+/gi, "-")}${tag ? "-" + tag.replace(/\W+/g, "") : ""}.png`, png);
  const list = await page.evaluate(inPage, { mode: "all", b64: shot, scopes: hover, grayText: page.__classic });
  tally.add(list, tag);
  if (process.env.DUMP) for (const m of list) console.log(`    ${m.status.padEnd(8)} ${m.ratio?.toFixed(2) ?? "-"} "${m.label}" ${m.hint}`);
  if (!hover.length) return list;
  const targets = list.filter((m) => m.status === "ok" && m.scopes.length).slice(0, cap);
  for (const t of targets) {
    const [x, y] = t.rect;
    await page.mouse.move(x, y);
    await page.waitForTimeout(90);
    // Re-read the box: a hover can move it.
    const box = await page.evaluate((i) => {
      const e = window.__cx[i];
      if (!e?.isConnected) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.max(0, Math.floor(r.x) - 2), y: Math.max(0, Math.floor(r.y) - 2), w: Math.ceil(r.width) + 4, h: Math.ceil(r.height) + 4 };
    }, t.i);
    if (!box) continue;
    const clip = { x: box.x, y: box.y, width: Math.min(box.w, 1600 - box.x), height: Math.min(box.h, 900 - box.y) };
    if (clip.width < 4 || clip.height < 4) continue;
    const b64 = (await page.screenshot({ clip })).toString("base64");
    const m = await page.evaluate(inPage, { mode: "one", b64, ox: clip.x, oy: clip.y, idx: t.i, grayText: page.__classic });
    if (m.status === "ok") {
      tally.hovered++;
      if (bad(m)) tally.failing.push({ ...m, tag: `${tag ? tag + " " : ""}hover` });
    }
  }
  await page.mouse.move(800, 300);
  return list;
}

// What's New is a page of words with one button, and its changelog has one
// more: two is all there is to find.
const MIN = { "What's New": 2 };
/** Print one scene's verdict. */
function verdict(face, scene, tally) {
  const name = `${face.id}: ${scene}`;
  const skipped = Object.entries(tally.skips).map(([k, v]) => `${v} ${k}`).join(", ");
  const detail = `${tally.measured} controls${tally.hovered ? ` + ${tally.hovered} hovered` : ""}${skipped ? ` (not measured: ${skipped})` : ""}`;
  if (tally.measured < (MIN[scene] ?? 3)) return check(name, false, `only ${tally.measured} controls found${skipped ? ` (${skipped})` : ""}`);
  if (tally.failing.length) {
    const under3 = tally.failing.filter((f) => f.ratio < 3).length;
    check(name, false, `${tally.failing.length} below the bar (${under3} of them under 3:1) of ${detail}`);
    const seen = new Set();
    for (const f of tally.failing) {
      const k = `${f.tag}|${f.label}|${f.part}|${f.hint}|${f.ink}|${f.bg}`;
      if (seen.has(k)) continue;
      seen.add(k);
      note(`${f.tag ? `[${f.tag}] ` : ""}"${f.label}"${f.part && f.part !== f.label ? ` (${f.part})` : ""} ${f.hint}: ink ${rgbs(f.ink)} on ${rgbs(f.bg)} = ${f.ratio.toFixed(2)} (needs ${f.need}${f.ratio >= 3 ? ", marginal" : ""})`);
    }
    return;
  }
  check(name, true, detail);
}

// ------------------------------------------------------------------ scenes
const bar = (face) => (face.pack === "classic" ? ".cl-tools" : ".flc-pane");
const settingsBtn = (face) => (face.pack === "classic" ? '[data-cl="settings"]' : '.flc-pane [data-key="settings"]');
const SETTINGS_ROOT = ".settings, .flc-sx";
const TABS = ["home", "sources", "playback", "appearance", "accounts", "app"];
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);

/** Close dialogs and menus, and be on the Home screen. */
async function reset(page) {
  for (let i = 0; i < 3; i++) {
    const up = await page.evaluate(() => !!document.querySelector('[role="dialog"], [role="menu"], .palette--classic, .flc-flyout'));
    if (!up) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  await goTo(page, "hub");
  await page.locator('main[data-screen="hub"]').waitFor({ timeout: 8000 });
  await page.mouse.move(800, 300);
}

async function openSettings(page, face, tab) {
  if (!(await page.locator(SETTINGS_ROOT).count())) {
    await page.locator(settingsBtn(face)).click();
    await page.locator(SETTINGS_ROOT).first().waitFor();
  }
  await page.locator(`[data-rail="${tab}"]`).click();
  await page.locator(`[role="tabpanel"][aria-label="${cap1(tab)}"]`).waitFor();
  await settle(page, 400);
}

/** Scroll the biggest scroller inside `root` one page; false at the end. */
const scrollPage = (page, root) =>
  page.evaluate((root) => {
    const r = document.querySelector(root);
    const els = [r, ...r.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    const el = els.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!el) return false;
    const before = el.scrollTop;
    el.scrollTop += el.clientHeight - 80;
    return el.scrollTop > before + 5;
  }, root);

const wake = async (page) => {
  await page.mouse.move(800, 300);
  await page.mouse.move(820, 330);
  await page.waitForTimeout(300);
};

// A scene: `ctx` groups scenes that share a page; `run(page, face, t)` gets it
// on screen and calls look() on each view it wants measured.
const SCENES = [];
const scene = (ctx, name, run) => SCENES.push({ ctx, name, run });

const NAV_HOVER = (face) => [bar(face)];

// ---- the stream side ----
scene("stream", "Home", async (page, face, t) => {
  await goTo(page, "hub");
  await page.locator('main[data-screen="hub"]').waitFor();
  await look(page, t, { hover: NAV_HOVER(face) });
});
scene("stream", "Stream home", async (page, face, t) => {
  await goTo(page, "home");
  await page.locator(".stream-card").first().waitFor({ timeout: 30_000 });
  await look(page, t, { hover: NAV_HOVER(face) });
});
const openTitle = async (page, name) => {
  await goTo(page, "home");
  await page.locator(".stream-card", { hasText: name }).first().waitFor({ timeout: 30_000 });
  await page.locator(".stream-card", { hasText: name }).first().click();
  // The title page: its sources or episodes load from the fake addon.
  await page.waitForFunction((n) => !!document.querySelector('main') && document.body.innerText.includes(n) && !document.querySelector(".stream-card"), name, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1800);
};
scene("stream", "Film page", async (page, face, t) => {
  await openTitle(page, "Fake Movie One");
  await look(page, t);
  if (await scrollPage(page, "main.app-main")) await look(page, t, { tag: "scrolled" });
  await page.keyboard.press("Escape");
});
scene("stream", "Series page", async (page, face, t) => {
  await openTitle(page, "Fake Series One");
  await look(page, t);
  const s2 = page.getByText("Season 2", { exact: true }).first();
  if (await s2.count()) {
    await s2.click();
    await look(page, t, { tag: "season 2" });
  }
  await page.keyboard.press("Escape");
});
scene("stream", "Discover", async (page, face, t) => {
  await goTo(page, "discover");
  await page.locator(".cl-disc-thumb, .disc-grid .stream-card, .stream-card").first().waitFor({ timeout: 20_000 });
  await look(page, t);
});
scene("stream", "REC", async (page, face, t) => {
  await goTo(page, "discover");
  const rec = page.getByRole("button", { name: /Find something to watch/i }).first();
  await rec.waitFor({ timeout: 10_000 });
  await rec.click();
  await page.locator(".rec__input, .cl-rec-wiz, .rec").first().waitFor({ timeout: 8000 });
  await settle(page, 500);
  await look(page, t);
});
scene("stream", "Library", async (page, face, t) => {
  await goTo(page, "mylist");
  await look(page, t);
});
for (const tab of TABS)
  scene("stream", `Settings ${cap1(tab)}`, async (page, face, t) => {
    await openSettings(page, face, tab);
    await look(page, t);
    for (let n = 1; n <= 4 && (await scrollPage(page, SETTINGS_ROOT)); n++) await look(page, t, { tag: `page ${n + 1}` });
  });
scene("stream", "Settings App Replay Setup", async (page, face, t) => {
  // The setup walk-through's button: the scene is Settings → App with the button's row on screen.
  await openSettings(page, face, "app");
  const b = page.getByRole("button", { name: /Replay Setup|Replay/i }).first();
  await b.scrollIntoViewIfNeeded();
  await look(page, t);
});
scene("stream", "Go To", async (page, face, t) => {
  await page.keyboard.press("Control+k");
  await page.locator(face.pack === "classic" ? ".palette--classic" : ".flc-flyout").waitFor();
  await page.keyboard.type("fake");
  await settle(page, 700);
  await look(page, t);
});

// ---- live TV ----
scene("live", "Guide", async (page, face, t) => {
  await goTo(page, "guide");
  await page.locator(".guide__card").first().waitFor({ timeout: 30_000 });
  await look(page, t, { hover: NAV_HOVER(face) });
});
scene("live", "Guide context menu", async (page, face, t) => {
  await page.locator(".guide__cell:not(.guide__cell--blank)").nth(1).click({ button: "right" });
  await page.getByRole("menu").waitFor();
  await look(page, t);
  await page.keyboard.press("Escape");
});
scene("live", "Mini player", async (page, face, t) => {
  await page.locator(".guide__card").nth(2).click();
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => {
    window.__presenting = true;
    window.__audio = [{ id: 1, title: "English", lang: "eng", selected: true }, { id: 2, title: "Spanish", lang: "spa", selected: false }];
    window.__subs = [{ id: 1, title: "English", lang: "eng", selected: false }];
  });
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.locator(".mini-overlay").hover({ position: { x: 200, y: 140 } });
  await look(page, t, { hover: [".mini-overlay"] });
});
scene("live", "Theater", async (page, face, t) => {
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await wake(page);
  await look(page, t, { hover: [".theater-overlay"] });
});
scene("live", "Mini-guide strip", async (page, face, t) => {
  await wake(page);
  await page.keyboard.press("g");
  await page.locator(".mg-strip").waitFor({ timeout: 3000 });
  await look(page, t, { hover: [".mg-strip", ".theater-overlay"] });
});
scene("live", "Mini-guide list", async (page, face, t) => {
  const tg = page.getByRole("radio", { name: "List" }).or(page.getByRole("tab", { name: "List" })).or(page.getByRole("button", { name: "List" })).first();
  await tg.click();
  await page.locator(".mg-list").waitFor({ timeout: 3000 });
  await look(page, t, { hover: [".mg-list"] });
  await page.keyboard.press("Escape");
});

// ---- sports ----
scene("sports", "Sports", async (page, face, t) => {
  await goTo(page, "sports");
  await page.getByText("Bears").first().waitFor({ timeout: 20_000 });
  await look(page, t, { hover: NAV_HOVER(face) });
});
scene("sports", "Sports game theater rail", async (page, face, t) => {
  await page.locator('button[data-game$="-n1"]').first().click();
  await page.locator(".sportstheater").waitFor({ timeout: 10_000 });
  // The rail lists the channels showing the game once they have loaded.
  await page.locator(".sportstheater").getByText("Channels").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await wake(page);
  await look(page, t, { hover: [".sportstheater"] });
});

// ---- Multi-View ----
scene("mv", "Multi-View with a tile", async (page, face, t) => {
  await goTo(page, "multiview");
  await page.waitForTimeout(800);
  const empty = page.locator(".mvtile--empty");
  if (await empty.count()) await empty.first().click();
  else await page.locator(".mvbar__add").click();
  await page.locator(".mvpick__input").waitFor({ timeout: 5000 });
  await page.locator(".mvpick__input").fill("Fake");
  await page.locator(".mvpick__row").first().waitFor();
  await page.locator(".mvpick__row").first().click();
  await page.locator(".mvtile:not(.mvtile--empty)").first().waitFor({ timeout: 8000 });
  await wake(page);
  await look(page, t, { hover: [".mvtile", ".mvbar"] });
});

// ---- first run ----
scene("onboarding", "Onboarding", async (page, face, t) => {
  await page.evaluate(() => sessionStorage.removeItem("btv:welcome-played"));
  await page.locator(".onb-btn:visible").first().waitFor({ timeout: 20_000 });
  for (let step = 1; step <= 5; step++) {
    await settle(page, 1200);
    await look(page, t, { tag: `step ${step}`, hover: [".onb, [class*=onb]"] });
    const b = page.locator(".onb-btn:visible").first();
    if (!(await b.count())) break;
    await b.click().catch(() => {});
    await page.waitForTimeout(900);
  }
});
scene("whatsnew", "What's New", async (page, face, t) => {
  await page.locator(".wn-eyebrow, .onb-btn").first().waitFor({ timeout: 25_000 });
  await settle(page, 1500);
  await look(page, t, { hover: ["[class*=wn-], .onb-btn"] });
  // The page has two buttons; the changelog it opens has its own.
  await page.getByRole("button", { name: /Changelog/i }).first().click();
  await settle(page, 800);
  await look(page, t, { tag: "changelog", hover: ["[class*=wn-], .onb-btn"] });
});

const CTX = {
  stream: (b, f) => open(b, { ...f, startup: "stream" }),
  live: (b, f) => open(b, { ...f, startup: "live", pins: true }),
  sports: (b, f) => open(b, { ...f, startup: "live" }),
  mv: (b, f) => open(b, { ...f, startup: "live" }),
  onboarding: (b, f) => open(b, { ...f, onboarded: false }),
  whatsnew: (b, f) => open(b, { ...f, whats: "1.0", version: "1.2.9" }),
};
const READY = {
  stream: ".stream-card",
  live: ".guide__card",
  sports: "[data-dest]",
  mv: "[data-dest]",
  onboarding: "body",
  whatsnew: "body",
};

// ---------------------------------------------------------------------- run
const summary = [];
for (const face of FACES) {
  const t0 = Date.now();
  console.log(`\n== ${face.id} ==`);
  let measured = 0;
  const skips = {};
  for (const cx of Object.keys(CTX)) {
    const mine = SCENES.filter((s) => s.ctx === cx && WANT_SCENE(s.name));
    if (!mine.length) continue;
    let ctx, page;
    try {
      ({ ctx, page } = await CTX[cx](browser, { pack: face.pack, light: face.light }));
      await page.waitForSelector(READY[cx], { timeout: 30_000 });
    } catch (e) {
      for (const s of mine) check(`${face.id}: ${s.name}`, false, `could not start: ${String(e.message ?? e).split("\n")[0]}`);
      await ctx?.close();
      continue;
    }
    for (const s of mine) {
      const t = new Tally();
      const tScene = Date.now();
      CUR = `${face.id} ${s.name}`;
      try {
        if (cx === "stream") await reset(page);
        await s.run(page, face, t);
      } catch (e) {
        check(`${face.id}: ${s.name}`, false, `could not reach it: ${String(e.message ?? e).split("\n")[0].slice(0, 200)}`);
        await page.keyboard.press("Escape").catch(() => {});
        continue;
      }
      verdict(face, s.name, t);
      if (TIMING) console.log(`    scene took ${((Date.now() - tScene) / 1000).toFixed(1)}s`);
      measured += t.measured;
      for (const [k, v] of Object.entries(t.skips)) skips[k] = (skips[k] ?? 0) + v;
    }
    await ctx.close();
  }
  summary.push(`${face.id}: ${measured} controls measured; not measured: ${Object.entries(skips).map(([k, v]) => `${v} ${k}`).join(", ") || "none"} (disabled controls are exempt, as WCAG has it)`);
  console.log(`(${face.id} took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log("\ncoverage:");
for (const s of summary) note(s);

// ------------------------------------------------------------ scrollbar gutters
// Headless Chromium hides scrollbars, which would hide this whole class of
// bug, so this one section runs in a browser that keeps them.
if (!process.env.SCENES && !process.env.FACES) {
  const sb = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", ignoreDefaultArgs: ["--hide-scrollbars"] });
  const PACKS = [null, "prism", "velvet", "lagoon", "fluent", "classic"];
  /** Runs in the page: every scroller (key -> its two gutters) and whether the
   * page itself scrolls sideways. */
  const gutters = () => {
    const out = {};
    const skip = /^(flex|grid|inline|items|justify|gap|shrink|grow|rounded|border|font|text|bg|px|py|pt|pb|pl|pr|mt|mb|ml|mr|w|h|size|min|max|hidden|block|relative|absolute|transition|overflow|snap|scroll|z|top|left|right|bottom|inset|space|truncate)(-|$)/;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (!/auto|scroll/.test(cs.overflowX + cs.overflowY)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 30 || cs.display === "none" || cs.visibility === "hidden") continue;
      const key = el.tagName.toLowerCase() + "." + [...el.classList].filter((c) => /^[a-z][a-z0-9-]*(__[a-z0-9-]+)?$/.test(c) && !skip.test(c)).slice(0, 2).join(".");
      const b = (p) => parseFloat(cs[p]) || 0;
      const g = { h: Math.round(el.offsetHeight - el.clientHeight - b("borderTopWidth") - b("borderBottomWidth")), v: Math.round(el.offsetWidth - el.clientWidth - b("borderLeftWidth") - b("borderRightWidth")) };
      (out[key] ??= []).push(g);
    }
    const de = document.documentElement;
    const main = document.querySelector("main.app-main");
    return { gutters: out, pageSideways: de.scrollWidth > de.clientWidth + 1, mainSideways: !!main && main.scrollWidth > main.clientWidth + 1 };
  };
  const SB_SCENES = [
    ["Stream home", { startup: "stream", pins: false }, async (p) => p.locator(".media-row .stream-card, .stream-card").first().waitFor({ timeout: 30_000 })],
    ["Guide", { startup: "live", pins: true }, async (p) => p.locator(".guide__card").first().waitFor({ timeout: 30_000 })],
    [
      "Film page",
      { startup: "stream", pins: false },
      async (p) => {
        await p.locator(".stream-card", { hasText: "Fake Movie One" }).first().waitFor({ timeout: 30_000 });
        await p.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
        await p.waitForTimeout(3000);
      },
    ],
  ];
  const seen = {};
  for (const pack of PACKS) {
    for (const [name, opts, go] of SB_SCENES) {
      const { ctx, page } = await open(sb, { pack, light: false, ...opts });
      try {
        await go(page);
        await settle(page, 600);
        (seen[name] ??= {})[pack ?? "default"] = await page.evaluate(gutters);
      } catch (e) {
        (seen[name] ??= {})[pack ?? "default"] = { error: String(e.message ?? e).split("\n")[0] };
      }
      await ctx.close();
    }
  }
  console.log("\n== scrollbar gutters (a browser that keeps its scrollbars) ==");
  for (const [name] of SB_SCENES) {
    const base = seen[name].default;
    if (base.error) {
      check(`gutters: ${name}, Default loaded`, false, base.error);
      continue;
    }
    check(`gutters: ${name}, Default has scrollers to compare`, Object.keys(base.gutters).length > 0, `${Object.keys(base.gutters).length} scrollers`);
    for (const pack of PACKS.slice(1)) {
      const got = seen[name][pack];
      if (got.error) {
        check(`gutters: ${name}, ${pack}`, false, got.error);
        continue;
      }
      const diffs = [];
      const widths = [];
      let compared = 0;
      for (const [key, list] of Object.entries(base.gutters)) {
        const mine = got.gutters[key];
        if (!mine) continue;
        compared++;
        const sig = (l, k) => [...new Set(l.map((g) => g[k]))].sort().join("|");
        // A horizontal bar where Default has none is the bug. A pack's own width for a
        // vertical bar (Classic's 16px, Fluent's 10px) is its look, so it is only noted.
        if (sig(list, "h") !== sig(mine, "h")) diffs.push(`${key}: horizontal bar ${sig(list, "h")}px in Default, ${sig(mine, "h")}px in ${pack}`);
        if (sig(list, "v") !== sig(mine, "v")) widths.push(`${key}: vertical bar ${sig(list, "v")}px in Default, ${sig(mine, "v")}px in ${pack} (the pack's own scrollbar)`);
      }
      const extra = [];
      if (got.pageSideways && !base.pageSideways) extra.push("the page scrolls sideways");
      if (got.mainSideways && !base.mainSideways) extra.push("the screen scrolls sideways");
      check(`gutters: ${name}, ${pack} matches Default (${compared} scrollers compared)`, compared > 0 && !diffs.length && !extra.length, compared === 0 ? "no scroller in common to compare" : "");
      for (const d of diffs) note(d);
      for (const e of extra) note(e);
      for (const w of widths) note(w);
    }
  }
  await sb.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`(took ${((Date.now() - T0) / 1000).toFixed(1)}s)`);
await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
