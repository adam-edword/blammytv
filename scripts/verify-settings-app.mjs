// E2E: Settings → App gains Keyboard Shortcuts, What's new and About (plan 025,
// P4a; v0.11.36), and Copy Diagnostics and a log the page writes to (P4b), and
// Export and Import Settings (P4c), with the native side stubbed.
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
//     such command, are rows that aren't drawn, with no error;
//   - Privacy and data, Copy Diagnostics (P4b): the versions, the webview and
//     the last 200 lines of the log on the clipboard, all of it scrubbed again
//     on the way (a URL is its origin, a token is <redacted>); an older native
//     with no `log_tail` still copies and says the log wasn't available;
//   - the page's warnings and errors reach native's `app_log`, once each and
//     with a count for a repeat, the console gets them as it always did, and a
//     plain browser sends nothing;
//   - Export and Import Settings (P4c): a file with the settings and no login
//     (no playlist, no manifest, no sign-in, and no favourites, which name the
//     playlists' channels) unless the box is ticked, and then the playlists, the
//     manifest and the favourites but still no sign-in; an import of that file
//     into a fresh page restores a look, a list and the playlists and reloads
//     the window; a file without playlists leaves this PC's favourites and
//     recents as they were; a Trakt, MyAnimeList or TMDB key in the file changes nothing; a
//     file that is not BlammyTV's changes nothing and says so; the two dialogs
//     are native's, stubbed here, and an older native greys both buttons.
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

/** What the native stub answers when a scenario doesn't say. `info`, `update`,
 * `about` and `tail` can be "reject" (a native build that has no such command:
 * the call is refused the way Tauri refuses an unknown one) or, for the first
 * two, "fail" (the check itself failed). */
