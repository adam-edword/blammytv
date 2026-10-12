// E2E: Settings → App gains Keyboard Shortcuts, What's new and About (plan 025,
// P4a; v0.11.36), with the native side stubbed.
//
// Three rows between Updates and Replay Onboarding:
//
//   - Keyboard Shortcuts: a list of what the keys do, opened inline by Show and
//     shut by Hide, in the app's own Kbd chips. The list is shortcuts.ts,
//     written from the handlers, and a list written down can drift from them.
//     So the table is held to the code here: every key of the player group is
//     pressed in a real theater (the bare chrome against a mocked overlayApi)
//     and has to do what its line says, and the Anywhere keys are pressed in
//     the app. A key renamed in the table, or a handler that moved, fails here;
//   - What's new: the notes of an update that is waiting, under the update
//     row. From an installer (`check_update_info`, and `check_update` when a
//     native build has no such command) and from a staged bundle
//     (`frontend_status`'s `pendingNotes`). Plain text, headings stripped,
//     capped, never HTML: they come over the network from a file that isn't
//     signed;
//   - About: the app's own version, and what native says of the rest
//     (`about_versions`). A row native left out, and an older native with no
//     such command, are rows that aren't drawn, with no error.
//
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-settings-app.mjs
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

const SEEDED = { startupTab: { v: 1, data: "stream" } };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** What the native stub answers when a scenario doesn't say. `info`, `update`
 * and `about` can be "reject" (a native build that has no such command: the
 * call is refused the way Tauri refuses an unknown one) or, for the first two,
 * "fail" (the check itself failed). */
const NATIVE = {
  status: { serving: "", pending: "" },
  info: null,
  update: null,
  about: undefined,
};

/**
 * A page of its own, in a context of its own. `tauri` stands in for the native
 * side (the update row and About's rows only exist there); `native` is what it
 * answers, and can be changed under a page with `setNative`. Every call is
 * written down in window.__calls, and a rejection nobody caught in
 * window.__unhandled (Playwright does not call it a page error).
 */
async function open({ store = SEEDED, width = 1440, height = 900, tauri = false, native = {}, path = "", props = null, mock = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    screen: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (mock) await page.addInitScript(mock);
  await page.addInitScript(
    ({ store, tauri, native, props }) => {
      window.__calls = [];
      window.__unhandled = [];
      window.addEventListener("unhandledrejection", (e) => window.__unhandled.push(String(e.reason)));
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      // Once: a reload in a check must see what the check left.
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
      }
      if (props) window.__overlayProps = props;
      window.__native = native;
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
            window.__calls.push([cmd, args]);
            const n = window.__native;
            const refuse = (c) => Promise.reject(`Command ${c} not found`);
            if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
            if (cmd === "trakt_status") return Promise.resolve({ configured: true, connected: false });
            if (cmd === "mal_status") return Promise.resolve({ configured: true, connected: false });
            if (cmd === "aiojf_status") return Promise.resolve({ connected: false });
            if (cmd === "aiojf_sources") return Promise.reject("refused: no item");
            if (cmd === "frontend_status") return Promise.resolve(n.status);
            if (cmd === "frontend_check") return Promise.resolve("");
            if (cmd === "check_update_info") {
              if (n.info === "reject") return refuse(cmd);
              if (n.info === "fail") return Promise.reject("the update server did not answer");
              return Promise.resolve(n.info);
            }
            if (cmd === "check_update") {
              if (n.update === "fail") return Promise.reject("the update server did not answer");
              return Promise.resolve(n.update);
            }
            if (cmd === "about_versions") {
              if (n.about === "reject") return refuse(cmd);
              return Promise.resolve(n.about);
            }
            if (cmd === "mpv_stats") return Promise.resolve("{}");
            if (cmd === "install_update") return new Promise(() => {});
            return Promise.resolve(undefined);
          },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      }
    },
    { store, tauri, native: { ...NATIVE, ...native }, props },
  );
  await page.goto(APP + path, { waitUntil: "domcontentloaded" });
  if (!path.includes("overlay=1")) {
    await page.waitForSelector(".navcap", { timeout: 20_000 });
    await goTo(page, "home");
  }
  return { ctx, page };
}
const setNative = (page, n) => page.evaluate((n) => Object.assign(window.__native, n), n);
const calls = (page, cmd) => page.evaluate((cmd) => window.__calls.filter((c) => c[0] === cmd).map((c) => c[1]), cmd);

