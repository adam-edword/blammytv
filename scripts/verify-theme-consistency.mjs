// E2E: the same piece looks the same everywhere (plan 035, "Rule: the same
// piece looks the same everywhere"). In a tier 2 or 3 theme every repeated
// piece of chrome measures the same wherever it shows up: a dialog's title
// bar, its tab strip, a section heading, a setting row, a push button, a text
// field, a combo box, a menu item, a tree row, the page title, the toolbar's
// current tab.
//
// Why this exists: Classic's Settings title bar measured 15 to 23px tall
// depending on the tab (the content squeezed it) and every harness passed,
// because each one checks its own feature and none compares one screen with
// another. This one does. It visits every place a piece appears, per theme,
// records computed metrics, and fails on any difference.
//
// HOW IT READS. Two tables, and a new screen or dialog in a themed pack is one
// line in each (or in ROUTES alone, when its pieces are already listed):
//   ROUTES  where you can go: a name and how to get there.
//   PIECES  what to measure: the metrics to compare, and for each theme the
//           [route, selector, scope] places where the piece shows up.
// A piece found in fewer than two places is a FAILED check, not a pass. A
// route that cannot be reached here (real video, a Windows build) is declared
// with `skip` and printed, never dropped. The app is only looked at: nothing
// is typed or saved beyond opening things.
//
// Metrics are computed styles and layout sizes. A piece lists the ones that
// must match; sizes are exact (the page's own integer layout size), apart from
// positions and right edges, which get a pixel. When a piece is missing from a
// place that should have it (a dialog with no title bar), that place reads
// "absent" and differs from the rest.
//
// Packs measured: Classic (one face), Fluent Dark and Fluent Light. Prism,
// Velvet, Lagoon and Aero are colour and type only (tier 2, no chrome of their
// own), so there is nothing of theirs to compare.
//
// Offline: the fake M3U, Xtream panel and AIOStreams; ESPN and TMDB answered
// in the shapes the app parses; every other host aborted.
//
//   node scripts/fake-m3u.mjs; node scripts/fake-panel.mjs; node scripts/fake-aio.mjs
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-theme-consistency.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};
// Detail lines under a check. They must not start with a tick word: the board
// counts those.
const note = (s) => console.log(`  - ${s}`);

