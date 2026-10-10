// E2E: the palette finds any setting (plan 025, P2; v0.11.27).
//
// Ctrl+K, "subtitle", Enter, and Settings opens on Playback scrolled to the
// row, lit for a moment, with focus on its first control. The palette lists
// Settings' rows from a static registry (features/settings/settingsIndex.ts),
// because Settings is closed when the palette is asked and a page only exists
// while it shows. So the checks are about three things:
//
//   - the palette: a Settings section once something is typed (not before,
//     not for a word no row has), after the places, at most five rows, each
//     with its page;
//   - the landing: the page, the pill, the scroll, the light, the focus, and
//     what happens when the row isn't drawn (no AIOStreams, a hidden carousel);
//   - the registry matching the screens: every `data-setting` a page draws is
//     in the registry with that page and pill, and every registry row is
//     drawn. A row added to a page and not to the registry, or the other way
//     round, fails here and nowhere else.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-settings-find.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const XTREAM = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
const SEEDED = { playlists: XTREAM, aiostreams: AIO, startupTab: { v: 1, data: "stream" } };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/**
 * A page of its own, in a context of its own, as verify-settings-pages opens
 * one. `tauri` stands in for the native side where a row only exists there
 * (Trakt, MyAnimeList, Updates) and for AIOStreams' sign-in, whose status and
 * `aiojf_sources` probe are answered the way a build that has them answers: not
 * signed in, and a refusal for the empty id (which is how the app learns the
 * build can open sources by sign-in).
 */
async function open({ store = {}, width = 1440, height = 900, tauri = false, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, tauri }) => {
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      // Once: a reload in a check must see what the check left.
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
      }
      if (tauri) {
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
            if (cmd === "trakt_status") return Promise.resolve({ configured: true, connected: false });
            if (cmd === "mal_status") return Promise.resolve({ configured: true, connected: false });
            if (cmd === "frontend_status") return Promise.resolve({ serving: "", pending: "" });
            if (cmd === "frontend_check") return Promise.resolve("");
            if (cmd === "aiojf_status") return Promise.resolve({ connected: false });
            if (cmd === "aiojf_sources") return Promise.reject("refused: no item");
            return Promise.resolve(undefined);
          },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      }
    },
    { store, tauri },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await goTo(page, "home");
  return { ctx, page };
}

const gear = (page) => page.getByRole("button", { name: "Settings", exact: true }).first();
const search = (page) => page.getByRole("button", { name: "Search", exact: true }).first();
const palette = (page) => page.locator(".palette");
const rail = (page) => page.getByRole("tablist", { name: "Settings", exact: true });
const current = (page) => rail(page).locator("[role=tab][aria-selected=true]").getAttribute("aria-label");
const pill = (page, name) => page.getByRole("tablist", { name, exact: true }).locator("[role=tab][aria-selected=true]").textContent();

/** Ctrl+K, a query, and a beat for the list to settle. */
async function ask(page, q) {
  await page.keyboard.press("Control+k");
  await palette(page).waitFor({ timeout: 4000 });
  if (q) await page.keyboard.type(q);
  await page.waitForTimeout(300);
}
/** Every section the palette shows, with its rows. */
const sections = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".palette .mvpick__group")].map((g) => ({
      name: g.querySelector(".mvpick__sec")?.textContent,
      rows: [...g.querySelectorAll(".mvpick__row")].map((r) => ({
        label: r.querySelector(".mvpick__nametext")?.textContent,
        sub: r.querySelector(".mvpick__sub")?.textContent,
        icon: !!r.querySelector(".mvpick__fillicon svg"),
      })),
    })),
  );