const NATIVE = {
  status: { serving: "", pending: "" },
  info: null,
  update: null,
  about: undefined,
  // What `log_tail` answers: lines, or "reject" for a native from before the
  // log. Anything that is not a list is a native that answered wrong.
  tail: undefined,
  // What `app_log` does: "reject" for a native from before the log.
  appLog: undefined,
  // Export and Import Settings (P4c). "old" is a native from before them: both
  // commands are "not found". Otherwise `exportAnswer` is what the save dialog
  // gives back (the file name they chose, or null for a closed dialog) and
  // `importAnswer` what the open dialog does (a file's text, or null for a
  // closed dialog). Either can be { reject: "..." } for a command that fails.
  files: "new",
  exportAnswer: "blammytv-settings-test.json",
  importAnswer: null,
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
  // Copy Diagnostics writes to the clipboard, and a check reads it back.
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(APP).origin });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  // What the console was given, as Playwright sees it: [type, text].
  const seen = [];
  page.on("console", (m) => seen.push([m.type(), m.text()]));
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
            if (cmd === "app_log") {
              if (n.appLog === "reject") return refuse(cmd);
              return Promise.resolve();
            }
            if (cmd === "log_tail") {
              if (n.tail === "reject") return refuse(cmd);
              return Promise.resolve(n.tail);
            }
            if (cmd === "settings_export") {
              if (n.files === "old") return refuse(cmd);
              // Saving nothing is the page asking whether this build has the
              // command, and native refuses it before any dialog could open.
              if (!args || !String(args.json ?? "").trim()) return Promise.reject("refused: nothing to save");
              if (n.exportAnswer && typeof n.exportAnswer === "object") return Promise.reject(n.exportAnswer.reject);
              return Promise.resolve(n.exportAnswer);
            }
            if (cmd === "settings_import") {
              if (n.files === "old") return refuse(cmd);
              if (n.importAnswer && typeof n.importAnswer === "object") return Promise.reject(n.importAnswer.reject);
              return Promise.resolve(n.importAnswer);
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
  return { ctx, page, seen };
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
    "App: Updates, Keyboard Shortcuts, About, Replay Onboarding, Copy Diagnostics, Export Settings, Import Settings, then Clear All Login Info",
    rows.length === 8 &&
      /^BlammyTV v/.test(rows[0]) &&
      rows.slice(1).join("|") === "Keyboard Shortcuts|About|Replay Onboarding|Copy Diagnostics|Export Settings|Import Settings|Clear All Login Info",
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
    '"shortcuts", "keyboard" and "keys" each put Keyboard Shortcuts first in the palette, filed under Settings · App',
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
  check(
    "  and the page is Keyboard Shortcuts, About, Replay Onboarding, Copy Diagnostics, Export Settings, Import Settings, Clear All Login Info (no update row there)",
    titlesNow.join("|") === "Keyboard Shortcuts|About|Replay Onboarding|Copy Diagnostics|Export Settings|Import Settings|Clear All Login Info",
    JSON.stringify(titlesNow),
  );
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

// ====================================================================
// Privacy and data: Copy Diagnostics (plan 025, P4b).
// ====================================================================
// Obvious fakes. A real credential does not belong in a committed fixture.
const FAKE_TOKEN = "t0k3n".repeat(8); // 40 characters
const LOG = [
  "[2026-10-12][10:00:00][app_lib::mvproxy][INFO] [mvproxy] listening on 127.0.0.1:49152",
  `[2026-10-12][10:00:05][frontend][WARN] [live] EPG failed: http://host:8080/live/user/pass/1.ts key ${FAKE_TOKEN}`,
  "[2026-10-12][10:00:09][app_lib::mpv][INFO] [mpv-timing] ready 812ms  queued 4ms",
];
const ABOUT = { native: "0.11.36", mpv: "0.41.0-dev-g8aca7b0d5", ffmpeg: "7.1.1", bundledFfmpeg: "N-127271-gba987fe24d", vulkan: "Windows' own" };
const diagRow = (page) => page.locator("[data-setting='copy-diagnostics']");
const diagButton = (page) => diagRow(page).locator("button");
const readClip = (page) => page.evaluate(() => navigator.clipboard.readText());
/** Press Copy and wait for it to say what happened. */
async function pressCopy(page, said = "Copied") {
  await diagButton(page).click();
  await page.waitForFunction(
    (said) => document.querySelector("[data-setting='copy-diagnostics'] button")?.textContent === said,
    said,
    { timeout: 5000 },
  );
}

{
  const { ctx, page } = await open({ tauri: true, native: { about: ABOUT, tail: LOG } });
  await openApp(page);
  const where = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    const heads = [...body.querySelectorAll(".settings__group")];
    const privacy = heads.find((h) => /privacy and data/i.test(h.textContent ?? ""));
    const row = body.querySelector("[data-setting='copy-diagnostics']");
    const clear = body.querySelector("[data-setting='clear-logins']");
    const after = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      heads: heads.map((h) => h.textContent),
      underPrivacy: after(privacy, row),
      beforeClear: after(row, clear),
      note: row?.querySelector(".settings__section-note")?.textContent ?? "",
      noteLines: row?.querySelector(".settings__section-note")?.innerText ?? "",
      buttons: [...(row?.querySelectorAll("button") ?? [])].map((b) => b.textContent),
      anyFolderButton: [...body.querySelectorAll("button")].some((b) => /folder/i.test(b.textContent ?? "")),
      sideways: body.scrollWidth > body.clientWidth + 1,
    };
  });
  check(
    "App has a Privacy and data heading, with Copy Diagnostics under it and above Clear All Login Info",
    where.heads.join("|") === "App|Privacy and data" && where.underPrivacy && where.beforeClear,
    JSON.stringify(where),
  );
  check(
    "  the row has one button, Copy, and a note that says we have no analytics and send no reports",
    where.buttons.join("|") === "Copy" && /no analytics/i.test(where.note) && /no reports/i.test(where.note) && /only when you copy/i.test(where.note) && !where.noteLines.includes("\n") && !where.sideways,
    JSON.stringify(where),
  );
  check("  and no Open Log Folder (open_external opens https addresses and nothing else)", !where.anyFolderButton);
  check("log_tail is not asked until the button is pressed", (await calls(page, "log_tail")).length === 0);

  await pressCopy(page);
  const text = await readClip(page);
  const version = await appVersion(page);
  const ua = await page.evaluate(() => navigator.userAgent);
  check("Copy puts text on the clipboard and says Copied", text.length > 0 && (await diagButton(page).innerText()) === "Copied");
  check(
    "  the app's version and every row native sent, with the webview's user agent",
    text.startsWith("BlammyTV diagnostics, ") &&
      text.includes(`App: ${version}`) &&
      text.includes("Native build: 0.11.36") &&
      text.includes("mpv: 0.41.0-dev-g8aca7b0d5") &&
      text.includes("FFmpeg in the player: 7.1.1") &&
      text.includes("FFmpeg for multi-view: N-127271-gba987fe24d") &&
      text.includes("Vulkan loader: Windows' own") &&
      text.includes(`Webview: ${ua}`),
    JSON.stringify(text.slice(0, 300)),
  );
  check(
    "  and the log's lines, as stubbed",
    text.includes("Log, the last 3 lines:") &&
      text.includes("[mvproxy] listening on 127.0.0.1:49152") &&
      text.includes("[mpv-timing] ready 812ms  queued 4ms") &&
      text.includes("[live] EPG failed: "),
    JSON.stringify(text.slice(-400)),
  );
  check(
    "  the line with a URL is its origin: http://host:8080, none of the path (user, pass, the file)",
    text.includes("http://host:8080") && !text.includes("live/user/pass") && !text.includes("/1.ts") && !/user\/pass/.test(text),
    JSON.stringify(text.split("\n").find((l) => /EPG failed/.test(l))),
  );
  check(
    "  and the 40-character token is <redacted>, and nowhere else",
    text.includes("key <redacted>") && !text.includes(FAKE_TOKEN) && !text.includes(FAKE_TOKEN.slice(0, 12)),
    JSON.stringify(text.split("\n").find((l) => /EPG failed/.test(l))),
  );
  const tails = await calls(page, "log_tail");
  check("  asking log_tail once, for 200 lines", tails.length === 1 && tails[0]?.lines === 200, JSON.stringify(tails));
  await page.waitForTimeout(1900);
  check("  and the button goes back to Copy after a moment", (await diagButton(page).innerText()) === "Copy");
  await pressCopy(page);
  check("  pressing it again copies again", (await calls(page, "log_tail")).length === 2);
  await ctx.close();
}
{
  // A native from before the log: no log_tail. The copy still happens.
  const { ctx, page } = await open({ tauri: true, native: { about: ABOUT, tail: "reject" } });
  await openApp(page);
  await pressCopy(page);
  const text = await readClip(page);
  check(
    "log_tail rejecting (a native from before the log) still copies, and says the log wasn't available",
    (await diagButton(page).innerText()) === "Copied" && /the log wasn't available/.test(text) && !/Log, the last/.test(text),
    JSON.stringify(text.slice(-120)),
  );
  check(
    "  with the versions native did give, and the webview",
    text.includes("Native build: 0.11.36") && text.includes("mpv: 0.41.0-dev-g8aca7b0d5") && text.includes("Webview: "),
  );
  check("  and nothing unhandled", (await page.evaluate(() => window.__unhandled)).length === 0);
  await ctx.close();
}
{
  // A native from before v0.11.36 as well: neither command.
  const { ctx, page } = await open({ tauri: true, native: { about: "reject", tail: "reject" } });
  await openApp(page);
  await pressCopy(page);
  const text = await readClip(page);
  const version = await appVersion(page);
  check(
    "with neither about_versions nor log_tail, it copies the app's version and the webview, and says the log wasn't available",
    text.includes(`App: ${version}`) && text.includes("Webview: ") && /the log wasn't available/.test(text) && !/Native build|mpv:/.test(text),
    JSON.stringify(text),
  );
  await ctx.close();
}
for (const [label, tail] of [
  ["an answer that is not a list", "C:\\Users\\someone\\logs\\blammytv.log"],
  ["no answer", undefined],
]) {
  const { ctx, page } = await open({ tauri: true, native: { about: ABOUT, tail } });
  await openApp(page);
  await pressCopy(page);
  const text = await readClip(page);
  check(
    `log_tail giving ${label}: copied, the log wasn't available, and nothing it said is in the text`,
    /the log wasn't available/.test(text) && !/Users|blammytv\.log/.test(text),
    JSON.stringify(text.slice(-120)),
  );
  await ctx.close();
}
{
  // An empty log is not a missing one.
  const { ctx, page } = await open({ tauri: true, native: { about: ABOUT, tail: [] } });
  await openApp(page);
  await pressCopy(page);
  const text = await readClip(page);
  check("an empty log says it is empty, not that it wasn't available", /Log: empty\./.test(text) && !/wasn't available/.test(text), JSON.stringify(text.slice(-80)));
  await ctx.close();
}
{
  // Lines that arrive with a path in them are scrubbed again by the page.
  const dirty = ["[ERROR] cannot open C:\\Users\\adam\\Videos\\x.mkv", "[WARN] portal mac 00:1A:79:AB:CD:EF"];
  const { ctx, page } = await open({ tauri: true, native: { about: ABOUT, tail: dirty } });
  await openApp(page);
  await pressCopy(page);
  const text = await readClip(page);
  check(
    "a user folder and a MAC address in the log are masked on the way out",
    text.includes("C:\\Users\\…\\Videos\\x.mkv") && text.includes("xx:xx:xx:xx:xx:xx") && !/adam|00:1A/.test(text),
    JSON.stringify(text.slice(-120)),
  );
  await ctx.close();
}
{
  // A plain browser: no native at all. The copy is what the page knows.
  const { ctx, page } = await open({ tauri: false });
  await openApp(page);
  await pressCopy(page);
  const text = await readClip(page);
  const version = await appVersion(page);
  check(
    "a browser copies the app's version and the webview, says the log wasn't available, and asks native for nothing",
    text.includes(`App: ${version}`) && text.includes("Webview: ") && /the log wasn't available/.test(text) && (await calls(page, "log_tail")).length === 0 && (await calls(page, "about_versions")).length === 0,
    JSON.stringify(text),
  );
  await ctx.close();
}
{
  // The clipboard refuses: the button says so, and does not say Copied.
  const { ctx, page } = await open({ tauri: true, native: { about: ABOUT, tail: LOG } });
  await openApp(page);
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
  });
  await pressCopy(page, "Couldn't copy");
  check("a clipboard that refuses: the button says Couldn't copy, not Copied", (await diagButton(page).innerText()) === "Couldn't copy");
  await page.waitForTimeout(1900);
  check("  and goes back to Copy", (await diagButton(page).innerText()) === "Copy");
  check("  and nothing unhandled", (await page.evaluate(() => window.__unhandled)).length === 0);
  await ctx.close();
}
{
  // A narrow card still fits the row.
  const { ctx, page } = await open({ tauri: true, width: 560, height: 800, native: { about: ABOUT, tail: LOG } });
  await openApp(page);
  const fit = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    const row = document.querySelector("[data-setting='copy-diagnostics']").getBoundingClientRect();
    return { narrow: !!document.querySelector(".settings__layout--narrow"), sideways: body.scrollWidth > body.clientWidth + 1, inside: row.right <= body.getBoundingClientRect().right + 0.5 };
  });
  check("in the narrow card the Copy Diagnostics row fits", fit.narrow && !fit.sideways && fit.inside, JSON.stringify(fit));
  await ctx.close();
}