const PLAYLISTS = [
  { kind: "xtream", id: "fx", name: "Fix Line", enabled: true, server: "http://localhost:8081", username: "fix", password: "p" },
  { kind: "m3u", id: "m", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" },
];
const AIO = "http://localhost:8084/manifest.json";

// ESPN, as verify-classic-sports serves it: an NFL board (live, final, to come,
// and one tomorrow) and an NBA game, so Sports has days, tiles and a tree.
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
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...board, events }) });
};
const tmdb = (route) => {
  const u = new URL(route.request().url());
  let body = {};
  if (u.pathname.includes("/genre/")) body = { genres: [] };
  else if (u.pathname.endsWith("/search/keyword")) body = { results: [{ id: 10051, name: u.searchParams.get("query") }] };
  else if (u.pathname.includes("/discover/")) body = { results: [{ id: 348, title: "Alien", release_date: "1979-05-25" }] };
  else if (u.pathname.includes("external_ids")) body = { imdb_id: "tt100001" };
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function open({ pack, light }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: light ? "light" : "dark", reducedMotion: "reduce" });
  await ctx.route(
    (u) => !["localhost", "127.0.0.1"].includes(u.hostname),
    (r) => {
      const u = r.request().url();
      if (u.includes("site.api.espn.com")) return espn(r);
      if (u.includes("api.themoviedb.org")) return tmdb(r);
      return r.abort();
    },
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${pack}: ${e}`));
  await page.addInitScript(
    ({ pack, light, PLAYLISTS, AIO }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        const put = (k, v) => localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
        put("playlists", PLAYLISTS);
        put("aiostreams", AIO);
        put("themePack", pack);
        put("startupTab", "stream");
        put("tmdbKey", "harness-key");
        put("sports-follows", { leagues: ["football/nfl", "basketball/nba"], teams: [] });
        if (light) put("theme", "light");
      }
    },
    { pack, light, PLAYLISTS, AIO },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cl-header, .flc-title", { timeout: 20_000 });
  return { ctx, page };
}

// ---------------------------------------------------------------- measuring
// What a piece is compared on. A name starting with "@" is a box measure, not
// a style: @h and @w are layout sizes (no transforms), @x and @y the position,
// @rr the gap from the element's right edge to its container's inner edge (a
// scrollbar does not count). "::before:width" reads a pseudo-element.
const TEXT = ["font-size", "font-weight", "font-family", "color", "line-height", "text-transform", "letter-spacing"];
const FRAME = ["border-top-width", "border-top-style", "border-top-color", "border-radius", "box-shadow", "background-color"];
const TOL = { "@x": 1, "@y": 1, "@rr": 1 };

/** Runs in the page: the first drawn match of `sel` (one per value of `split`
 * when given) inside the first drawn `scope`, and the metrics asked for. A
 * scope ending in "|last" takes the last drawn one (the top dialog). */
function measureInPage({ scope, sel, props, split, rel, fn }) {
  const drawn = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden";
  };
  let root = document.body;
  if (scope) {
    const last = scope.endsWith("|last");
    const found = [...document.querySelectorAll(last ? scope.slice(0, -5) : scope)].filter(drawn);
    root = last ? found.at(-1) : found[0];
  }
  if (!root) return { __scope: true };
  const read = (el) => {
    if (fn) return new Function("el", "root", `return (${fn})(el, root)`)(el, root);
    const out = {};
    for (const p of props) {
      let pseudo,
        name = p;
      const m = /^(::[a-z-]+):(.+)$/.exec(p);
      if (m) [, pseudo, name] = m;
      if (name === "@h") out[p] = el.offsetHeight;
      else if (name === "@w") out[p] = el.offsetWidth;
      else if (name === "@x") out[p] = Math.round(el.getBoundingClientRect().x * 2) / 2;
      else if (name === "@y") out[p] = Math.round(el.getBoundingClientRect().y * 2) / 2;
      else if (name === "@rr") {
        const box = (rel ? el.closest(rel) : null) ?? root;
        const inner = box.getBoundingClientRect().left + box.clientLeft + box.clientWidth;
        out[p] = Math.round((inner - el.getBoundingClientRect().right) * 2) / 2;
      } else out[p] = getComputedStyle(el, pseudo).getPropertyValue(name);
    }
    return out;
  };
  const all = [...root.querySelectorAll(sel)];
  if (root.matches?.(sel)) all.unshift(root);
  const els = all.filter(drawn);
  if (!els.length) return {};
  if (!split) return { "": read(els[0]) };
  const out = {};
  for (const el of els) {
    // @tag: the element (and an input's type). @kind: a button's size and its
    // variant, which for the pack's own buttons is the class that marks the
    // default or accent one.
    const k =
      split === "@tag"
        ? el.tagName.toLowerCase() + (el.type && el.tagName === "INPUT" ? `:${el.type}` : "")
        : split === "@kind"
          ? `${el.getAttribute("data-size") ?? "-"}/${el.getAttribute("data-variant") ?? (/--?(accent|def)\b/.test(el.className) ? "accent" : "plain")}`
          : (el.getAttribute(split) ?? "-");
    if (!(k in out)) out[k] = read(el);
  }
  return out;
}

async function settle(page) {
  await page
    .waitForFunction(
      () => !document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity),
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  await page.waitForTimeout(150);
}

// ------------------------------------------------------------------ routes
// Where you can go. `go(page, pack)` leaves the app showing the place; the
// harness closes whatever is open before the next one, so a route need not
// undo itself. `packs` limits a route to a theme ("classic" or "fluent");
// `skip` is the reason a place cannot be reached here.
const ROUTES = {};
const route = (name, go, opts = {}) => (ROUTES[name] = { go, ...opts });

const TABS = ["home", "sources", "playback", "appearance", "accounts", "app"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const bar = (pack) => (pack === "classic" ? ".cl-tools" : ".flc-pane");

/** The Multi-View notice is a dialog nothing but its button dismisses. */
async function acceptNotice(page) {
  const b = page.locator(".mvnotice__accept");
  if (await b.count()) await b.click();
  await page.locator(".mvnotice__accept").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}

/** Close whatever is open, and be on a base screen. */
async function reset(page, pack) {
  await acceptNotice(page);
  for (let i = 0; i < 3; i++) {
    const up = await page.evaluate(() => !!document.querySelector('[role="dialog"], [role="menu"]'));
    if (!up) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  await page.locator(`${bar(pack)} [data-dest="hub"]`).click();
  await page.locator('main[data-screen="hub"]').waitFor({ timeout: 8000 });
  if (pack === "fluent") await page.locator(".flc-sx").waitFor({ state: "detached", timeout: 5000 });
}

async function nav(page, pack, dest) {
  await page.locator(`${bar(pack)} [data-dest="${dest}"]`).click();
  await page.locator(`main[data-screen="${dest}"]`).waitFor({ timeout: 8000 });
}

// Settings: a sheet over the screen in Classic, a page in Fluent. Same six tabs.
for (const t of TABS)
  route(`Settings/${cap(t)}`, async (page, pack) => {
    const root = pack === "classic" ? "section.settings" : ".flc-sx";
    if (!(await page.locator(root).count())) {
      await page.locator(pack === "classic" ? '[data-cl="settings"]' : '.flc-pane [data-key="settings"]').click();
      await page.locator(root).waitFor();
    }
    await page.locator(`[data-rail="${t}"]`).click();
    await page.locator(`[role="tabpanel"][aria-label="${cap(t)}"]`).waitFor();
    await settle(page);
  });

route("Go To", async (page, pack) => {
  await page.keyboard.press("Control+k");
  await page.locator(pack === "classic" ? ".palette--classic" : ".flc-flyout").waitFor();
  await settle(page);
});

route("Multi-View intro", async (page, pack) => {
  await nav(page, pack, "multiview");
  await page.locator(".mvnotice__accept").waitFor();
  await settle(page);
});

route("Import Layout", async (page, pack) => {
  await page.locator(pack === "classic" ? '[data-cl="settings"]' : '.flc-pane [data-key="settings"]').click();
  await page.locator(`[data-rail="home"]`).click();
  await page.getByRole("button", { name: "Import Layout" }).click();
  await page.locator('[data-slot="dialog-title"]', { hasText: "Import Layout" }).waitFor();
  await settle(page);
});

const GUIDE = ".guide__row";
route("Guide", async (page, pack) => {
  await nav(page, pack, "guide");
  await page.locator(`${GUIDE}[data-channel^="fx:"]`).first().waitFor({ timeout: 30_000 });
  await settle(page);
});
const channelCard = (page) => page.locator(`${GUIDE}[data-channel^="fx:"] .guide__card`).first();
route("Fix Guide", async (page, pack) => {
  await ROUTES.Guide.go(page, pack);
  await channelCard(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fix Guide…" }).click();
  await page.locator('[data-slot="dialog-title"]', { hasText: /Fix/ }).waitFor();
  await settle(page);
});
route("Menu/Channel", async (page, pack) => {
  await ROUTES.Guide.go(page, pack);
  await channelCard(page).click({ button: "right" });
  await page.getByRole("menu").waitFor();
});
route("Menu/Programme", async (page, pack) => {
  await ROUTES.Guide.go(page, pack);
  await page.locator(`${GUIDE}[data-channel^="fx:"] .guide__cell:not(.guide__cell--blank)`).first().click({ button: "right" });
  await page.getByRole("menu").waitFor();
});
route("Menu/Add Row", async (page, pack) => {
  await ROUTES["Settings/Home"].go(page, pack);
  await page.getByRole("button", { name: "Add Row" }).click();
  await page.getByRole("menu").waitFor();
});
route("Menu/Folder", async (page, pack) => {
  await ROUTES.Guide.go(page, pack);
  await page.locator(pack === "classic" ? ".cl-tv__row" : ".fl-folders__group .fl-nav", { hasText: "News" }).first().click({ button: "right" });
  await page.getByRole("menu").waitFor();
});

route("Home screen", async (page, pack) => {
  await nav(page, pack, "hub");
  await settle(page);
});
route("Stream screen", async (page, pack) => {
  await nav(page, pack, "home");
  await settle(page);
});
route("Discover", async (page, pack) => {
  await nav(page, pack, "discover");
  await page.locator(".cl-disc-thumb, .disc-grid .stream-card").first().waitFor({ timeout: 20_000 });
  await settle(page);
});
route("Library", async (page, pack) => {
  await nav(page, pack, "mylist");
  await settle(page);
});
route("Sports", async (page, pack) => {
  await nav(page, pack, "sports");
  await page.getByText("Lions").first().waitFor({ timeout: 20_000 });
  await settle(page);
});
route("Film", async (page, pack) => {
  await ROUTES.Discover.go(page, pack);
  await page.locator(".cl-disc-thumb, .disc-grid .stream-card", { hasText: "Fake Movie Two" }).first().click();
  await page.locator(".clt-srcs, .fls-title").first().waitFor({ timeout: 20_000 });
  await settle(page);
});
route("REC wizard", async (page, pack) => {
  await ROUTES.Discover.go(page, pack);
  await page.locator(".cl-band .cl-rec").click();
  await page.locator(".cl-rec-wiz").waitFor();
  await settle(page);
}, { packs: ["classic"] });
route("Record dialog", async () => {}, { skip: "it opens from the player, which needs mpv and real video" });

// Where the toolbar or the pane lights each tab.
const DESTS = [["hub", "Home"], ["guide", "Live TV"], ["multiview", "Multi-View"], ["sports", "Sports"], ["home", "Stream"], ["discover", "Discover"], ["mylist", "Library"]];
for (const [dest, label] of DESTS)
  route(`Nav/${label}`, async (page, pack) => {
    await nav(page, pack, dest);
    await acceptNotice(page);
    await settle(page);
  });

// ------------------------------------------------------------------ pieces
// props: what to compare. places: per theme, [route, selector, scope, label?].
// A scope narrows to the first drawn container with that selector inside the
// route, so the toolbar and the pane are never read as the page. One selector
// per route per piece; use a list in the selector when a place has variants.
const PIECES = {};
const piece = (name, def) => (PIECES[name] = def);
const SET = TABS.map((t) => `Settings/${cap(t)}`);
const at = (routes, sel, scope) => routes.map((r) => [r, sel, scope]);
const BODY = { classic: ".settings__body", fluent: ".flc-sx__page" };
const setting = (sel, only = SET) => ({ classic: at(only, sel, BODY.classic), fluent: at(only, sel, BODY.fluent) });
const SCREENS = ["Home screen", "Stream screen", "Discover", "Library", "Sports", "Guide", "Film"];
const DIALOGS = ["Import Layout", "Fix Guide", "Multi-View intro"];
const TOP = "[role=dialog]|last";

// ---- dialogs --------------------------------------------------------------
piece("dialog title bar", {
  props: [...TEXT, "@h", "padding", "background-image", "background-color"],
  places: {
    classic: [...at(SET, ".cl-title", "section.settings"), ["Go To", ".cl-title", ".palette--classic"], ["REC wizard", ".cl-rec-title", ".cl-rec-wiz"], ...at(DIALOGS, ".cl-title, .cl-rec-title", TOP)],
    fluent: [],
  },
});
piece("dialog title", {
  props: TEXT,
  places: {
    classic: [],
    fluent: at(DIALOGS, '[data-slot="dialog-title"]', TOP),
  },
});
piece("dialog close and help buttons", {
  props: ["@w", "@h", "font-size", "color", "background-color", "box-shadow", "border-top-width"],
  places: {
    classic: [...at(SET, '.cl-x[aria-label="Close settings"]', "section.settings"), ["Go To", ".cl-x", ".palette--classic"], ["REC wizard", ".cl-rec-x", ".cl-rec-wiz"]],
    fluent: [],
  },
});
piece("dialog frame", {
  props: [...FRAME, "padding"],
  places: {
    classic: [...at(SET, '[data-slot="dialog-content"]', "section.settings"), ["Go To", '[data-slot="dialog-content"]'], ["REC wizard", ".cl-rec-wiz"], ...at(DIALOGS, '[data-slot="dialog-content"]', TOP)],
    fluent: at(DIALOGS, '[data-slot="dialog-content"]', TOP),
  },
});
piece("settings frame position", {
  props: ["@x", "@y", "@w", "@h"],
  places: { classic: at(SET, "section.settings"), fluent: at(SET, ".flc-sx") },
});
piece("settings tab strip", {
  props: ["@x", "@y", "@w", "@h"],
  places: { classic: at(SET, ".cl-tabs", "section.settings"), fluent: at(SET, ".flc-sx__cats", ".flc-sx") },
});
piece("settings tab", {
  props: [...TEXT, "@h", "padding"],
  places: { classic: at(SET, '[role="tab"]', ".cl-tabs"), fluent: at(SET, '[role="tab"]', ".flc-sx__cats") },
});

// ---- settings content -----------------------------------------------------
piece("section heading", {
  props: [...TEXT, "margin-bottom"],
  places: {
    classic: [
      ...at(SET, ".settings__group", BODY.classic),
      ["Discover", ".cl-disc-gb > legend", "main.app-main"],
      ["Sports", ".cl-sports__day > legend", "main.app-main"],
      ["Film", ".clt-gb > legend", "main.app-main"],
    ],
    fluent: at(SET, ".settings__group", BODY.fluent),
  },
});
piece("section frame", {
  optional: true,
  props: FRAME,
  places: {
    classic: [
      ...at(SET, ".settings-section", BODY.classic),
      ["Discover", "fieldset.cl-disc-gb", "main.app-main"],
      ["Sports", "fieldset.cl-sports__day", "main.app-main"],
      ["Film", "fieldset.clt-gb", "main.app-main"],
    ],
    fluent: at(SET, ".settings-section", BODY.fluent),
  },
});
piece("setting row title", {
  optional: true,
  props: TEXT,
  places: setting(".customize-row__title"),
});
piece("setting row description", {
  optional: true,
  props: TEXT,
  places: setting(".customize-row .settings__section-note, .customize-stack .settings__section-note"),
});
piece("setting row control edge", {
  optional: true,
  props: ["@rr"],
  rel: ".settings__body, .flc-sx__page",
  places: setting(".customize-row > :last-child, .setting-line > :last-child"),
});
piece("setting row card", {
  props: [...FRAME, "padding"],
  places: {
    classic: [],
    fluent: [["Settings/Home", ".homerows"], ...at(["Settings/Playback", "Settings/Appearance", "Settings/App"], ".customize-row[data-setting], .customize-stack[data-setting]")].map(([r, s]) => [r, s, BODY.fluent]),
  },
});

// ---- controls -------------------------------------------------------------
// Button writes data-variant and data-size, but a trigger (a dialog's, a menu's)
// takes its data-slot, so those two are what find every shadcn Button.
const BTN_EXCL = ':not([data-size^="icon"]):not([data-variant="ghost"]):not([data-variant="link"]):not([data-variant="chip"]):not([role="combobox"]):not([role="radio"]):not([role="tab"]):not([class*="h-auto"]):not(:has(+ [data-size="icon"]))';
// Left out: the Theme cards (tall tiles, h-auto) and a split button's main half
// (its other corners are square on purpose).
const BTN = {
  classic: `button[data-size][data-variant]${BTN_EXCL}, .cl-b, .clt-b, .cl-tog:not(.cl-rec), .cl-hero__btns .cl-btn, .cl-disc-gbtn`,
  fluent: `button[data-size][data-variant]${BTN_EXCL}, .fls-btn:not(.fls-btn--icon), .fl-btn:not(.fl-btn--icon)`,
  // Classic's Discover search sits in the address bar, with its own Go button.
  extra: { classic: [["Discover", ".cl-go", ".cl-header"]] },
};
const where = (sel) => ({
  classic: [...at(SET, sel.classic, BODY.classic), ...at(DIALOGS, sel.classic, TOP), ...at(SCREENS, sel.classic, "main.app-main"), ["REC wizard", sel.classic, ".cl-rec-wiz"], ...(sel.extra?.classic ?? [])],
  fluent: [...at(SET, sel.fluent, BODY.fluent), ...at(DIALOGS, sel.fluent, TOP), ...at(SCREENS, sel.fluent, "main.app-main")],
});
piece("push button", {
  optional: true,
  props: ["@h", "font-size", "font-weight", "font-family", "border-radius", "border-top-width", "border-top-style", "box-shadow", "text-transform"],
  split: "@kind",
  places: where(BTN),
});
piece("push button shape", {
  optional: true,
  props: ["border-radius", "border-top-width", "font-family", "text-transform"],
  places: where(BTN),
});
// A plain text box: Settings' (Sources), the Go To field, REC's keyword field,
// the Fix Guide search, the Discover search and the lists' filters. Wrappers
// that draw the box (Discover's search) are measured, not the bare input.
const FIELD = 'input[data-slot="input"], .mvpick__input';
piece("text field", {
  optional: true,
  props: ["@h", "font-size", "font-family", "color", "border-radius", "border-top-width", "box-shadow", "background-color"],
  places: {
    classic: [
      ...at(SET, ".settings-input", BODY.classic),
      ["Go To", ".mvpick__input", ".palette--classic"],
      ["REC wizard", ".cl-rec-field", ".cl-rec-wiz"],
      ["Fix Guide", FIELD, TOP],
      ["Discover", ".cl-header input"],
    ],
    fluent: [
      ...at(SET, ".settings-input", BODY.fluent),
      ["Go To", ".mvpick__input", ".flc-flyout"],
      ["Fix Guide", FIELD, TOP],
      ["Discover", ".fls-search", "main.app-main"],
      ["Sports", ".fl-filter input", "main.app-main"],
      ["Guide", ".fl-filter input", "main.app-main"],
    ],
  },
});
// The frame of a combo box: Settings' are an input group or a chips box around
// the real input; Discover's is a labelled select.
const COMBO = '[data-slot="input-group"]:has([role="combobox"]), [data-slot="combobox-chips"]';
piece("combo box", {
  optional: true,
  props: ["@h", "font-size", "font-family", "color", "border-radius", "border-top-width", "box-shadow", "background-color"],
  places: {
    classic: [...at(SET, COMBO, BODY.classic), ["Discover", ".cl-combo", "main.app-main"]],
    fluent: [...at(SET, COMBO, BODY.fluent), ["Discover", ".fls-combo", "main.app-main"]],
  },
});

// ---- menus, trees, titles, the nav ----------------------------------------
piece("menu item", {
  props: ["@h", "font-size", "font-family", "font-weight", "padding", "color", "text-align", "border-radius"],
  places: {
    classic: at(["Menu/Channel", "Menu/Programme", "Menu/Folder", "Menu/Add Row"], '[role="menuitem"], [role="menuitemcheckbox"]', '[role="menu"]'),
    fluent: at(["Menu/Channel", "Menu/Programme", "Menu/Folder", "Menu/Add Row"], '[role="menuitem"], [role="menuitemcheckbox"]', '[role="menu"]'),
  },
});
// A tree's row height, its text size, and how far each level steps in.
const TREE_FN = `(tree) => {
  const level = (lb) => {
    const row = lb.closest("[aria-level]");
    if (row) return row.getAttribute("aria-level") - 1;
    let n = -1;
    for (let e = lb.closest("[role=treeitem]"); e; e = e.parentElement?.closest("[role=treeitem]")) n++;
    return n;
  };
  const lefts = {};
  let first;
  for (const lb of tree.querySelectorAll(".cl-tv__lb")) {
    const d = level(lb);
    if (!(d in lefts)) lefts[d] = lb.getBoundingClientRect().left;
    first ??= lb.closest(".cl-tv__row, .cl-tv__n");
  }
  const cs = getComputedStyle(first);
  return { "row height": first.offsetHeight, "font-size": cs.fontSize, "font-family": cs.fontFamily, "indent step 1": lefts[1] - lefts[0], "indent step 2": lefts[2] - lefts[1] };
}`;
piece("tree row", {
  fn: TREE_FN,
  places: { classic: [["Guide", ".cl-tv", "main.app-main"], ["Sports", ".cl-tv", "main.app-main"]], fluent: [] },
});
piece("folder and league row", {
  props: ["@h", "font-size", "font-weight", "font-family", "padding", "border-radius", "color"],
  places: {
    classic: [],
    fluent: [["Guide", ".fl-folders__list .fl-nav", "main.app-main"], ["Sports", ".fl-folders__list .fl-nav", "main.app-main"]],
  },
});
piece("folder and league group row", {
  props: ["@h", "font-size", "font-weight", "font-family", "padding", "border-radius", "color"],
  places: {
    classic: [],
    fluent: [["Guide", ".fl-folders__group .fl-nav", "main.app-main"], ["Sports", ".fl-folders__group .fl-nav", "main.app-main"]],
  },
});
piece("page title", {
  props: ["font-size", "font-weight", "font-family", "color", "line-height", "@y"],
  places: {
    classic: [],
    fluent: [
      ["Home screen", ".fls-page-title", "main.app-main"],
      ["Stream screen", ".fls-page-title", "main.app-main"],
      ["Discover", ".fls-page-title", "main.app-main"],
      ["Library", ".library__lists .media-row__title", "main.app-main"],
      ["Sports", ".fl-head__title", "main.app-main"],
      ["Guide", ".fl-head__title", "main.app-main"],
      ["Settings/Home", ".flc-sx__title", ".flc-sx"],
    ],
  },
});
const CURRENT_CL = ["background-image", "background-color", "box-shadow", "color", "font-weight", "@h"];
const CURRENT_FL = ["background-color", "color", "font-weight", "font-size", "@h", "::before:width", "::before:height", "::before:background-color", "::before:border-radius"];
piece("toolbar tab when current", {
  props: CURRENT_CL,
  places: {
    classic: [...DESTS.map(([d, l]) => [`Nav/${l}`, `.cl-tools [data-dest="${d}"]`, ".cl-tools"]), ["Multi-View intro", '.cl-tools [data-dest="multiview"]', ".cl-tools", "Nav/Multi-View (first visit)"]],
    fluent: [],
  },
});
piece("pane item when current", {
  props: CURRENT_FL,
  places: {
    classic: [],
    fluent: [
      ...DESTS.map(([d, l]) => [`Nav/${l}`, `.flc-pane [data-dest="${d}"]`, ".flc-pane"]),
      ["Multi-View intro", '.flc-pane [data-dest="multiview"]', ".flc-pane", "Nav/Multi-View (first visit)"],
      ["Settings/Home", '.flc-pane [data-key="settings"]', ".flc-pane", "Nav/Settings"],
    ],
  },
});

// ------------------------------------------------------------------- run
const PACKS = [
  { id: "classic", pack: "classic", light: false },
  { id: "fluent-dark", pack: "fluent", light: false },
  { id: "fluent-light", pack: "fluent", light: true },
];

const keyOf = (k) => (k ? `[${k}] ` : "");
const same = (a, b, tol) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= tol : a === b);
const short = (v) => String(v).replace(/\s+/g, " ").slice(0, 70);

for (const P of PACKS) {
  const t0 = Date.now();
  console.log(`\n== ${P.id} ==`);
  const { ctx, page } = await open(P);
  const family = P.pack;
  // piece -> place label -> { key: metrics } ({} when nothing matched)
  const seen = {};
  for (const [rname, R] of Object.entries(ROUTES)) {
    const wanted = Object.entries(PIECES).filter(([, d]) => (d.places[family] ?? []).some(([r]) => r === rname));
    if (R.packs && !R.packs.includes(family)) continue;
    if (R.skip) {
      console.log(`skip ${P.id}: ${rname}: ${R.skip}`);
      continue;
    }
    if (!wanted.length) continue;
    try {
      await reset(page, family);
      await R.go(page, family);
    } catch (e) {
      check(`${P.id}: reach ${rname}`, false, String(e.message ?? e).split("\n")[0]);
      for (const [pname, d] of wanted) for (const [r, , , label] of d.places[family].filter(([r]) => r === rname)) ((seen[pname] ??= {})[label ?? r] = null);
      continue;
    }
    for (const [pname, d] of wanted) {
      for (const [r, sel, scope, label] of d.places[family].filter(([r]) => r === rname)) {
        const got = await page.evaluate(measureInPage, { scope, sel, props: d.props, split: d.split, rel: d.rel, fn: d.fn });
        const into = ((seen[pname] ??= {})[label ?? r] ??= {});
        if (!got.__scope) for (const [k, v] of Object.entries(got)) into[k] ??= v;
      }
    }
  }

  for (const [pname, d] of Object.entries(PIECES)) {
    if (!(d.places[family] ?? []).length) continue;
    const all = seen[pname] ?? {};
    const unreached = Object.keys(all).filter((r) => all[r] === null);
    const at = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null));
    const visited = Object.keys(at);
    const found = visited.filter((r) => Object.keys(at[r]).length);
    const lost = visited.filter((r) => !found.includes(r));
    const skipped = unreached.length ? ` (not reached: ${unreached.join(", ")})` : "";
    if (found.length < 2) {
      check(`${P.id}: ${pname}`, false, `only found in ${found.length} places${lost.length ? `, missing in ${lost.join(", ")}` : ""}${skipped}`);
      continue;
    }
    const keys = [...new Set(found.flatMap((r) => Object.keys(at[r])))];
    const lines = [];
    const summary = [];
    const props = d.fn ? Object.keys(at[found[0]][Object.keys(at[found[0]])[0]]) : d.props;
    for (const k of keys) {
      const byPlace = {};
      for (const r of visited) {
        if (at[r][k]) byPlace[r] = at[r][k];
        else if (!d.split && !d.optional) byPlace[r] = "absent";
      }
      if (Object.keys(byPlace).length < 2) continue; // a variant seen once says nothing
      for (const p of props) {
        const groups = [];
        for (const [place, v] of Object.entries(byPlace)) {
          const val = v === "absent" ? "absent" : v[p];
          const g = groups.find((g) => same(g.val, val, TOL[p.replace(/^::[a-z-]+:/, "")] ?? 0));
          if (g) g.at.push(place);
          else groups.push({ val, at: [place] });
        }
        if (groups.length > 1) {
          lines.push(`${keyOf(k)}${p}: ${groups.map((g) => `${short(g.val)} (${g.at.join(", ")})`).join(" | ")}`);
          summary.push(`${keyOf(k)}${p}`);
        }
      }
    }
    const count = `${found.length} places`;
    const absent = () => d.optional && lost.length && note(`not present in: ${lost.join(", ")}`);
    if (!lines.length) {
      check(`${P.id}: ${pname}, same in ${count}${skipped}`, true);
      absent();
      for (const k of keys.slice(0, 4)) {
        const v = at[found[0]][k] ?? Object.values(at).map((x) => x[k]).find(Boolean);
        if (v) note(`${keyOf(k)}${Object.entries(v).map(([m, x]) => `${m}=${short(x)}`).join("; ")}`.slice(0, 220));
      }
    } else {
      check(`${P.id}: ${pname}, differs in ${count}${skipped}`, false, summary.join(", "));
      absent();
      for (const l of lines) note(l);
    }
  }
  console.log(`(${P.id} took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