const settingsSection = async (page) => (await sections(page)).find((s) => s.name === "Settings");
const closePalette = async (page) => {
  await page.keyboard.press("Escape");
  await palette(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
};
const closeSettings = async (page) => {
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
};
/** Settings is open and the body is on the screen. */
const settingsUp = (page) => page.locator(".settings__body").waitFor({ timeout: 8000 });
/** The body has stopped scrolling: a smooth scroll is a few hundred ms. */
async function settle(page) {
  await page.evaluate(() => delete window.__scr);
  await page.waitForFunction(
    () => {
      const b = document.querySelector(".settings__body");
      if (!b) return false;
      const now = performance.now();
      const w = (window.__scr ??= { t: b.scrollTop, since: now });
      if (w.t !== b.scrollTop) {
        w.t = b.scrollTop;
        w.since = now;
        return false;
      }
      return now - w.since > 300;
    },
    null,
    { polling: 50, timeout: 6000 },
  );
}
/** Where a row stands: lit or not, in the body's rect or not, and where focus is. */
const landed = (page, id) =>
  page.evaluate((id) => {
    const body = document.querySelector(".settings__body");
    const row = body?.querySelector(`[data-setting="${id}"]`);
    if (!body || !row) return null;
    const b = body.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const a = document.activeElement;
    const s = getComputedStyle(row);
    return {
      lit: row.classList.contains("setting--found"),
      anim: s.animationName,
      bg: s.backgroundColor,
      inView: r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5 && r.height > 0,
      scrollTop: Math.round(body.scrollTop),
      // Where the row is in the body, and how big: the card is still easing
      // in (a fraction of a pixel of scale) a moment after it opens.
      box: [r.left - b.left, r.top - b.top, r.width, r.height],
      focusLabel: a?.getAttribute("aria-label") || a?.textContent?.trim() || a?.tagName || null,
      inRow: row.contains(a),
      onCard: !!a?.matches?.(".settings"),
    };
  }, id);
/** How opaque a computed colour is: 0 for transparent, 1 for a plain colour.
 * The accent surface computes to oklab(), the clear one to rgba(0, 0, 0, 0). */
const alpha = (c) => {
  const m = /\(([^)]*)\)/.exec(c ?? "");
  if (!m) return 0;
  const a = /\/\s*([\d.]+)(%?)/.exec(m[1]);
  if (a) return a[2] ? Number(a[1]) / 100 : Number(a[1]);
  const p = m[1].split(/[ ,]+/).filter(Boolean);
  return /^rgba/.test(c) && p.length > 3 ? Number(p[3]) : 1;
};