// ====================================================================
// The page's warnings and errors reach native's app_log (plan 025, P4b).
// ====================================================================
/** What native was sent, as {level, line}, that carries the marker. */
const sentLines = async (page, marker) => (await calls(page, "app_log")).filter((c) => (c?.line ?? "").includes(marker));
{
  const { ctx, page, seen } = await open({ tauri: true });
  await page.evaluate((tok) => {
    console.error("btv-once");
    console.warn("btv-warn", 7, { password: "FAKEPASSWORD" });
    console.error("btv-err", new Error("boom"));
    for (let i = 0; i < 20; i++) console.error("btv-repeat");
    console.log("btv-log");
    console.info("btv-info");
    console.debug("btv-debug");
    console.error(`btv-secret failed http://host:8080/live/user/pass/1.ts key ${tok}`);
    window.dispatchEvent(Object.assign(new Event("error"), { message: "Script error.", error: new RangeError("btv-too-far"), lineno: 12, colno: 7 }));
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("btv-nobody-caught-this") }));
    // That rejection was made up for the forwarder, and open()'s own listener
    // wrote it down as one; the check on `__unhandled` below is about the real.
    window.__unhandled.length = 0;
  }, FAKE_TOKEN);
  // Not before the window: a line waits a second for its repeats.
  check("a line waits out its window before it is sent (nothing yet, straight after)", (await sentLines(page, "btv-once")).length === 0);
  await page.waitForTimeout(1700);
  const once = await sentLines(page, "btv-once");
  check("console.error reaches app_log once, as an error", once.length === 1 && once[0].level === "error" && once[0].line === "btv-once", JSON.stringify(once));
  const warn = await sentLines(page, "btv-warn");
  check(
    "console.warn reaches it as a warn, an object as its key names and never its values",
    warn.length === 1 && warn[0].level === "warn" && warn[0].line === "btv-warn 7 {password}" && !JSON.stringify(warn).includes("FAKEPASSWORD"),
    JSON.stringify(warn),
  );
  const err = await sentLines(page, "btv-err");
  check("  an Error as its name and message, with no stack", err.length === 1 && err[0].line === "btv-err Error: boom", JSON.stringify(err));
  const rep = await sentLines(page, "btv-repeat");
  check("twenty identical console.error calls are one line, with the count", rep.length === 1 && rep[0].line === "btv-repeat (repeated 20 times)" && rep[0].level === "error", JSON.stringify(rep));
  check(
    "console.log, console.info and console.debug are not sent",
    (await sentLines(page, "btv-log")).length === 0 && (await sentLines(page, "btv-info")).length === 0 && (await sentLines(page, "btv-debug")).length === 0,
  );
  const secret = await sentLines(page, "btv-secret");
  check(
    "a line with a URL and a token is scrubbed before it is sent: the origin, and <redacted>",
    secret.length === 1 && secret[0].line === "btv-secret failed http://host:8080/… key <redacted>" && !JSON.stringify(secret).includes(FAKE_TOKEN) && !JSON.stringify(secret).includes("user/pass"),
    JSON.stringify(secret),
  );
  const thrown = await sentLines(page, "btv-too-far");
  const rejected = await sentLines(page, "btv-nobody-caught-this");
  check(
    "an uncaught error and an unhandled rejection are sent, as errors",
    thrown.length === 1 && thrown[0].line === "Uncaught: RangeError: btv-too-far (line 12:7)" && thrown[0].level === "error" && rejected.length === 1 && rejected[0].line === "Unhandled rejection: Error: btv-nobody-caught-this",
    JSON.stringify({ thrown, rejected }),
  );
  // The console got every one of them, as it always did: the secret line as it was written.
  const saw = (type, text) => seen.filter((m) => m[0] === type && m[1] === text).length;
  check(
    "the console still gets every call as before: twenty repeats, the log and the info, and the secret line unscrubbed",
    saw("error", "btv-once") === 1 &&
      saw("error", "btv-repeat") === 20 &&
      saw("log", "btv-log") === 1 &&
      saw("info", "btv-info") === 1 &&
      seen.some((m) => m[0] === "error" && m[1] === `btv-secret failed http://host:8080/live/user/pass/1.ts key ${FAKE_TOKEN}`),
    JSON.stringify(seen.filter((m) => /btv-/.test(m[1])).slice(0, 4)),
  );
  check(
    "  and the warning with its object, as the console always printed it",
    seen.some((m) => m[0] === "warning" && m[1].startsWith("btv-warn 7")),
    JSON.stringify(seen.filter((m) => /btv-warn/.test(m[1]))),
  );
  check("  and nothing unhandled came of it", (await page.evaluate(() => window.__unhandled)).length === 0);
  await ctx.close();
}
{
  // A burst of different lines is held to 50 a minute.
  const { ctx, page } = await open({ tauri: true });
  await page.evaluate(() => {
    for (let i = 0; i < 80; i++) console.warn(`btv-cap line ${i}`);
  });
  await page.waitForTimeout(1700);
  const all = await calls(page, "app_log");
  const mine = await sentLines(page, "btv-cap");
  check(
    "eighty different lines in a burst: 50 are sent, in order, and that is all that is sent in the minute",
    all.length === 50 && mine.length >= 40 && mine[0].line === "btv-cap line 0" && mine[1].line === "btv-cap line 1",
    JSON.stringify({ all: all.length, mine: mine.length }),
  );
  await ctx.close();
}
{
  // A native with no app_log: the page logs on, quietly.
  const { ctx, page, seen } = await open({ tauri: true, native: { appLog: "reject" } });
  await page.evaluate(() => {
    console.error("btv-refused");
    console.warn("btv-refused-too");
  });
  await page.waitForTimeout(1700);
  check("app_log was asked for both lines, and refused", (await sentLines(page, "btv-refused")).length === 2);
  check(
    "  and being refused is swallowed: nothing unhandled, nothing extra on the console, the console still has its lines",
    (await page.evaluate(() => window.__unhandled)).length === 0 &&
      seen.filter((m) => /btv-refused/.test(m[1])).length === 2 &&
      seen.filter((m) => m[0] === "error" && !/btv-refused/.test(m[1]) && /app_log|not found/i.test(m[1])).length === 0,
    JSON.stringify(seen.filter((m) => /app_log|not found/i.test(m[1]))),
  );
  await ctx.close();
}
{
  // A plain browser: console is the browser's own, and nothing is sent.
  const { ctx, page, seen } = await open({ tauri: false });
  const got = await page.evaluate(() => {
    console.error("btv-browser");
    return { native: /\[native code\]/.test(Function.prototype.toString.call(console.error)) && /\[native code\]/.test(Function.prototype.toString.call(console.warn)) };
  });
  await page.waitForTimeout(1500);
  check(
    "in a browser (no Tauri) the console is left alone and app_log is never asked",
    got.native && (await calls(page, "app_log")).length === 0 && seen.some((m) => m[0] === "error" && m[1] === "btv-browser"),
    JSON.stringify(got),
  );
  await ctx.close();
}

// ====================================================================
// Export and Import Settings (plan 025, P4c). The dialogs are native's and
// stubbed here: `settings_export` is handed the file's text and a name and
// answers the name it was saved as, `settings_import` answers a file's text.
// ====================================================================
// Obvious fakes. A real credential does not belong in a committed fixture.
const FAKE_PASSWORD = "FAKE-PASSWORD-NOT-REAL";
const FAKE_MANIFEST = "http://aio.example.invalid/FAKE-CONFIG/manifest.json";
const FAKE_TMDB = "FAKE-TMDB-KEY-NOT-REAL";
const FAKE_RPDB = "FAKE-RPDB-KEY-NOT-REAL";
/** Artwork as a stored title has it: RPDB puts the key in the path, metahub (what Cinemeta serves) has none. */
const RPDB_ART = `https://api.ratingposterdb.com/${FAKE_RPDB}/imdb/poster-default/tt0000001.jpg?fallback=true`;
const METAHUB_ART = "https://images.metahub.space/background/medium/tt0000002/img";
const METAHUB_LOGO = "https://images.metahub.space/logo/medium/tt0000001/img";
/** Signed-in AIOStreams' artwork as it really is (aiojf/browse.ts:88): a 32 hex item id and a tag that is an
 * 11 character signature, a host code and the base64url of the rest of the address. Code 2 is TMDB's image
 * host; code 0 is a whole address, which is where an RPDB poster arrives, its key inside. */