const gear = (page) => page.getByRole("button", { name: "Settings", exact: true }).first();
const rail = (page) => page.getByRole("tablist", { name: "Settings", exact: true });
const palette = (page) => page.locator(".palette");
async function openApp(page) {
  await gear(page).click();
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await rail(page).getByRole("tab", { name: "App", exact: true }).click();
  await page.locator("[data-setting='about']").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(250);
}
const closeSettings = async (page) => {
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
};
const titles = (page) => page.locator(".settings__body .customize-row__title").allInnerTexts();
const updateRow = (page) => page.locator("[data-setting='updates']");
const note = (page) => updateRow(page).locator(".settings__section-note").first().innerText();
const notesOf = async (page) => {
  const el = updateRow(page).locator(".update-notes__body");
  return (await el.count()) ? await el.innerText() : null;
};
/** Check for updates, and wait for the row to say something other than checking. */
async function checkNow(page) {
  await updateRow(page).getByRole("button", { name: /Check for updates|up to date|Try again/ }).click();
  await page.waitForFunction(
    () => !/Checking/.test(document.querySelector("[data-setting='updates'] button")?.textContent ?? ""),
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(250);
}
/** The table, as the page has it. */
const table = (page) =>
  page.evaluate(async () => (await import("/src/features/settings/shortcuts.ts")).SHORTCUT_GROUPS);
const appVersion = (page) =>
  page.evaluate(async () => (await import("/src/lib/version.ts")).APP_VERSION);

// ====================================================================
// Keyboard Shortcuts: the row, the list, Show and Hide.
// ====================================================================
{
  const { ctx, page } = await open({ tauri: true });
  await openApp(page);
  const rows = await titles(page);
  check(
    "App: Updates, Keyboard Shortcuts, About, Replay Onboarding, then Clear All Login Info",
    rows.length === 5 && /^BlammyTV v/.test(rows[0]) && rows.slice(1).join("|") === "Keyboard Shortcuts|About|Replay Onboarding|Clear All Login Info",
    JSON.stringify(rows),
  );
  const row = page.locator("[data-setting='shortcuts']");
  const show = row.getByRole("button", { name: "Show", exact: true });
  // The same button once it says Hide.
  const toggle = row.locator(".customize-row button");
  check(
    "  the row has a one-line note and a Show button, and the list is not drawn",
    (await row.locator(".settings__section-note").count()) === 1 &&
      (await show.count()) === 1 &&
      (await show.getAttribute("aria-expanded")) === "false" &&
      (await page.locator(".shortcuts").count()) === 0,
  );

  const groups = await table(page);
  const dialogsBefore = await page.locator("[data-slot=dialog-content]").count();
  await show.click();
  await page.locator(".shortcuts").waitFor({ timeout: 3000 });
  const got = await page.evaluate(() => ({
    titles: [...document.querySelectorAll(".shortcuts__title")].map((e) => e.textContent),
    rows: [...document.querySelectorAll(".shortcuts__group")].map((g) => g.querySelectorAll(".shortcuts__row").length),
    chips: document.querySelectorAll(".shortcuts .kbd").length,
    inRow: !!document.querySelector("[data-setting='shortcuts'] .shortcuts"),
    dialogs: document.querySelectorAll("[data-slot=dialog-content]").length,
    expanded: document.querySelector("[data-setting='shortcuts'] button")?.getAttribute("aria-expanded"),
    label: document.querySelector("[data-setting='shortcuts'] button")?.textContent,
    controls: document.querySelector("[data-setting='shortcuts'] button")?.getAttribute("aria-controls") === document.querySelector(".shortcuts")?.id,
  }));
  const chipsWanted = groups.reduce((n, g) => n + g.shortcuts.reduce((m, s) => m + s.keys.reduce((k, chord) => k + chord.length, 0), 0), 0);
  check(
    "Show opens the list under the row: every group of the table, every line, every key as a chip",
    JSON.stringify(got.titles) === JSON.stringify(groups.map((g) => g.title)) &&
      JSON.stringify(got.rows) === JSON.stringify(groups.map((g) => g.shortcuts.length)) &&
      got.chips === chipsWanted &&
      got.inRow,
    JSON.stringify({ titles: got.titles, rows: got.rows, chips: got.chips, chipsWanted }),
  );
  check(
    "  the button now says Hide and holds the list; no second dialog went up over Settings",
    got.label === "Hide" && got.expanded === "true" && got.controls && got.dialogs === dialogsBefore,
    JSON.stringify({ label: got.label, expanded: got.expanded, controls: got.controls, dialogs: got.dialogs, dialogsBefore }),
  );
  const drawn = await page.evaluate(() => {
    const first = document.querySelector(".shortcuts__row");
    const second = [...document.querySelectorAll(".shortcuts__row")].find((r) => /Search titles/.test(r.textContent ?? ""));
    const text = (e) => [...e.querySelectorAll(".kbd, .shortcuts__plus, .shortcuts__or")].map((x) => x.textContent).join(" ");
    return { first: first && text(first), second: second && text(second), what: first?.querySelector(".shortcuts__what")?.textContent };
  });
  check(
    "  keys held together are joined with +, and two ways to do it with 'or'",
    drawn.first === "Ctrl + K" && drawn.second === "/ or Ctrl + F" && /palette/.test(drawn.what ?? ""),
    JSON.stringify(drawn),
  );
  const top = await page.evaluate(() => {
    const r = document.querySelector("[data-setting='shortcuts'] .customize-row").getBoundingClientRect();
    const l = document.querySelector(".shortcuts").getBoundingClientRect();
    return { rowBottom: Math.round(r.bottom), listTop: Math.round(l.top) };
  });
  check("  and the list sits under the row, not beside it", top.listTop >= top.rowBottom, JSON.stringify(top));

  // The look at the card's width: nothing clipped, nothing scrolling sideways,
  // each line's keys and words side by side and not on top of one another.
  const fit = (page) =>
    page.evaluate(() => {
      const body = document.querySelector(".settings__body");
      const rects = [...document.querySelectorAll(".shortcuts__row")].map((r) => {
        const k = r.querySelector(".shortcuts__keys").getBoundingClientRect();
        const w = r.querySelector(".shortcuts__what").getBoundingClientRect();
        const row = r.getBoundingClientRect();
        const overlap = k.left < w.right - 0.5 && w.left < k.right - 0.5 && k.top < w.bottom - 0.5 && w.top < k.bottom - 0.5;
        return { overlap, outside: k.right > row.right + 0.5 || w.right > row.right + 0.5 };
      });
      return {
        sideways: body.scrollWidth > body.clientWidth + 1,
        overlap: rects.filter((r) => r.overlap).length,
        outside: rects.filter((r) => r.outside).length,
        lines: rects.length,
        listWidth: Math.round(document.querySelector(".shortcuts").getBoundingClientRect().width),
        bodyWidth: body.clientWidth,
        narrow: !!document.querySelector(".settings__layout--narrow"),
      };
    });
  const wide = await fit(page);
  check(
    "  at the card's width it fits: no sideways scroll, no line's keys over its words, none outside its line",
    !wide.sideways && wide.overlap === 0 && wide.outside === 0 && wide.lines === groups.reduce((n, g) => n + g.shortcuts.length, 0) && !wide.narrow,
    JSON.stringify(wide),
  );

  await toggle.click();
  await page.waitForTimeout(150);
  const shut = await page.evaluate(() => ({
    list: document.querySelectorAll(".shortcuts").length,
    label: document.querySelector("[data-setting='shortcuts'] button")?.textContent,
    expanded: document.querySelector("[data-setting='shortcuts'] button")?.getAttribute("aria-expanded"),
    focus: document.activeElement?.closest("[data-setting]")?.getAttribute("data-setting"),
  }));
  check("Hide closes it: the list is gone, the button says Show, and focus stays on the row", shut.list === 0 && shut.label === "Show" && shut.expanded === "false" && shut.focus === "shortcuts", JSON.stringify(shut));
  await closeSettings(page);
  await ctx.close();
}
{
  // The narrow card: the rail is the segmented row, and the list still reads.
  const { ctx, page } = await open({ tauri: true, width: 560, height: 800 });
  await openApp(page);
  await page.locator("[data-setting='shortcuts']").getByRole("button", { name: "Show", exact: true }).click();
  await page.locator(".shortcuts").waitFor({ timeout: 3000 });
  const narrow = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    const rects = [...document.querySelectorAll(".shortcuts__row")].map((r) => {
      const k = r.querySelector(".shortcuts__keys").getBoundingClientRect();
      const w = r.querySelector(".shortcuts__what").getBoundingClientRect();
      const row = r.getBoundingClientRect();
      return {
        overlap: k.left < w.right - 0.5 && w.left < k.right - 0.5 && k.top < w.bottom - 0.5 && w.top < k.bottom - 0.5,
        outside: k.right > row.right + 0.5 || w.right > row.right + 0.5 || w.left < row.left - 0.5,
      };
    });
    return {
      narrow: !!document.querySelector(".settings__layout--narrow"),
      sideways: body.scrollWidth > body.clientWidth + 1,
      overlap: rects.filter((r) => r.overlap).length,
      outside: rects.filter((r) => r.outside).length,
      lines: rects.length,
      bodyWidth: body.clientWidth,
    };
  });
  check(
    "in the narrow card (the rail as a row) the list fits too: no sideways scroll, nothing over anything, nothing outside its line",
    narrow.narrow && !narrow.sideways && narrow.overlap === 0 && narrow.outside === 0 && narrow.lines > 20,
    JSON.stringify(narrow),
  );
  await closeSettings(page);
  await ctx.close();
}