// ====================================================================
// A browser, signed in to a fake AIOStreams, with a playlist: every page's
// Stream and Live TV rows are there. The native side is absent, so Trakt,
// MyAnimeList and Updates are not (the Tauri section below has them).
// ====================================================================
{
  const { ctx, page } = await open({ store: SEEDED });

  // ------------------------------------------------ the palette's section
  await ask(page, "");
  const idle = await sections(page);
  check(
    "before anything is typed there is no Settings section: places, not every row",
    !idle.some((s) => s.name === "Settings") && idle.some((s) => s.name === "Go to"),
    JSON.stringify(idle.map((s) => s.name)),
  );
  await closePalette(page);

  await ask(page, "zzzz");
  const none = await sections(page);
  const emptyNote = await page.locator(".palette .mvpick__empty").count();
  check("  and none for a word no row has", !none.some((s) => s.name === "Settings") && emptyNote === 1, JSON.stringify(none.map((s) => s.name)));
  await closePalette(page);

  await ask(page, "subtitle");
  const sub = await sections(page);
  const set = sub.find((s) => s.name === "Settings");
  check(
    '"subtitle" lists Settings, and its first row is Preferred Language, "Settings · Playback"',
    set?.rows[0]?.label === "Preferred Language" && set.rows[0].sub === "Settings · Playback",
    JSON.stringify(set),
  );
  check("  with the page's mark beside it", set?.rows[0]?.icon === true);
  await closePalette(page);

  await ask(page, "a");
  const many = await settingsSection(page);
  await closePalette(page);
  check("a short query lists at most five rows of Settings", !!many && many.rows.length === 5, String(many?.rows.length));

  await ask(page, "appearance");
  const ap = await sections(page);
  await closePalette(page);
  const order = ap.map((s) => s.name);
  check(
    "  and the Settings section comes after Go to",
    order.indexOf("Go to") >= 0 && order.indexOf("Settings") > order.indexOf("Go to"),
    JSON.stringify(order),
  );
  check(
    "  with the label that starts with the query first, the one that contains it after",
    JSON.stringify(ap.find((s) => s.name === "Settings")?.rows.map((r) => r.label)) === JSON.stringify(["Appearance", "Reset Appearance"]),
    JSON.stringify(ap.find((s) => s.name === "Settings")?.rows.map((r) => r.label)),
  );

  // ------------------------------------------------ "subtitle": Playback
  await gear(page).focus();
  await ask(page, "subtitle");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  // The light comes on with the card, not after the scroll.
  const early = await page
    .waitForFunction(() => document.querySelector(".settings__body [data-setting='preferred-language']")?.classList.contains("setting--found"), null, { timeout: 2000 })
    .then(() => true, () => false);
  await settle(page);
  const sub1 = await landed(page, "preferred-language");
  check("Enter opens Settings on Playback", (await current(page)) === "Playback", String(await current(page)));
  check("  the row is lit as the card arrives", early);
  check("  and inside the body's rect", !!sub1 && sub1.inView, JSON.stringify(sub1));
  check("  and lit still once the scroll has settled", !!sub1 && sub1.lit && sub1.anim === "setting-found" && alpha(sub1.bg) > 0, JSON.stringify(sub1));
  check(
    "  focus is on the row's first control, the audio language picker, not the card",
    !!sub1 && sub1.inRow && !sub1.onCard && sub1.focusLabel === "Preferred audio language",
    JSON.stringify(sub1),
  );
  const faded = await page.evaluate(() => getComputedStyle(document.querySelector("[data-setting='preferred-language']")).backgroundColor);
  await page.waitForTimeout(2000);
  const gone = await landed(page, "preferred-language");
  check("  and the light is gone two seconds later", !!gone && !gone.lit && gone.anim === "none" && alpha(gone.bg) === 0, JSON.stringify({ gone, faded }));
  check("  while focus is still in the row", !!gone && gone.inRow, JSON.stringify(gone));
  check("  and lighting it moved nothing: the row is the size and place it was", !!gone && !!sub1 && gone.box.every((n, i) => Math.abs(n - sub1.box[i]) < 1), `${sub1?.box} then ${gone?.box}`);
  // Escape on a language picker is the picker's (SettingsModal's Combobox
  // rule, v0.10.33): it does not close Settings. So this one is shut by its X.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  console.log(`NOTE Escape on the language picker leaves Settings ${(await page.locator(".settings").count()) ? "up" : "closed"} (the Combobox rule, unchanged)`);
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 });
  await page.waitForTimeout(250);

  // ------------------------------------------------ "row size": a scroll
  await ask(page, "row size");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const rs = await landed(page, "row-size");
  check("\"row size\" opens Appearance", (await current(page)) === "Appearance", String(await current(page)));
  check("  on Stream", (await pill(page, "Media")) === "Stream", await pill(page, "Media"));
  check(
    "  with the body scrolled and the row fully in view",
    !!rs && rs.scrollTop > 0 && rs.inView,
    JSON.stringify(rs),
  );
  check("  lit, and focus on its slider", !!rs && rs.lit && rs.inRow && rs.focusLabel === "Titles per row", JSON.stringify(rs));
  await closeSettings(page);

  // ------------------------------------------------ "channel numbers": a pill
  await ask(page, "channel numbers");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const cn = await landed(page, "channel-numbers");
  check('"channel numbers" opens Appearance on the Live TV pill', (await current(page)) === "Appearance" && (await pill(page, "Media")) === "Live TV", `${await current(page)} / ${await pill(page, "Media")}`);
  check("  with the row lit and in view, and focus on its switch", !!cn && cn.lit && cn.inView && cn.inRow && cn.focusLabel === "Show channel numbers", JSON.stringify(cn));
  await closeSettings(page);
  // The page it found is the page Settings keeps, but the pill is not kept:
  // Appearance opens on Stream, with nothing lit and focus on the card.
  await gear(page).click();
  await settingsUp(page);
  await page.waitForTimeout(500);
  const plain = await page.evaluate(() => ({
    page: document.querySelector(".settings [role=tablist][aria-label=Settings] [role=tab][aria-selected=true]")?.getAttribute("aria-label"),
    media: document.querySelector("[role=tablist][aria-label=Media] [role=tab][aria-selected=true]")?.textContent,
    lit: document.querySelectorAll(".setting--found").length,
    onCard: !!document.activeElement?.matches?.(".settings"),
  }));
  check(
    "the gear after a find opens the page it left on, on its usual pill, nothing lit, focus on the card",
    plain.page === "Appearance" && plain.media === "Stream" && plain.lit === 0 && plain.onCard,
    JSON.stringify(plain),
  );
  await closeSettings(page);

  // ------------------------------------------------ Sources' pill
  await ask(page, "connection test");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const ct = await landed(page, "connection-test");
  check('"connection test" opens Sources on the Stream pill', (await current(page)) === "Sources" && (await pill(page, "Sources")) === "Stream", `${await current(page)} / ${await pill(page, "Sources")}`);
  check("  with the row lit, and focus on Run Connection Test", !!ct && ct.lit && ct.inRow && /Run Connection Test/.test(ct.focusLabel ?? ""), JSON.stringify(ct));
  await closeSettings(page);
  await gear(page).click();
  await settingsUp(page);
  await page.waitForTimeout(500);
  check("  and Sources opens on Live TV again with no request", (await current(page)) === "Sources" && (await pill(page, "Sources")) === "Live TV", `${await current(page)} / ${await pill(page, "Sources")}`);
  await closeSettings(page);

  // ------------------------------------------------ a click is the same as Enter
  await ask(page, "card details");
  await page.locator(".palette .mvpick__row", { hasText: "Card Details" }).first().click();
  await settingsUp(page);
  await settle(page);
  const cd = await landed(page, "card-details");
  check(
    "a click on the row does what Enter does: the page, the light, and focus in the row",
    (await current(page)) === "Appearance" && !!cd && cd.lit && cd.inRow && !cd.onCard,
    JSON.stringify(cd),
  );
  await closeSettings(page);
  await ctx.close();
}