const AIO_ID = "0123456789abcdef0123456789abcdef";
const tagOf = (code, rest) => `abcdefghijk${code}${Buffer.from(rest).toString("base64url")}`;
const AIO_ART_OK = `http://aiojf.example.invalid/Items/${AIO_ID}/Images/Backdrop/0?tag=${encodeURIComponent(tagOf("2", "original/shawshank-bg.jpg"))}`;
const AIO_ART_KEYED = `http://aiojf.example.invalid/Items/${AIO_ID}/Images/Primary?tag=${encodeURIComponent(tagOf("0", RPDB_ART))}`;
/** The key as it travels inside that tag, which a plain search for the key would not find. */
const RPDB_ENCODED = Buffer.from(RPDB_ART).toString("base64url");
const SECRETS = [FAKE_PASSWORD, "FAKE-CONFIG", "fake-user", FAKE_TMDB, FAKE_RPDB, RPDB_ENCODED];
/** What the old PC has stored: a look, lists, the logins, and the things that
 * are never in a file (the sign-ins' bookkeeping and queues, a key, caches). */
const NEVER_KEYS = ["trakt", "traktQueue", "mal", "aiojf", "aiojfQueue", "tmdbKey", "vodCache", "malWatched", "aioWatched", "aiojfIds", "aniskipIndex"];
const OLD_PC = {
  startupTab: { v: 1, data: "live" },
  accent: { v: 2, data: "#3366cc" },
  oneClickPlay: { v: 1, data: true },
  lists: { v: 1, data: [{ id: "l1", name: "Weekend", at: 1, entries: [{ id: "tt0000001", title: "Fake Film", kind: "movie", poster: RPDB_ART, at: 1 }, { id: "tt0000002", title: "Plain Film", kind: "movie", poster: METAHUB_ART, at: 1 }] }] },
  watching: { v: 1, data: [{ id: "tt0000001", title: "Keyed Film", art: RPDB_ART, logo: METAHUB_LOGO, at: 4 }, { id: "tt0000002", title: "Plain Film", art: METAHUB_ART, at: 3 }, { id: "tt0000003", title: "Signed-in Film", art: AIO_ART_OK, at: 2 }, { id: "tt0000004", title: "Signed-in Keyed Film", art: AIO_ART_KEYED, at: 1 }] },
  favorites: { v: 1, data: ["p1:101", "p1:102"] },
  playlists: { v: 1, data: [{ kind: "xtream", id: "p1", name: "Fake Xtream", enabled: true, server: "http://iptv.example.invalid:8080", username: "fake-user", password: FAKE_PASSWORD }] },
  aiostreams: { v: 1, data: FAKE_MANIFEST },
  heroSources: { v: 1, data: ["movie:fake-catalog"] },
  trakt: { v: 1, data: { lastSync: 111 } },
  traktQueue: { v: 1, data: [] },
  mal: { v: 1, data: { lastSync: 222, counts: { 1: 3 }, pending: {}, problem: null } },
  aiojf: { v: 1, data: { lastSync: 333 } },
  aiojfQueue: { v: 1, data: [] },
  tmdbKey: { v: 1, data: FAKE_TMDB },
  vodCache: { v: 1, data: { key: `manifest:${FAKE_MANIFEST}`, items: [] } },
  malWatched: { v: 1, data: { tt1: ["tt1:1:1"] } },
  aioWatched: { v: 1, data: { episodes: {}, films: [] } },
  aiojfIds: { v: 1, data: { base: "http://aiojf.example.invalid", pairs: [] } },
  aniskipIndex: { v: 1, data: { at: 1, map: {} } },
};
/** A PC that is not set up: nothing of the old one's, and a sign-in of its own. */
const NEW_PC = {
  accent: { v: 2, data: "#aa1111" },
  trakt: { v: 1, data: { lastSync: 777 } },
  mal: { v: 1, data: { lastSync: 888, counts: {}, pending: {}, problem: null } },
  tmdbKey: { v: 1, data: "THIS-PCS-OWN-KEY" },
};

const exportRow = (page) => page.locator("[data-setting='export-settings']");
const importRow = (page) => page.locator("[data-setting='import-settings']");
const exportBtn = (page) => exportRow(page).locator(":scope > button");
const importBtn = (page) => importRow(page).locator(":scope > button");
const box = (page) => exportRow(page).getByRole("checkbox");
/** What the save dialog was handed: the page's own "is there such a command"
 * call, which saves nothing, left out. */
const saves = async (page) => (await calls(page, "settings_export")).filter((c) => String(c?.json ?? "").trim());
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(`blammytv.${k}`), key);
const storedJson = async (page, key) => JSON.parse((await stored(page, key)) ?? "null");
/** Every key the app stores, with its text. */
const everything = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("blammytv."))
        .sort()
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
const navType = (page) => page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type);
const mark = (page) => page.evaluate(() => (window.__marker = 1));
const marked = (page) => page.evaluate(() => window.__marker === 1);
const said = async (page, row) => {
  const el = row(page).locator(".settings-said");
  return (await el.count()) ? (await el.first().innerText()).trim() : null;
};
/** Press Export and wait for the stub to have been asked (and the row to settle). */
async function pressExport(page, n = 1) {
  await exportBtn(page).click();
  await page.waitForFunction((n) => window.__calls.filter((c) => c[0] === "settings_export" && String(c[1]?.json ?? "").trim()).length >= n, n, { timeout: 5000 });
  await page.waitForTimeout(250);
}
/** The two presses of Import, and then what a closed file chooser leaves. */
async function pressImport(page, { reloads }) {
  await importBtn(page).click();
  const armed = await importBtn(page).innerText();
  const load = reloads ? page.waitForEvent("load", { timeout: 15_000 }) : null;
  await importBtn(page).click();
  if (load) {
    await load;
    await page.waitForSelector(".navcap", { timeout: 20_000 });
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(500);
  }
  return armed;
}
const hasKey = (file, k) => Object.prototype.hasOwnProperty.call(file.keys, k);