// ====================================================================
// The palette finds the row.
// ====================================================================
{
  const { ctx, page } = await open({ tauri: true });
  const ask = async (q) => {
    await page.keyboard.press("Control+k");
    await palette(page).waitFor({ timeout: 4000 });
    await page.keyboard.type(q);
    await page.waitForTimeout(300);
  };
  const firstSetting = () =>
    page.evaluate(() => {
      const g = [...document.querySelectorAll(".palette .mvpick__group")].find((x) => x.querySelector(".mvpick__sec")?.textContent === "Settings");
      const r = g?.querySelector(".mvpick__row");
      return r ? { label: r.querySelector(".mvpick__nametext")?.textContent, sub: r.querySelector(".mvpick__sub")?.textContent } : null;
    });
  const closePalette = async () => {
    await page.keyboard.press("Escape");
    await palette(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
  };
  const found = {};
  for (const q of ["shortcuts", "keyboard", "keys"]) {
    await ask(q);
    found[q] = await firstSetting();
    await closePalette();
  }
  check(
    '"shortcuts", "keyboard" and "keys" each put Keyboard Shortcuts first in the palette, filed under Settings · The app itself',
    Object.values(found).every((f) => f?.label === "Keyboard Shortcuts" && /^Settings · /.test(f.sub ?? "")),
    JSON.stringify(found),
  );
  await ask("shortcuts");
  await page.keyboard.press("Enter");
  await page.locator(".settings__body").waitFor({ timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("[data-setting='shortcuts']")?.classList.contains("setting--found"), null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(800);
  const landed = await page.evaluate(() => {
    const row = document.querySelector("[data-setting='shortcuts']");
    const b = document.querySelector(".settings__body").getBoundingClientRect();
    const r = row?.getBoundingClientRect();
    return {
      page: document.querySelector(".settings [role=tablist][aria-label=Settings] [role=tab][aria-selected=true]")?.getAttribute("aria-label"),
      lit: !!row?.classList.contains("setting--found"),
      inView: !!r && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5,
      focus: document.activeElement?.textContent,
      inRow: !!row?.contains(document.activeElement),
      open: document.querySelectorAll(".shortcuts").length,
    };
  });
  check(
    "Ctrl+K, shortcuts, Enter opens Settings on App with the row lit and in view, focus on its Show, the list still shut",
    landed.page === "App" && landed.lit && landed.inView && landed.inRow && landed.focus === "Show" && landed.open === 0,
    JSON.stringify(landed),
  );
  await closeSettings(page);
  await ask("about");
  const about = await firstSetting();
  await closePalette();
  check('"about" finds About', about?.label === "About", JSON.stringify(about));
  await ctx.close();
}

// ====================================================================
// The table is held to the code. First, the Anywhere keys, in the app.
// ====================================================================
{
  const { ctx, page } = await open({ tauri: false });
  const groups = await table(page);
  const any = groups.find((g) => g.title === "Anywhere");
  const byWhat = (g, w) => g?.shortcuts.find((s) => s.what === w);
  const palEntry = any?.shortcuts.find((s) => /palette/.test(s.what));
  const searchEntry = byWhat(any, "Search titles");
  const escEntry = any?.shortcuts.find((s) => s.keys.some((c) => c.join() === "Esc"));
  check(
    "Anywhere has the three keys the code has: the palette, search, and Escape",
    any?.shortcuts.length === 3 && !!palEntry && !!searchEntry && !!escEntry,
    JSON.stringify(any?.shortcuts.map((s) => s.what)),
  );
  // Playwright's names for the table's.
  const pw = (chord) => chord.map((k) => ({ Ctrl: "Control", Esc: "Escape", "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight" })[k] ?? (k.length === 1 ? k.toLowerCase() : k)).join("+");
  await page.keyboard.press(pw(palEntry.keys[0]));
  const opened = await palette(page).waitFor({ timeout: 3000 }).then(() => true, () => false);
  check(`  ${palEntry.keys[0].join("+")} opens the palette`, opened);
  await page.keyboard.press(pw(escEntry.keys[0]));
  const closed = await palette(page).waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false);
  check("  and Esc closes what is open (the palette)", closed);
  for (const chord of searchEntry.keys) {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press(pw(chord));
    const focused = await page
      .waitForFunction(() => document.activeElement?.classList.contains("navcap__searchinput"), null, { timeout: 4000 })
      .then(() => true, () => false);
    check(`  ${chord.join("+")} puts the cursor in the search box`, focused);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  await ctx.close();
}

// ====================================================================
// Then the player's: every key of the group, pressed in a real theater.
// ====================================================================
/** The bare chrome against an overlayApi that writes down what it is asked. */
const mockBridge = () => {
  window.__api = [];
  // A subtitle track that is on, which is what makes Z and X the player's.
  window.__tracks = { audio: [], subs: [{ id: 3, label: "English", lang: "eng", selected: true }] };
  const log = (name) => (...a) => void window.__api.push([name, ...a]);
  const unsub = () => () => {};
  window.overlayApi = {
    close: log("close"), setPause: log("setPause"), setMute: log("setMute"), setVolume: log("setVolume"),
    seek: log("seek"), seekAbs: log("seekAbs"), setSpeed() {}, expand: log("expand"), collapse: log("collapse"),
    fullscreen: log("fullscreen"), exitFullscreen: log("exitFullscreen"), popout() {}, toggleFavorite() {},
    goLive() {}, setMouseIgnore() {}, selectAudio() {}, selectSub() {},
    subDelay(d) { window.__api.push(["subDelay", d]); return Promise.resolve(Math.round(d * 10) / 10); },
    subDelayReset() { return Promise.resolve(0); },
    getMeta() { return Promise.resolve({ channelName: "Test", title: "Now", live: !window.__overlayProps?.vod }); },
    onMeta: unsub, onLoading: unsub, onKey: unsub, onTime: unsub, onTracks: unsub,
    getLoading() { return false; },
    getTime() { return null; },
    getTracks() { return window.__tracks ?? null; },
  };
};
const pwKey = (k) =>
  ({ Space: "Space", Esc: "Escape", "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight" })[k] ?? (k.length === 1 ? k.toLowerCase() : k);
const sent = (page) => page.evaluate(() => window.__api.splice(0));

/** What each line of the player group has to do, by what the table says it
 * does, in the order they can be pressed (Mute before the volume, which
 * unmutes; Down before Up, since the volume starts at the top). */
const PLAYER = [
  ["Play or pause", (c) => c.some((x) => x[0] === "setPause")],
  ["Mute", (c) => c.some((x) => x[0] === "setMute" && x[1] === true)],
  ["Volume down", (c) => c.some((x) => x[0] === "setVolume" && x[1] === 95)],
  ["Volume up", (c) => c.some((x) => x[0] === "setVolume" && x[1] === 100) && c.some((x) => x[0] === "setMute" && x[1] === false)],
  ["Back 5 seconds", (c) => c.some((x) => x[0] === "seek" && x[1] === -5)],
  ["Forward 5 seconds", (c) => c.some((x) => x[0] === "seek" && x[1] === 5)],
  ["Back 10 seconds", (c) => c.some((x) => x[0] === "seek" && x[1] === -10)],
  ["Forward 10 seconds", (c) => c.some((x) => x[0] === "seek" && x[1] === 10)],
  ["Full screen", (c) => c.some((x) => x[0] === "fullscreen")],
  ["Subtitles 0.1s earlier", (c) => c.some((x) => x[0] === "subDelay" && Math.abs(x[1] + 0.1) < 1e-9)],
  ["Subtitles 0.1s later", (c) => c.some((x) => x[0] === "subDelay" && Math.abs(x[1] - 0.1) < 1e-9)],
];
{
  const { ctx, page } = await open({ path: "?overlay=1", mock: mockBridge });
  await page.waitForSelector(".theater-overlay");
  await page.waitForTimeout(400);
  const groups = await table(page);
  const every = groups.find((g) => g.title === "Every player");
  const stats = every?.shortcuts.find((s) => s.what === "Stats for nerds");
  const lines = every?.shortcuts.filter((s) => s !== stats) ?? [];
  check(
    "the player group has exactly the lines this harness presses (a new line, or one reworded, has no check until it gets one)",
    JSON.stringify(lines.map((s) => s.what).sort()) === JSON.stringify(PLAYER.map(([w]) => w).sort()) && !!stats,
    JSON.stringify({ table: lines.map((s) => s.what), checked: PLAYER.map(([w]) => w) }),
  );
  await sent(page);
  const bad = [];
  let pressed = 0;
  for (const [what, expect] of PLAYER) {
    const entry = lines.find((s) => s.what === what);
    if (!entry) continue;
    // Every way the table gives, each on its own: Space and K both pause.
    for (const chord of entry.keys) {
      await page.keyboard.press(chord.map(pwKey).join("+"));
      await page.waitForTimeout(260);
      const c = await sent(page);
      pressed++;
      // A volume line is read after the key that came before it set the stage.
      if (!expect(c)) bad.push(`${what} (${chord.join("+")}): ${JSON.stringify(c)}`);
    }
  }
  check(
    `every key of the player group, pressed in the theater, does what its line says (${pressed} presses)`,
    bad.length === 0 && pressed >= PLAYER.length,
    bad.join(" | "),
  );

  // T and Esc in the Live TV player. The overlay asks the host to collapse;
  // what the host does with it is the host's (LiveScreen: the mini player).
  const live = groups.find((g) => g.title === "Live TV player");
  const sports = groups.find((g) => g.title === "Sports player");
  const tKey = (g) => g?.shortcuts.find((s) => s.keys.some((c) => c.join() === "T"))?.keys[0].map(pwKey).join("+");
  const escKey = (g) => g?.shortcuts.find((s) => s.keys.some((c) => c.join() === "Esc"))?.keys[0].map(pwKey).join("+");
  await sent(page);
  await page.keyboard.press(tKey(live));
  await page.waitForTimeout(150);
  const t = await sent(page);
  await page.keyboard.press(escKey(live));
  await page.waitForTimeout(150);
  const esc = await sent(page);
  check(
    "Live TV player: T and Esc in the theater each ask the host to step back (collapse)",
    t.some((x) => x[0] === "collapse") && esc.some((x) => x[0] === "collapse"),
    JSON.stringify({ t, esc }),
  );
  await page.keyboard.press(tKey(sports));
  await page.waitForTimeout(150);
  const st = await sent(page);
  await page.keyboard.press(escKey(sports));
  await page.waitForTimeout(150);
  const se = await sent(page);
  check(
    "  and the Sports player's are the same keys through the same chrome (it mounts this overlay, live): a collapse each",
    st.some((x) => x[0] === "collapse") && se.some((x) => x[0] === "collapse"),
    JSON.stringify({ st, se }),
  );
  await ctx.close();
}
{
  // A title (vod): T steps back, and Esc swaps theater and full screen and never leaves.
  const { ctx, page } = await open({ path: "?overlay=1", mock: mockBridge, props: { vod: true, playbackKey: "k1" } });
  await page.waitForSelector(".theater-overlay");
  await page.waitForTimeout(400);
  const groups = await table(page);
  const g = groups.find((x) => x.title === "Stream player");
  const key = (k) => g?.shortcuts.find((s) => s.keys.some((c) => c.join() === k))?.keys[0].map(pwKey).join("+");
  await sent(page);
  await page.keyboard.press(key("T"));
  await page.waitForTimeout(150);
  const t = await sent(page);
  await page.keyboard.press(key("Esc"));
  await page.waitForTimeout(150);
  const esc = await sent(page);
  check(
    "Stream player: T collapses, and Esc in the theater goes to full screen instead of leaving (a title's Esc swaps the two)",
    t.some((x) => x[0] === "collapse") && esc.some((x) => x[0] === "fullscreen") && !esc.some((x) => x[0] === "collapse"),
    JSON.stringify({ t, esc }),
  );
  await ctx.close();
}
{
  // I needs the shell (mpv_stats is a native command).
  const { ctx, page } = await open({ path: "?overlay=1", mock: mockBridge, tauri: true });
  await page.waitForSelector(".theater-overlay");
  await page.waitForTimeout(400);
  const groups = await table(page);
  const entry = groups.find((x) => x.title === "Every player")?.shortcuts.find((s) => s.what === "Stats for nerds");
  const key = entry?.keys[0].map(pwKey).join("+");
  await page.keyboard.press(key);
  const up = await page.waitForSelector(".stats-overlay", { timeout: 3000 }).then(() => true, () => false);
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
  const gone = (await page.locator(".stats-overlay").count()) === 0;
  check(`Stats for nerds (${key}): the panel comes up and goes again`, up && gone);
  await ctx.close();
}

// ====================================================================
// What's new.
// ====================================================================
{
  // An installer found, with notes.
  const { ctx, page } = await open({ tauri: true, native: { info: { version: "0.99.0", notes: "# Big one\nLine two" } } });
  await openApp(page);
  check("with nothing checked, the update row shows no notes", (await notesOf(page)) === null);
  await checkNow(page);
  const text = await note(page);
  const body = await notesOf(page);
  check("an update with notes: the row names the version", /Version 0\.99\.0 is ready to install\./.test(text), text);
  check(
    "  and shows them: 'Big one' and 'Line two' on their own lines, with no #",
    body === "Big one\nLine two" && !/#/.test(await updateRow(page).locator(".update-notes").innerText()),
    JSON.stringify(body),
  );
  check(
    "  under a What's new heading, inside the update row",
    /what.s new/i.test(await updateRow(page).locator(".update-notes__title").innerText()),
  );
  check("  asking check_update_info alone (the old command is only the fallback)", (await calls(page, "check_update_info")).length === 1 && (await calls(page, "check_update")).length === 0);
  check("  and the install button is still the row's", (await updateRow(page).getByRole("button", { name: "Install v0.99.0" }).count()) === 1);
  await ctx.close();
}
{
  // Notes are text, never HTML.
  const { ctx, page } = await open({ tauri: true, native: { info: { version: "0.99.0", notes: "<b>x</b>\n<img src=x onerror=\"window.__pwned=1\">" } } });
  await openApp(page);
  await checkNow(page);
  const got = await page.evaluate(() => {
    const el = document.querySelector("[data-setting='updates'] .update-notes__body");
    return { text: el?.textContent, children: el?.children.length, bold: document.querySelectorAll("[data-setting='updates'] b").length, imgs: document.querySelectorAll("[data-setting='updates'] img").length, pwned: window.__pwned ?? null, html: el?.innerHTML };
  });
  check(
    "notes of <b>x</b> show as those very characters: no element, no image, no script ran",
    got.text === "<b>x</b>\n<img src=x onerror=\"window.__pwned=1\">" && got.children === 0 && got.bold === 0 && got.imgs === 0 && got.pwned === null && /&lt;b&gt;x&lt;\/b&gt;/.test(got.html ?? ""),
    JSON.stringify(got),
  );
  await ctx.close();
}
{
  // An older native: no check_update_info, so the version shows with no notes and no error.
  const { ctx, page } = await open({ tauri: true, native: { info: "reject", update: "0.99.1" } });
  await openApp(page);
  await checkNow(page);
  const text = await note(page);
  check(
    "a native with no check_update_info falls back to check_update: the version shows, no notes, no error",
    /Version 0\.99\.1 is ready to install\./.test(text) && !/snag|not found|rejected/i.test(text) && (await notesOf(page)) === null && (await updateRow(page).locator(".update-notes").count()) === 0,
    text,
  );
  const asked = await page.evaluate(() => window.__calls.map((c) => c[0]).filter((c) => /^check_update/.test(c)));
  check("  having asked the new command first, then the old", JSON.stringify(asked) === JSON.stringify(["check_update_info", "check_update"]), JSON.stringify(asked));
  check("  and left nothing unhandled", (await page.evaluate(() => window.__unhandled)).length === 0);
  await ctx.close();
}
{
  // And 'up to date' comes the same way: check_update says nothing is waiting.
  const { ctx, page } = await open({ tauri: true, native: { info: "reject", update: null } });
  await openApp(page);
  await checkNow(page);
  check(
    "  and 'up to date' comes the same way (check_update says nothing is waiting): no error, no notes",
    (await updateRow(page).getByRole("button", { name: /up to date/ }).count()) === 1 && (await updateRow(page).locator(".update-notes").count()) === 0 && !/snag/.test(await note(page)),
  );
  // It reverts to the plain button after 4 seconds, as it did.
  await page.waitForTimeout(4400);
  check("  and it reverts to 'Check for updates' after four seconds, as it did", (await updateRow(page).getByRole("button", { name: "Check for updates" }).count()) === 1);
  await ctx.close();
}
{
  // A check that really fails still says so.
  const { ctx, page } = await open({ tauri: true, native: { info: "fail", update: "fail" } });
  await openApp(page);
  await checkNow(page);
  const text = await note(page);
  check("a check that fails says so, as it did: 'hit a snag' and the reason", /Update check hit a snag: .*did not answer/.test(text), text);
  check("  with Try again, and no notes", (await updateRow(page).getByRole("button", { name: "Try again" }).count()) === 1 && (await notesOf(page)) === null);
  await ctx.close();
}
{
  // Nothing to say: empty, absent and not-text notes show nothing extra.
  for (const [label, info] of [["empty notes", { version: "0.99.0", notes: "" }], ["no notes field", { version: "0.99.0" }], ["notes that are not text", { version: "0.99.0", notes: 7 }], ["notes of only #", { version: "0.99.0", notes: "#\n##  \n" }]]) {
    const { ctx, page } = await open({ tauri: true, native: { info } });
    await openApp(page);
    await checkNow(page);
    check(
      `${label}: the version shows and there is no What's new at all`,
      /Version 0\.99\.0 is ready to install\./.test(await note(page)) && (await updateRow(page).locator(".update-notes").count()) === 0,
    );
    await ctx.close();
  }
}
{
  // A long note is cut at six lines and says so.
  const long = Array.from({ length: 10 }, (_, i) => `Change number ${i + 1}`).join("\n");
  const { ctx, page } = await open({ tauri: true, native: { info: { version: "0.99.0", notes: long } } });
  await openApp(page);
  await checkNow(page);
  const body = (await notesOf(page))?.split("\n");
  check(
    "ten lines of notes: the first six, then a line that says '…'",
    body?.length === 7 && body[0] === "Change number 1" && body[5] === "Change number 6" && body[6] === "…",
    JSON.stringify(body),
  );
  await ctx.close();
}
{
  // A staged bundle's notes, from the status.
  const { ctx, page } = await open({ tauri: true, native: { status: { serving: "", pending: "0.98.0", pendingNotes: "## Guide fixes\nA second line" } } });
  await openApp(page);
  await page.waitForTimeout(300);
  const text = await note(page);
  check(
    "a bundle waiting, with notes: 'ready', its notes under it, no #",
    /Version 0\.98\.0 is ready\. It applies the next time you open BlammyTV\./.test(text) && (await notesOf(page)) === "Guide fixes\nA second line",
    JSON.stringify({ text, notes: await notesOf(page) }),
  );
  check("  beside Restart now", (await updateRow(page).getByRole("button", { name: "Restart now" }).count()) === 1);
  await ctx.close();
}
for (const [label, status] of [
  ["without pendingNotes", { serving: "", pending: "0.98.0" }],
  ["with empty pendingNotes", { serving: "", pending: "0.98.0", pendingNotes: "" }],
]) {
  const { ctx, page } = await open({ tauri: true, native: { status } });
  await openApp(page);
  await page.waitForTimeout(300);
  check(
    `a bundle waiting ${label}: 'ready' and nothing extra`,
    /Version 0\.98\.0 is ready\./.test(await note(page)) && (await updateRow(page).locator(".update-notes").count()) === 0,
  );
  await ctx.close();
}
{
  // Notes with nothing pending belong to nothing.
  const { ctx, page } = await open({ tauri: true, native: { status: { serving: "", pending: "", pendingNotes: "Stale notes" } } });
  await openApp(page);
  await page.waitForTimeout(300);
  check("notes with no bundle pending are not shown", (await updateRow(page).locator(".update-notes").count()) === 0);
  await ctx.close();
}
{
  // The installer beats the bundle, and so do its notes.
  const { ctx, page } = await open({
    tauri: true,
    native: { status: { serving: "", pending: "0.98.0", pendingNotes: "Bundle notes" }, info: { version: "0.99.0", notes: "Installer notes" } },
  });
  await openApp(page);
  await page.waitForTimeout(300);
  check("a bundle waiting shows its own notes first", (await notesOf(page)) === "Bundle notes");
  // A waiting bundle takes the Check button's place, so a fresh Settings with
  // none waiting is what a check from the button needs (verify-updates does the same).
  await setNative(page, { status: { serving: "", pending: "" } });
  await closeSettings(page);
  await openApp(page);
  await page.waitForTimeout(300);
  await setNative(page, { status: { serving: "", pending: "0.98.0", pendingNotes: "Bundle notes" } });
  await checkNow(page);
  const text = await note(page);
  check(
    "  and an installer found beats it: the installer's version and the installer's notes, not the bundle's",
    /Version 0\.99\.0 is ready to install\./.test(text) && (await notesOf(page)) === "Installer notes",
    JSON.stringify({ text, notes: await notesOf(page) }),
  );
  await ctx.close();
}

// ====================================================================
// About.
// ====================================================================
{
  const about = { native: "0.11.36", mpv: "0.41.0-dev-g8aca7b0d5", ffmpeg: "7.1.1", bundledFfmpeg: "N-127271-gba987fe24d", vulkan: "Windows' own" };
  const { ctx, page } = await open({ tauri: true, native: { about } });
  // Not asked until the App page is.
  await gear(page).click();
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await rail(page).getByRole("tab", { name: "Sources", exact: true }).click();
  await page.waitForTimeout(400);
  check("about_versions is not asked while Settings is on another page", (await calls(page, "about_versions")).length === 0);
  await rail(page).getByRole("tab", { name: "App", exact: true }).click();
  await page.locator("[data-setting='about'] [data-about='vulkan']").waitFor({ timeout: 5000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll("[data-setting='about'] .about__row")].map((r) => [r.querySelector("dt")?.textContent, r.querySelector("dd")?.textContent]));
  const version = await appVersion(page);
  // Once, or twice in dev: StrictMode runs an effect's mount twice there (the
  // second answer is dropped by the first's cleanup, and a build asks once).
  const askedAbout = (await calls(page, "about_versions")).length;
  await page.waitForTimeout(1200);
  check(
    "  and asked when the App page opens (once, twice under dev's StrictMode), and never again by itself",
    askedAbout >= 1 && askedAbout <= 2 && (await calls(page, "about_versions")).length === askedAbout,
    String(askedAbout),
  );
  check(
    "About lists the app's version and every row native sent, each with its value",
    JSON.stringify(rows) ===
      JSON.stringify([
        ["App", version],
        ["Native build", "0.11.36"],
        ["mpv", "0.41.0-dev-g8aca7b0d5"],
        ["FFmpeg in the player", "7.1.1"],
        ["FFmpeg for multi-view", "N-127271-gba987fe24d"],
        ["Vulkan loader", "Windows' own"],
      ]),
    JSON.stringify(rows),
  );
  const blurb = await page.locator("[data-setting='about'] .settings__section-note").innerText();
  check("  under a one-line note", blurb.length > 0 && !blurb.includes("\n"), blurb);
  const fit = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    return { sideways: body.scrollWidth > body.clientWidth + 1 };
  });
  check("  and it fits", !fit.sideways);
  await ctx.close();
}
{
  // A partial answer: native could tell its own version and nothing else.
  const { ctx, page } = await open({ tauri: true, native: { about: { native: "0.11.36" } } });
  await openApp(page);
  const rows = await page.locator("[data-setting='about'] .about__row dt").allInnerTexts();
  check("a partial answer (only the native build) draws the app's row and that row, no others", JSON.stringify(rows) === JSON.stringify(["App", "Native build"]), JSON.stringify(rows));
  await ctx.close();
}
for (const [label, about] of [
  ["rejecting, as a native build from before it does", "reject"],
  ["answering with nothing", undefined],
  ["answering with something that is not an object", "0.11.36"],
  ["answering with fields that are not text", { native: 7, mpv: { a: 1 }, ffmpeg: null, bundledFfmpeg: "", vulkan: "  " }],
]) {
  const { ctx, page } = await open({ tauri: true, native: { about } });
  await openApp(page);
  await page.waitForTimeout(400);
  const seen = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("[data-setting='about'] .about__row dt")].map((e) => e.textContent),
    text: document.querySelector("[data-setting='about']")?.innerText ?? "",
  }));
  check(
    `about_versions ${label}: only the app's version shows, and no error text`,
    JSON.stringify(seen.rows) === JSON.stringify(["App"]) && !/error|snag|not found|could not|failed|rejected|undefined|null/i.test(seen.text),
    JSON.stringify(seen),
  );
  check("  and nothing unhandled", (await page.evaluate(() => window.__unhandled)).length === 0);
  await ctx.close();
}
{
  // A plain browser has no native side: the app's version, and nothing asked.
  const { ctx, page } = await open({ tauri: false });
  await openApp(page);
  const rows = await page.locator("[data-setting='about'] .about__row dt").allInnerTexts();
  check("a browser (no native at all) shows the app's version alone", JSON.stringify(rows) === JSON.stringify(["App"]), JSON.stringify(rows));
  const titlesNow = await titles(page);
  check("  and the page is Keyboard Shortcuts, About, Replay Onboarding, Clear All Login Info (no update row there)", titlesNow.join("|") === "Keyboard Shortcuts|About|Replay Onboarding|Clear All Login Info", JSON.stringify(titlesNow));
  await ctx.close();
}
{
  // Long values wrap inside the line, and a narrow card still fits.
  const long = { native: "0.11.36", mpv: "0.41.0-dev-g8aca7b0d5-" + "x".repeat(40), bundledFfmpeg: "N-" + "9".repeat(60), vulkan: "BlammyTV's" };
  const { ctx, page } = await open({ tauri: true, width: 560, height: 800, native: { about: long } });
  await openApp(page);
  await page.locator("[data-setting='about'] [data-about='vulkan']").waitFor({ timeout: 5000 });
  const fit = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    return { narrow: !!document.querySelector(".settings__layout--narrow"), sideways: body.scrollWidth > body.clientWidth + 1 };
  });
  check("in the narrow card, long version strings wrap and nothing scrolls sideways", fit.narrow && !fit.sideways, JSON.stringify(fit));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