// ====================================================================
// The registry matches the screens.
// ====================================================================
/** The pages and pills, in the order Settings lists them. */
const POSITIONS = [
  { page: "Sources", key: "sources", world: "live", pill: ["Sources", "Live TV"] },
  { page: "Sources", key: "sources", world: "stream", pill: ["Sources", "Stream"] },
  { page: "Playback", key: "playback" },
  { page: "Appearance", key: "appearance", world: "stream", pill: ["Media", "Stream"] },
  { page: "Appearance", key: "appearance", world: "live", pill: ["Media", "Live TV"] },
  { page: "Accounts", key: "accounts" },
  { page: "App", key: "app" },
];
/** Every `data-setting` the page draws at that position, with how many times. */
async function drawn(page, pos) {
  await rail(page).getByRole("tab", { name: pos.page, exact: true }).click();
  if (pos.pill) await page.getByRole("tablist", { name: pos.pill[0], exact: true }).getByRole("tab", { name: pos.pill[1], exact: true }).click();
  const read = () =>
    page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll(".settings__body [data-setting]")) out[el.dataset.setting] = (out[el.dataset.setting] ?? 0) + 1;
      return JSON.stringify(Object.entries(out).sort());
    });
  // Some come a beat late (AIOStreams asks the native side first): read until it holds.
  let last = "";
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const now = await read();
    if (now === last && i >= 2) break;
    last = now;
  }
  return Object.fromEntries(JSON.parse(last));
}
async function registryMatches(page, positions, label) {
  const reg = await page.evaluate(async () => {
    const m = await import("/src/features/settings/settingsIndex.ts");
    return m.SETTINGS_INDEX.map(({ id, label, page, world }) => ({ id, label, page, world }));
  });
  for (const pos of positions) {
    const got = await drawn(page, pos);
    const where = `${pos.page}${pos.pill ? ` / ${pos.pill[1]}` : ""}`;
    // What the registry says should be here: this page's rows, those under no
    // pill and those under this one.
    const want = reg.filter((r) => r.page === pos.key && (!r.world || r.world === pos.world)).map((r) => r.id);
    const ids = Object.keys(got);
    const known = ids.filter((id) => reg.some((r) => r.id === id));
    const wrongPlace = ids.filter((id) => {
      const r = reg.find((x) => x.id === id);
      return r && (r.page !== pos.key || (r.world && r.world !== pos.world));
    });
    const missing = want.filter((id) => !ids.includes(id));
    check(
      `${label}, ${where}: every drawn row is in the registry, with this page and pill`,
      known.length === ids.length && wrongPlace.length === 0,
      JSON.stringify({ unknown: ids.filter((id) => !known.includes(id)), wrongPlace }),
    );
    check(`  and every registry row for it is drawn (${want.length})`, missing.length === 0 && want.length > 0, JSON.stringify({ missing, want, got: ids }));
  }
  return { reg };
}