let TICKED = null; // the file a ticked export wrote, for the imports below
let UNTICKED = null;
{
  const { ctx, page, seen } = await open({ tauri: true, store: OLD_PC });
  await openApp(page);

  // ------------------------------------------------------------ the rows
  const where = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    const heads = [...body.querySelectorAll(".settings__group")];
    const privacy = heads.find((h) => /privacy and data/i.test(h.textContent ?? ""));
    const at = (id) => body.querySelector(`[data-setting='${id}']`);
    const after = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      heads: heads.map((h) => h.textContent),
      order:
        after(privacy, at("copy-diagnostics")) &&
        after(at("copy-diagnostics"), at("export-settings")) &&
        after(at("export-settings"), at("import-settings")) &&
        after(at("import-settings"), at("clear-logins")),
      sections: new Set([at("copy-diagnostics"), at("export-settings"), at("import-settings")].map((e) => e?.closest("section"))).size,
      exportNote: at("export-settings")?.querySelector(".settings__section-note")?.textContent ?? "",
      importNote: at("import-settings")?.querySelector(".settings__section-note")?.textContent ?? "",
      boxLabel: at("export-settings")?.querySelector(".settings-check")?.textContent?.trim(),
      sideways: body.scrollWidth > body.clientWidth + 1,
    };
  });
  check(
    "Privacy and data holds Copy Diagnostics, Export Settings and Import Settings in that order, in one section, and Clear All Login Info stays after them",
    where.heads.join("|") === "App|Privacy and data" && where.order && where.sections === 1,
    JSON.stringify(where),
  );
  check(
    "  Export says what goes in it and that the sign-ins never do; Import says your settings are replaced, the sign-ins stay, and a file's playlists and AIOStreams replace yours",
    /looks, playback settings, lists/i.test(where.exportNote) && /Trakt, MyAnimeList, AIOStreams and Jellyfin sign-ins never go in it/.test(where.exportNote) &&
      /settings are replaced/i.test(where.importNote) && /sign-ins stay/i.test(where.importNote) && /playlists and AIOStreams, they replace yours/i.test(where.importNote),
    JSON.stringify({ e: where.exportNote, i: where.importNote }),
  );
  check(
    "  the box reads 'Include playlists and AIOStreams (has your passwords in it)' and is off",
    where.boxLabel === "Include playlists and AIOStreams (has your passwords in it)" && !(await box(page).isChecked()),
    where.boxLabel,
  );
  check(
    "  the buttons are Export… and, behind two presses, Import…; neither is greyed on a native that has the commands",
    (await exportBtn(page).innerText()) === "Export…" &&
      (await importBtn(page).innerText()) === "Import…" &&
      (await exportBtn(page).getAttribute("aria-disabled")) === null &&
      (await importBtn(page).getAttribute("aria-disabled")) === null &&
      !where.sideways,
  );
  const asked = await calls(page, "settings_export");
  check(
    "the page found out the native has the command by saving nothing (an empty file, which native refuses before a dialog), once; and nothing was exported or opened by looking",
    asked.length >= 1 && asked.length <= 2 && asked.every((c) => !String(c?.json ?? "").trim()) && (await calls(page, "settings_import")).length === 0,
    JSON.stringify(asked),
  );

  // ------------------------------------------------------------ export, box off
  const neverHere = await page.evaluate((ks) => ks.filter((k) => localStorage.getItem(`blammytv.${k}`) !== null), NEVER_KEYS);
  check("  (the never keys are stored when the export is pressed, so their absence from the file means something)", neverHere.length >= 8, JSON.stringify(neverHere));
  await pressExport(page, 1);
  const first = (await saves(page))[0];
  UNTICKED = JSON.parse(first.json);
  const version = await appVersion(page);
  const today = await page.evaluate(() => {
    const d = new Date();
    const two = (n) => String(n).padStart(2, "0");
    return `blammytv-settings-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.json`;
  });
  check(
    "Export with the box off asks the save dialog once, to start on blammytv-settings-<today>.json, and the page is handed nothing but a name",
    (await saves(page)).length === 1 && first.suggested === today && /^blammytv-settings-\d{4}-\d{2}-\d{2}\.json$/.test(first.suggested) && Object.keys(first).sort().join() === "json,suggested",
    JSON.stringify({ suggested: first.suggested, today, keys: Object.keys(first) }),
  );
  check(
    "  the file is BlammyTV's settings file, format 1, this app's version, an ISO time, includesLogins false",
    UNTICKED.app === "BlammyTV" && UNTICKED.kind === "settings" && UNTICKED.format === 1 && UNTICKED.version === version && !Number.isNaN(Date.parse(UNTICKED.exported)) && UNTICKED.exported.endsWith("Z") && UNTICKED.includesLogins === false,
    JSON.stringify({ ...UNTICKED, keys: Object.keys(UNTICKED.keys) }),
  );
  check(
    "  it holds the look, the list and the playback setting, each as the stored envelope, and not the favourites: they name the old PC's playlists' channels, and travel with the playlists",
    JSON.stringify(UNTICKED.keys.accent) === JSON.stringify({ v: 2, data: "#3366cc" }) &&
      UNTICKED.keys.lists?.data?.[0]?.name === "Weekend" &&
      !hasKey(UNTICKED, "favorites") &&
      !first.json.includes("p1:101") &&
      UNTICKED.keys.oneClickPlay?.data === true &&
      UNTICKED.keys.startupTab?.data === "live",
    JSON.stringify(Object.keys(UNTICKED.keys)),
  );
  check(
    "  and no playlist, no manifest, no hero source: not as keys, and not a character of their passwords anywhere in the text",
    !["playlists", "aiostreams", "heroSources"].some((k) => hasKey(UNTICKED, k)) && !SECRETS.some((s) => first.json.includes(s)) && !first.json.includes("iptv.example.invalid"),
    JSON.stringify(Object.keys(UNTICKED.keys)),
  );
  const stillStored = await storedJson(page, "watching");
  const unW = UNTICKED.keys.watching?.data ?? [];
  const unL = UNTICKED.keys.lists?.data?.[0]?.entries ?? [];
  check(
    "  Continue Watching keeps both entries, and the one whose art is an RPDB address has no art (its logo, title and time stay), where the one with a metahub address keeps it",
    stillStored.data[0].art === RPDB_ART &&
      unW.length === 4 &&
      unW[0].id === "tt0000001" && unW[0].title === "Keyed Film" && unW[0].logo === METAHUB_LOGO && unW[0].at === 4 && !("art" in unW[0]) &&
      unW[1].id === "tt0000002" && unW[1].art === METAHUB_ART,
    JSON.stringify(unW),
  );
  check(
    "  and a signed-in AIOStreams title, its art a 32 hex id and a code 2 tag, keeps its art as stored; the one whose code 0 tag holds an RPDB address keeps its entry and loses the art",
    stillStored.data[3].art === AIO_ART_KEYED &&
      unW[2].id === "tt0000003" && unW[2].art === AIO_ART_OK &&
      unW[3].id === "tt0000004" && unW[3].title === "Signed-in Keyed Film" && unW[3].at === 1 && !("art" in unW[3]),
    JSON.stringify(unW.slice(2)),
  );
  check(
    "  and a list keeps both entries, the RPDB poster gone from the first and the metahub one on the second",
    unL.length === 2 && unL[0].id === "tt0000001" && unL[0].title === "Fake Film" && !("poster" in unL[0]) && unL[1].poster === METAHUB_ART,
    JSON.stringify(unL),
  );
  check(
    "  and not a character of the RPDB key, nor its host, anywhere in the text",
    !first.json.includes(FAKE_RPDB) && !first.json.includes("ratingposterdb") && !first.json.includes(RPDB_ENCODED),
  );
  check(
    "  and not the key as the AIOStreams tag carries it (base64url of the address), which a search for the key would not find",
    !first.json.includes(RPDB_ENCODED) && !first.json.includes(encodeURIComponent(tagOf("0", RPDB_ART))),
  );
  check(
    "  and no sign-in, key or cache: none of the never keys, and not the one thing a sign-in's bookkeeping or a TMDB key says",
    !NEVER_KEYS.some((k) => hasKey(UNTICKED, k)) && !/lastSync|THIS-PCS|FAKE-TMDB/.test(first.json),
    JSON.stringify(Object.keys(UNTICKED.keys)),
  );
  const savedLine = await said(page, exportRow);
  check("  then the row says 'Saved as blammytv-settings-test.json', the name the dialog gave, no folder", savedLine === "Saved as blammytv-settings-test.json", String(savedLine));

  // ------------------------------------------------------------ export, box on
  await box(page).check();
  check("ticking the box leaves the 'Saved as' line where it is (the next export clears it)", (await said(page, exportRow)) === "Saved as blammytv-settings-test.json");
  await pressExport(page, 2);
  const second = (await saves(page))[1];
  TICKED = JSON.parse(second.json);
  check(
    "Export with the box ticked writes includesLogins true, with the playlists, the manifest and the hero sources as stored",
    TICKED.includesLogins === true &&
      TICKED.keys.playlists?.data?.[0]?.password === FAKE_PASSWORD &&
      TICKED.keys.aiostreams?.data === FAKE_MANIFEST &&
      JSON.stringify(TICKED.keys.heroSources?.data) === JSON.stringify(["movie:fake-catalog"]),
    JSON.stringify(Object.keys(TICKED.keys)),
  );
  check(
    "  and the favourites that name those playlists' channels, as stored",
    JSON.stringify(TICKED.keys.favorites) === JSON.stringify({ v: 1, data: ["p1:101", "p1:102"] }),
    JSON.stringify(TICKED.keys.favorites),
  );
  const tkW = TICKED.keys.watching?.data ?? [];
  const tkL = TICKED.keys.lists?.data?.[0]?.entries ?? [];
  check(
    "  and every artwork address as stored, keyed or not: all four Continue Watching entries (the signed-in AIOStreams ones too) and both list posters",
    tkW.length === 4 && tkW[0].art === RPDB_ART && tkW[1].art === METAHUB_ART && tkW[2].art === AIO_ART_OK && tkW[3].art === AIO_ART_KEYED && tkL.length === 2 && tkL[0].poster === RPDB_ART && tkL[1].poster === METAHUB_ART,
    JSON.stringify({ tkW, tkL }),
  );
  check(
    "  and still no sign-in, key or cache, ticked or not",
    !NEVER_KEYS.some((k) => hasKey(TICKED, k)) && !/lastSync|FAKE-TMDB/.test(second.json),
    JSON.stringify(Object.keys(TICKED.keys)),
  );
  check(
    "  and everything else the unticked file had, unchanged (the two keys that hold artwork have the same entries, with the artwork back)",
    Object.keys(UNTICKED.keys).every((k) => ["watching", "lists"].includes(k) || JSON.stringify(TICKED.keys[k]) === JSON.stringify(UNTICKED.keys[k])) &&
      ["watching", "lists"].every((k) => TICKED.keys[k]?.v === UNTICKED.keys[k]?.v) &&
      // The box adds the playlists, the manifest, the hero sources and the
      // favourites (the one key of withPlaylists this harness seeds).
      Object.keys(TICKED.keys).length === Object.keys(UNTICKED.keys).length + 4,
    `${Object.keys(UNTICKED.keys).length} / ${Object.keys(TICKED.keys).length}`,
  );

  // ------------------------------------------------------------ the box is off every time
  await rail(page).getByRole("tab", { name: "Sources", exact: true }).click();
  await page.waitForTimeout(300);
  await rail(page).getByRole("tab", { name: "App", exact: true }).click();
  await page.locator("[data-setting='export-settings']").waitFor({ timeout: 5000 });
  check("leaving the App page and coming back: the box is off again, and the 'Saved as' line is gone", !(await box(page).isChecked()) && (await said(page, exportRow)) === null);
  await box(page).check();
  await closeSettings(page);
  await openApp(page);
  check("  and closing Settings and opening it: off again", !(await box(page).isChecked()));

  // ------------------------------------------------------------ what a closed dialog and a failure say
  await setNative(page, { exportAnswer: null });
  await pressExport(page, 3);
  check("a closed save dialog says nothing: no 'Saved as', no error", (await said(page, exportRow)) === null);
  await setNative(page, { exportAnswer: { reject: "could not write the file: Access is denied. (os error 5)" } });
  await pressExport(page, 4);
  const failed = await said(page, exportRow);
  check("a write that fails says 'Couldn't save the file.' and none of what the system said", failed === "Couldn't save the file." && !/denied|os error/i.test(failed), String(failed));
  await setNative(page, { exportAnswer: { reject: "too-big" } });
  await pressExport(page, 5);
  check("a file over native's cap says so in a line", (await said(page, exportRow)) === "That's too big to save as a file.");
  await setNative(page, { exportAnswer: "blammytv-settings-test.json" });
  await pressExport(page, 6);
  check("  and the next export, answered, says Saved as again", (await said(page, exportRow)) === "Saved as blammytv-settings-test.json");

  // ------------------------------------------------------------ nothing reaches the log
  await page.waitForTimeout(1500);
  const logged = (await calls(page, "app_log")).map((c) => c?.line ?? "");
  const consoleText = seen.map((m) => m[1]).join("\n");
  check(
    "exporting logs nothing: no line sent to app_log and nothing on the console holds a password, the manifest, the file's text or the word of a file",
    ![...logged, consoleText].some((t) => SECRETS.some((s) => t.includes(s)) || t.includes("includesLogins") || /blammytv-settings/.test(t)),
    JSON.stringify(logged.slice(0, 3)),
  );
  await closeSettings(page);
  await ctx.close();
}