{
  const { ctx, page } = await open({ store: SEEDED });
  await gear(page).click();
  await settingsUp(page);
  await page.waitForTimeout(400);
  const { reg } = await registryMatches(page, POSITIONS.filter((p) => !["accounts", "app"].includes(p.key)), "browser");
  // The registry itself: a label for every row, ids that are unique.
  check("the registry's ids are unique and every row has a label", new Set(reg.map((r) => r.id)).size === reg.length && reg.every((r) => r.label.trim()), `${reg.length} rows`);
  await ctx.close();
}

// ====================================================================
// With the native side: Trakt, MyAnimeList, Updates, the sign-in variant of
// AIOStreams (drawn late), and the focus Escape hands back.
// ====================================================================
{
  const { ctx, page } = await open({ store: SEEDED, tauri: true });

  // ------------------------------------------------ "trakt": Accounts
  await ask(page, "trakt");
  const tk = await settingsSection(page);
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const tr = await landed(page, "trakt");
  check('"trakt" opens Accounts', (await current(page)) === "Accounts" && tk?.rows[0]?.label === "Trakt" && tk.rows[0].sub === "Settings · Accounts", `${await current(page)} / ${JSON.stringify(tk?.rows[0])}`);
  check("  with the row lit and focus on its Connect", !!tr && tr.lit && tr.inRow && tr.focusLabel === "Connect", JSON.stringify(tr));
  await closeSettings(page);

  // ------------------------------------------------ "clear": App, not armed, and Escape
  // Focus starts on the search button so that "back where it was" is not the
  // gear, the fallback Settings would use on its own.
  await search(page).focus();
  await ask(page, "clear");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const cl = await landed(page, "clear-logins");
  const armed = await page.evaluate(() => ({
    label: document.querySelector("[data-setting='clear-logins'] button")?.textContent,
    confirms: [...document.querySelectorAll("button")].filter((b) => /Click again to confirm/.test(b.textContent ?? "")).length,
  }));
  check('"clear" opens App with Clear All Login Info lit and focused', (await current(page)) === "App" && !!cl && cl.lit && cl.inRow && cl.focusLabel === "Clear…", `${await current(page)} / ${JSON.stringify(cl)}`);
  check('  and NOT armed: the label is still "Clear…" and nothing asks to confirm', armed.label === "Clear…" && armed.confirms === 0, JSON.stringify(armed));
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  const shut = await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ label: document.activeElement?.getAttribute("aria-label"), tips: document.querySelectorAll("[data-slot=tooltip-content]:not([data-state=closed])").length }));
  check("Escape after a find closes Settings and focus goes back to where it was before the palette", shut && back.label === "Search" && back.tips === 0, JSON.stringify({ shut, ...back }));

  // ------------------------------------------------ the same row asked twice
  await ask(page, "clear");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const again = await landed(page, "clear-logins");
  check("the same row asked a second time is a new request: lit and focused again", !!again && again.lit && again.inRow, JSON.stringify(again));
  await closeSettings(page);

  // ------------------------------------------------ AIOStreams, drawn late
  await ask(page, "aiostreams");
  const ai = await settingsSection(page);
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await settle(page);
  const aio = await landed(page, "aiostreams");
  check(
    '"aiostreams" opens Sources on the Stream pill, and the row is lit though the native side drew it late',
    (await current(page)) === "Sources" && (await pill(page, "Sources")) === "Stream" && ai?.rows[0]?.label === "AIOStreams" && !!aio && aio.lit,
    `${await current(page)} / ${await pill(page, "Sources")} / ${JSON.stringify(aio)}`,
  );
  check("  with focus on its first control, the address field", !!aio && aio.inRow && aio.focusLabel === "INPUT", JSON.stringify(aio));
  await closeSettings(page);

  // ------------------------------------------------ the registry, with the native side
  await gear(page).click();
  await settingsUp(page);
  await page.waitForTimeout(400);
  await registryMatches(page, POSITIONS.filter((p) => ["accounts", "app"].includes(p.key) || (p.key === "sources" && p.world === "stream")), "native");
  // Both of AIOStreams' sections carry the one id: the sign-in, and the
  // manifest under it while one is saved.
  await rail(page).getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("tablist", { name: "Sources", exact: true }).getByRole("tab", { name: "Stream", exact: true }).click();
  await page.waitForTimeout(600);
  const both = await page.evaluate(() => [...document.querySelectorAll("[data-setting='aiostreams'] .settings-section__list-title")].map((e) => e.textContent));
  check("AIOStreams' sign-in and manifest sections both carry its id", both.join() === "AIOStreams,AIOStreams Manifest", JSON.stringify(both));
  await closeSettings(page);
  await ctx.close();
}

// ====================================================================
// A row that isn't drawn is not an error.
// ====================================================================
{
  // No AIOStreams: Playback shows the sign-in note where its rows would be.
  const errorsBefore = errors.length;
  const { ctx, page } = await open({ store: { playlists: XTREAM, startupTab: { v: 1, data: "stream" } } });
  await ask(page, "subtitle");
  const s = await settingsSection(page);
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await page.waitForTimeout(2600);
  const note = await page.evaluate(() => ({
    text: document.querySelector(".settings__body")?.innerText.replace(/\n/g, " ") ?? "",
    rows: document.querySelectorAll(".settings__body [data-setting]").length,
    lit: document.querySelectorAll(".setting--found").length,
    onCard: !!document.activeElement?.matches?.(".settings"),
  }));
  check(
    "with no AIOStreams, \"subtitle\" still lists the row and opens Playback on the sign-in note",
    s?.rows[0]?.label === "Preferred Language" && (await current(page)) === "Playback" && /Sign in to your AIOStreams in Settings/.test(note.text),
    JSON.stringify({ s: s?.rows[0], text: note.text.slice(0, 100) }),
  );
  check("  nothing lit, no row drawn, and focus left on the card", note.lit === 0 && note.rows === 0 && note.onCard, JSON.stringify(note));
  check("  and no page error", errors.length === errorsBefore, errors.slice(errorsBefore, errorsBefore + 2).join(" | "));
  await closeSettings(page);
  await ctx.close();
}
{
  // The carousel off: its sources row goes with it.
  const errorsBefore = errors.length;
  const { ctx, page } = await open({ store: { ...SEEDED, showHero: { v: 1, data: false } } });
  await ask(page, "hero slider");
  const s = await settingsSection(page);
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await page.waitForTimeout(2600);
  const st = await page.evaluate(() => ({
    lit: document.querySelectorAll(".setting--found").length,
    hero: !!document.querySelector("[data-setting='hero-sources']"),
    carousel: !!document.querySelector("[data-setting='featured-carousel']"),
    onCard: !!document.activeElement?.matches?.(".settings"),
  }));
  check(
    "with the carousel off, \"hero slider\" opens Appearance on Stream with nothing lit and focus on the card",
    s?.rows[0]?.label === "Hero Slider Sources" && (await current(page)) === "Appearance" && (await pill(page, "Media")) === "Stream" && !st.hero && st.carousel && st.lit === 0 && st.onCard,
    JSON.stringify({ s: s?.rows[0], st }),
  );
  check("  and no page error", errors.length === errorsBefore, errors.slice(errorsBefore, errorsBefore + 2).join(" | "));
  await closeSettings(page);
  await ctx.close();
}

// ====================================================================
// Reduced motion: the scroll is instant and the light has no fade.
// ====================================================================
{
  const { ctx, page } = await open({ store: SEEDED, reducedMotion: "reduce" });
  await ask(page, "row size");
  await page.keyboard.press("Enter");
  await settingsUp(page);
  await page.locator("[data-setting='row-size'].setting--found").waitFor({ timeout: 3000 });
  // Not a smooth scroll: it is already there a frame or two after the row is lit.
  await page.waitForTimeout(100);
  const a = await landed(page, "row-size");
  await page.waitForTimeout(1000);
  const b = await landed(page, "row-size");
  check("under reduced motion the scroll is instant: the row is in view straight away", !!a && a.scrollTop > 0 && a.inView, JSON.stringify(a));
  check("  and the light has no fade: the same colour a second later", !!a && !!b && a.lit && b.lit && a.anim === "none" && b.anim === "none" && alpha(a.bg) > 0 && a.bg === b.bg, JSON.stringify({ a: a?.bg, b: b?.bg }));
  await page.waitForTimeout(1200);
  const c = await landed(page, "row-size");
  check("  and it is still gone after its 1.6 seconds", !!c && !c.lit && alpha(c.bg) === 0, JSON.stringify(c));
  await closeSettings(page);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