// ----------------------------------------------------------------- import
{
  // A new PC, and the ticked file.
  const { ctx, page, seen } = await open({ tauri: true, store: NEW_PC, native: { importAnswer: JSON.stringify(TICKED) } });
  await openApp(page);
  await mark(page);
  const before = await everything(page);
  const armed = await importBtn(page).evaluate(async (el) => {
    el.click();
    await new Promise((r) => setTimeout(r, 60));
    return el.textContent;
  });
  check("the first press of Import only arms it: the label says what the second does, and no file chooser has opened", armed === "Click again to replace" && (await calls(page, "settings_import")).length === 0, armed);
  const load = page.waitForEvent("load", { timeout: 15_000 });
  await importBtn(page).click();
  await load;
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.waitForTimeout(500);
  check("the second press opens the file chooser (settings_import), and the window reloads", (await navType(page)) === "reload" && !(await marked(page)));
  const after = await everything(page);
  check("  the look comes in: the accent is the file's, as the envelope it was, and the page wears it", JSON.stringify(await storedJson(page, "accent")) === JSON.stringify({ v: 2, data: "#3366cc" }) && (await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))) === "#3366cc", String(after["blammytv.accent"]));
  check(
    "  the list, the favourites, the playback setting and the start tab come in",
    (await storedJson(page, "lists")).data[0].name === "Weekend" && JSON.stringify((await storedJson(page, "favorites")).data) === JSON.stringify(["p1:101", "p1:102"]) && (await storedJson(page, "oneClickPlay")).data === true && (await storedJson(page, "startupTab")).data === "live",
  );
  check(
    "  and a ticked file's artwork comes in as it was, the RPDB address too (import is unchanged)",
    (await storedJson(page, "watching")).data[0].art === RPDB_ART && (await storedJson(page, "watching")).data[3].art === AIO_ART_KEYED && (await storedJson(page, "lists")).data[0].entries[0].poster === RPDB_ART,
  );
  check(
    "  and the file had them, so the playlists, the manifest and the hero sources come in too",
    (await storedJson(page, "playlists")).data[0].password === FAKE_PASSWORD && (await storedJson(page, "aiostreams")).data === FAKE_MANIFEST && JSON.stringify((await storedJson(page, "heroSources")).data) === JSON.stringify(["movie:fake-catalog"]),
  );
  check(
    "  this PC's own Trakt, MyAnimeList and TMDB key are exactly as they were",
    after["blammytv.trakt"] === before["blammytv.trakt"] && after["blammytv.mal"] === before["blammytv.mal"] && after["blammytv.tmdbKey"] === before["blammytv.tmdbKey"] && !!before["blammytv.tmdbKey"],
    JSON.stringify({ trakt: after["blammytv.trakt"], tmdb: after["blammytv.tmdbKey"] }),
  );
  const consoleText = seen.map((m) => m[1]).join("\n");
  const logged = (await calls(page, "app_log")).map((c) => c?.line ?? "");
  check("  and importing logs nothing of the file: no password, no manifest, in app_log or on the console", ![...logged, consoleText].some((t) => SECRETS.some((s) => t.includes(s))));
  await ctx.close();
}
{
  // The same, but a file made with the box off: this PC's own playlists stay.
  const own = { v: 1, data: [{ kind: "xtream", id: "mine", name: "Mine", enabled: true, server: "http://mine.example.invalid:8080", username: "mine", password: "MINE-NOT-REAL" }] };
  const ownFavs = { v: 1, data: ["mine:7", "mine:8"] };
  const ownRecents = { v: 1, data: ["mine:8"] };
  const { ctx, page } = await open({ tauri: true, store: { ...NEW_PC, playlists: own, aiostreams: { v: 1, data: "http://mine.example.invalid/m.json" }, favorites: ownFavs, recents: ownRecents }, native: { importAnswer: JSON.stringify(UNTICKED) } });
  await openApp(page);
  await mark(page);
  await pressImport(page, { reloads: true });
  check(
    "a file made with the box off brings the look and the lists and leaves this PC's playlists and manifest where they were",
    (await storedJson(page, "accent")).data === "#3366cc" && (await storedJson(page, "lists")).data[0].name === "Weekend" && JSON.stringify(await storedJson(page, "playlists")) === JSON.stringify(own) && (await storedJson(page, "aiostreams")).data === "http://mine.example.invalid/m.json",
  );
  check(
    "  and this PC's own favourites and recents, which name its playlists' channels, are exactly as they were",
    JSON.stringify(await storedJson(page, "favorites")) === JSON.stringify(ownFavs) && JSON.stringify(await storedJson(page, "recents")) === JSON.stringify(ownRecents),
  );
  const arrived = (await storedJson(page, "watching")).data;
  check(
    "  and Continue Watching comes in as it was written: the entry with no art for the RPDB one, the metahub one with its art",
    arrived.length === 4 && arrived[0].title === "Keyed Film" && !("art" in arrived[0]) && arrived[1].art === METAHUB_ART && arrived[2].art === AIO_ART_OK && !("art" in arrived[3]) && !SECRETS.some((x) => JSON.stringify(arrived).includes(x)),
  );
  await ctx.close();
}
{
  // A file from a build before the favourites travelled with the playlists: no box, and the favourites in it anyway.
  const legacy = { ...UNTICKED, keys: { ...UNTICKED.keys, favorites: OLD_PC.favorites } };
  const mine = { v: 1, data: ["mine:7"] };
  const { ctx, page } = await open({ tauri: true, store: { ...NEW_PC, favorites: mine }, native: { importAnswer: JSON.stringify(legacy) } });
  await openApp(page);
  await pressImport(page, { reloads: true });
  check(
    "an older build's file, made with the box off but with favourites in it: this PC's favourites stay, and the look still comes in",
    JSON.stringify(await storedJson(page, "favorites")) === JSON.stringify(mine) && (await storedJson(page, "accent")).data === "#3366cc",
  );
  await ctx.close();
}
{
  // A hand-edited file: the sign-ins, a key and a cache are in it, and so are the logins with the box not ticked.
  const edited = JSON.parse(JSON.stringify(TICKED));
  edited.keys.trakt = { v: 1, data: { lastSync: 999 } };
  edited.keys.traktQueue = { v: 1, data: ["x"] };
  edited.keys.mal = { v: 1, data: { lastSync: 999, counts: {}, pending: {}, problem: null } };
  edited.keys.aiojf = { v: 1, data: { lastSync: 999 } };
  edited.keys.tmdbKey = { v: 1, data: "KEY-FROM-THE-FILE" };
  edited.keys.vodCache = { v: 1, data: { key: "from-the-file" } };
  edited.keys.settingsTab = { v: 1, data: "playback" };
  edited.keys.sportsTheaterSideWidth = { v: 1, data: 999 };
  edited.keys.fromANewerBuild = { v: 1, data: "x" };
  const NEVER = ["trakt", "traktQueue", "mal", "aiojf", "tmdbKey", "vodCache", "sportsTheaterSideWidth", "fromANewerBuild"];
  const { ctx, page } = await open({ tauri: true, store: { ...NEW_PC, traktQueue: { v: 1, data: [] }, aiojf: { v: 1, data: { lastSync: 5 } }, vodCache: { v: 1, data: { key: "mine" } } }, native: { importAnswer: JSON.stringify(edited) } });
  await openApp(page);
  const before = await everything(page);
  await pressImport(page, { reloads: true });
  const after = await everything(page);
  check(
    "a file with a Trakt, MyAnimeList, AIOStreams sign-in, a TMDB key, a cache and window state in it, ticked: the stubbed Trakt store and the rest are untouched, and the look still comes in",
    NEVER.every((k) => after[`blammytv.${k}`] === before[`blammytv.${k}`]) && !(after["blammytv.trakt"] ?? "").includes("999") && !JSON.stringify(after).includes("KEY-FROM-THE-FILE") && (await storedJson(page, "accent")).data === "#3366cc",
    JSON.stringify(NEVER.filter((k) => after[`blammytv.${k}`] !== before[`blammytv.${k}`])),
  );
  check("  and the settings tab (window state) is this PC's, not the file's", !(after["blammytv.settingsTab"] ?? "").includes("playback") || (before["blammytv.settingsTab"] ?? "") === (after["blammytv.settingsTab"] ?? ""));
  await ctx.close();
}
{
  // The same hand-edited file with includesLogins false: the logins in it are not taken.
  const edited = JSON.parse(JSON.stringify(TICKED));
  edited.includesLogins = false;
  const { ctx, page } = await open({ tauri: true, store: NEW_PC, native: { importAnswer: JSON.stringify(edited) } });
  await openApp(page);
  await pressImport(page, { reloads: true });
  check(
    "a file that holds playlists but says includesLogins is false: the playlists and the manifest are not taken, the rest is",
    (await stored(page, "playlists")) === null && (await stored(page, "aiostreams")) === null && (await stored(page, "heroSources")) === null && (await storedJson(page, "accent")).data === "#3366cc",
  );
  await ctx.close();
}

// What a file that is no use leaves, and says.
for (const [label, answer, line] of [
  ["a JSON file that is not BlammyTV's", JSON.stringify({ name: "other", version: "1.0.0", settings: { theme: "dark" } }), "That isn't a BlammyTV settings file."],
  ["text that is not JSON", "this is just a text file\nwith two lines", "That isn't a BlammyTV settings file."],
  ["an empty file", "", "That isn't a BlammyTV settings file."],
  ["a BlammyTV file of the wrong kind", JSON.stringify({ app: "BlammyTV", kind: "diagnostics", format: 1, keys: {} }), "That isn't a BlammyTV settings file."],
  ["another app's settings file", JSON.stringify({ ...TICKED, app: "Telly" }), "That isn't a BlammyTV settings file."],
  ["a file from a newer format", JSON.stringify({ ...TICKED, format: 2 }), "That settings file is from a newer BlammyTV. Update the app, then try again."],
  ["a file with nothing for this build in it", JSON.stringify({ ...TICKED, keys: { trakt: { v: 1, data: {} }, fromANewerBuild: { v: 1, data: 1 } } }), "There is nothing in that file to import."],
  ["a file that is too big", { reject: "too-big" }, "That file is too big to be a settings file."],
  ["a file that is not text", { reject: "not-text" }, "That isn't a BlammyTV settings file."],
  ["a file the system would not read", { reject: "could not read the file: Access is denied. (os error 5)" }, "Couldn't read that file."],
]) {
  const { ctx, page } = await open({ tauri: true, store: NEW_PC, native: { importAnswer: answer } });
  await openApp(page);
  await mark(page);
  const before = await everything(page);
  await pressImport(page, { reloads: false });
  const after = await everything(page);
  const row = await said(page, importRow);
  check(
    `${label}: Import changes nothing, does not reload, and says '${line}'`,
    JSON.stringify(after) === JSON.stringify(before) && (await marked(page)) && (await navType(page)) !== "reload" && row === line,
    JSON.stringify({ row, same: JSON.stringify(after) === JSON.stringify(before), marked: await marked(page) }),
  );
  if (label.startsWith("a file the system")) check("  and none of what the system said is on the page", !/denied|os error/i.test(row ?? ""));
  await ctx.close();
}
{
  // A closed file chooser.
  const { ctx, page } = await open({ tauri: true, store: NEW_PC, native: { importAnswer: null } });
  await openApp(page);
  await mark(page);
  const before = await everything(page);
  await pressImport(page, { reloads: false });
  check(
    "a closed file chooser changes nothing, says nothing and does not reload",
    JSON.stringify(await everything(page)) === JSON.stringify(before) && (await said(page, importRow)) === null && (await marked(page)) && (await calls(page, "settings_import")).length === 1,
  );
  // And the message of a refused file goes when the next try is made.
  await setNative(page, { importAnswer: "nope" });
  await pressImport(page, { reloads: false });
  const msg = await said(page, importRow);
  await setNative(page, { importAnswer: null });
  await pressImport(page, { reloads: false });
  check("  a refusal's line is gone on the next try", msg === "That isn't a BlammyTV settings file." && (await said(page, importRow)) === null);
  await ctx.close();
}
{
  // Not while something plays: the reload would end it.
  const { ctx, page } = await open({ tauri: true, store: NEW_PC, native: { importAnswer: JSON.stringify(TICKED) } });
  await openApp(page);
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.className = "vod-stage";
    document.body.appendChild(d);
    window.__marker = 1;
  });
  const before = await everything(page);
  await pressImport(page, { reloads: false });
  check(
    "while something is playing, Import asks for no file, changes nothing, does not reload, and says to finish watching first",
    (await calls(page, "settings_import")).length === 0 && JSON.stringify(await everything(page)) === JSON.stringify(before) && (await marked(page)) && /^Finish watching first\./.test((await said(page, importRow)) ?? ""),
    String(await said(page, importRow)),
  );
  await ctx.close();
}

// A native from before the commands.
{
  const { ctx, page } = await open({ tauri: true, store: NEW_PC, native: { files: "old" } });
  await openApp(page);
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({
    e: document.querySelector("[data-setting='export-settings'] > button")?.getAttribute("aria-disabled"),
    i: document.querySelector("[data-setting='import-settings'] > button")?.getAttribute("aria-disabled"),
    iLabel: document.querySelector("[data-setting='import-settings'] > button")?.textContent,
  }));
  check("on a native with neither command both buttons are greyed (aria-disabled), the Import one is a plain button and not the two-press one", off.e === "true" && off.i === "true" && off.iLabel === "Import…", JSON.stringify(off));
  // The words a button's Hint says on hover. Escape shuts a Hint, and a move
  // away in steps ends the hover, so the next button's opens afresh (Radix
  // keeps one that was left in a single jump for the pointer to reach).
  const hint = async (btn) => {
    await btn(page).hover();
    const tip = page.locator("[data-slot=tooltip-content]:not([data-state=closed])").first();
    await tip.waitFor({ timeout: 3000 });
    const words = await tip.innerText();
    await page.keyboard.press("Escape");
    await page.mouse.move(600, 300, { steps: 8 });
    await page.waitForFunction(() => document.querySelectorAll("[data-slot=tooltip-content]").length === 0, null, { timeout: 3000 });
    return words;
  };
  check("  hovering Export gives the Hint: needs the next app update", /Needs the next app update\./.test(await hint(exportBtn)));
  check("  and so does Import", /Needs the next app update\./.test(await hint(importBtn)));
  await exportBtn(page).click({ force: true });
  await importBtn(page).click({ force: true });
  await importBtn(page).click({ force: true });
  await page.waitForTimeout(300);
  check(
    "  pressing them does nothing: no save, no file chooser, no line on the row",
    (await saves(page)).length === 0 && (await calls(page, "settings_import")).length === 0 && (await said(page, exportRow)) === null && (await said(page, importRow)) === null,
  );
  check("  and nothing unhandled", (await page.evaluate(() => window.__unhandled)).length === 0);
  await ctx.close();
}
{
  // A plain browser: no dialog to open.
  const { ctx, page } = await open({ tauri: false, store: NEW_PC });
  await openApp(page);
  const off = await page.evaluate(() => [...document.querySelectorAll("[data-setting='export-settings'] > button, [data-setting='import-settings'] > button")].map((b) => b.getAttribute("aria-disabled")));
  check("in a browser both buttons are greyed, and native is asked for nothing", off.join() === "true,true" && (await calls(page, "settings_export")).length === 0 && (await calls(page, "settings_import")).length === 0, off.join());
  await exportBtn(page).hover();
  const tip = page.locator("[data-slot=tooltip-content]:not([data-state=closed])").first();
  await tip.waitFor({ timeout: 3000 });
  check("  with the Hint: only in the BlammyTV app", /Only in the BlammyTV app\./.test(await tip.innerText()));
  await ctx.close();
}

// The palette finds both.
{
  const { ctx, page } = await open({ tauri: true });
  const ask = async (q) => {
    await page.keyboard.press("Control+k");
    await palette(page).waitFor({ timeout: 4000 });
    await page.keyboard.type(q);
    await page.waitForTimeout(300);
  };
  const rowsFound = () =>
    page.evaluate(() => {
      const g = [...document.querySelectorAll(".palette .mvpick__group")].find((x) => x.querySelector(".mvpick__sec")?.textContent === "Settings");
      return [...(g?.querySelectorAll(".mvpick__row") ?? [])].map((r) => ({ label: r.querySelector(".mvpick__nametext")?.textContent, sub: r.querySelector(".mvpick__sub")?.textContent }));
    });
  const closePalette = async () => {
    await page.keyboard.press("Escape");
    await palette(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
  };
  const got = {};
  for (const q of ["export", "import", "backup"]) {
    await ask(q);
    got[q] = await rowsFound();
    await closePalette();
  }
  check(
    '"export" and "import" each find their row first, filed under Settings · App; "backup" finds both',
    got.export[0]?.label === "Export Settings" && got.import[0]?.label === "Import Settings" && got.export[0].sub === "Settings · App" && got.backup.map((r) => r.label).sort().join() === "Export Settings,Import Settings",
    JSON.stringify(got),
  );
  await ask("import");
  await page.keyboard.press("Enter");
  await page.locator(".settings__body").waitFor({ timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("[data-setting='import-settings']")?.classList.contains("setting--found"), null, { timeout: 4000 }).catch(() => {});
  const landed = await page.evaluate(() => ({
    page: document.querySelector(".settings [role=tablist][aria-label=Settings] [role=tab][aria-selected=true]")?.getAttribute("aria-label"),
    lit: !!document.querySelector("[data-setting='import-settings']")?.classList.contains("setting--found"),
    focus: document.activeElement?.textContent,
    armed: document.querySelector("[data-setting='import-settings'] > button")?.textContent,
  }));
  check(
    "Ctrl+K, import, Enter opens Settings on App with Import Settings lit and focused on its button, not pressed and not armed",
    landed.page === "App" && landed.lit && landed.focus === "Import…" && landed.armed === "Import…" && (await calls(page, "settings_import")).length === 0,
    JSON.stringify(landed),
  );
  await closeSettings(page);
  await ctx.close();
}

// The narrow card.
{
  const { ctx, page } = await open({ tauri: true, width: 560, height: 800 });
  await openApp(page);
  const fit = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    const edge = body.getBoundingClientRect().right + 0.5;
    const rows = ["export-settings", "import-settings"].map((id) => document.querySelector(`[data-setting='${id}']`));
    return {
      narrow: !!document.querySelector(".settings__layout--narrow"),
      sideways: body.scrollWidth > body.clientWidth + 1,
      inside: rows.every((r) => r.getBoundingClientRect().right <= edge && [...r.querySelectorAll("button, label, p")].every((e) => e.getBoundingClientRect().right <= edge)),
    };
  });
  check("in the narrow card both rows fit: nothing scrolls sideways and nothing sits outside the card", fit.narrow && !fit.sideways && fit.inside, JSON.stringify(fit));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
