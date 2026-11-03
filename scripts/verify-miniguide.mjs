// E2E: the mini-guide (plan 036). Live TV in theater or fullscreen, a way to
// change channel without leaving the player: a strip of cards where the
// channel's logo and title sit, or a list down the left, and PageUp and
// PageDown for a channel at once.
//
// What it holds: G and the button open the strip on the channel playing, marked
// Watching; the cards say name, what's on and the time left, from the fake
// panel's guide; browsing (arrows) moves a selection and tunes NOTHING; Enter
// tunes and closes; PageDown tunes the next channel in the Guide's order, wraps
// at the end, shows the strip for a moment and lets it go by itself; the
// Strip/List switch, rows that say what is Next, ↑/↓ there, and the choice
// surviving a reload; Escape closes it and the player stays in fullscreen (and
// the next Escape, with it shut, still leaves); ↑/↓ with it shut are still
// volume; Favorites mode lists exactly the favorites in their order; a long
// list draws a window of itself, not all of it; and on a recording, in the mini
// player, and in the overlay of a film, G and PageDown are not handled (they
// fall through as before).
//
// HOW. verify-recordings' stub (isTauri() is true, the real player path runs;
// the player is a black hole here, so a tune is what reaches native: an
// `inv_open` with the stream's URL), against the fake panel's "pins" line:
// forty channels with a guide each.
//
//   node scripts/fake-panel.mjs   # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-miniguide.mjs
//   SHOTS=<dir> ...               # also leaves a picture of each shape there
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const PANEL = process.env.PANEL_URL ?? "http://localhost:8081";
const SHOTS = process.env.SHOTS;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
// Offline: the fake panel and the app are all this talks to.
await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const stub = ([panel, favorites]) => {
  window.__calls = [];
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
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    invoke: (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "plugin:event|listen") {
        (listeners[args.event] ??= []).push(args.handler);
        return Promise.resolve(++cb);
      }
      if (cmd === "mpv_status" && window.__presenting)
        return Promise.resolve(
          JSON.stringify({
            pos: 10, dur: window.__dur ?? 0, presenting: true, ended: false,
            buffering: false, seekable: true,
            cacheDur: 0, dvrStart: 0, dvrEnd: 0,
            audio: [], subs: [], chapters: [],
          }),
        );
      if (cmd === "rec_list")
        return Promise.resolve([
          {
            id: "p1", channel: "Pin Channel 1", programme: null, playlistId: "p", startedAt: Date.now() - 7_200_000,
            endedAt: Date.now() - 3_600_000, path: "C:\\Videos\\p1.mkv", bytes: 1024 ** 3, status: "done", reason: null,
            job: null, progress: null, jobReason: null, saved: 0,
          },
        ]);
      if (cmd === "rec_default_folder") return Promise.resolve("C:\\Users\\sam\\Videos\\BlammyTV");
      return Promise.resolve(undefined);
    },
  };
  // What @tauri-apps/api's unlisten reaches for; absent, an unmount throws.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  // A reload runs this again: set the seed once, so what the page saved (the
  // shape, the favorites) is what the reload sees.
  if (!sessionStorage.getItem("__seeded")) {
    sessionStorage.setItem("__seeded", "1");
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    localStorage.setItem(
      "blammytv.playlists",
      JSON.stringify({
        v: 1,
        data: [{ kind: "xtream", id: "p", name: "Pins", enabled: true, server: panel, username: "pins", password: "p" }],
      }),
    );
    localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
    localStorage.setItem("blammytv.recordingNotice", JSON.stringify({ v: 1, data: false }));
    localStorage.setItem("blammytv.favorites", JSON.stringify({ v: 1, data: favorites }));
  }
  sessionStorage.setItem("btv:welcome-played", "1");
};
// Channel 6, then 2, then 11: not in channel order, so a list that follows the
// Guide's channel order instead of the favorites' own would be caught.
const FAVS = ["p:6005", "p:6001", "p:6010"];
await page.addInitScript(stub, [PANEL, FAVS]);

const calls = (cmd) => page.evaluate((c) => window.__calls.filter((x) => x[0] === c).map((x) => x[1]), cmd);
const opens = async () => {
  await page.waitForTimeout(500);
  return (await calls("inv_open")).length;
};
/** The stream id of the last channel opened in native: what is actually tuned.
 * A tune reaches native after InvertedPlayer's 150ms debounce, so it waits that out. */
const tunedId = async () => {
  await page.waitForTimeout(500);
  const all = await calls("inv_open");
  const url = JSON.stringify(all[all.length - 1] ?? "");
  return /\/(60\d\d)/.exec(url)?.[1] ?? null;
};
const num = (id) => Number(id) - 6000 + 1; // stream 6005 is "Pin Channel 6"

const modeTab = (name) => page.locator(`.live-sidebar [role=tab][aria-label="${name}"]`);
const guideCard = (name) => page.locator(`.guide__row:has(.guide__card[aria-label^="${name}"]) .guide__card`);
/** The chrome hides when idle and takes no clicks; a move wakes it. */
const wake = async () => {
  await page.mouse.move(800, 300);
  await page.mouse.move(820, 330);
};
const strip = page.locator(".mg-strip");
const list = page.locator(".mg-list");
const sel = () => page.locator(".mg-card[data-sel], .mg-row[data-sel]");
const selName = async () => (await sel().locator(".mg-card__name, .mg-row__name").first().innerText()).trim();
const folded = () => page.locator(".live-sidebar").evaluate((el) => el.classList.contains("live-sidebar--collapsed"));
// The fold follows the guide by an effect, a frame or two behind it.
const foldsTo = (want) =>
  page.waitForFunction((w) => document.querySelector(".live-sidebar")?.classList.contains("live-sidebar--collapsed") === w, want, { timeout: 2000 })
    .then(() => true, () => false);
const watchingName = async () =>
  (await page.locator("[aria-current=true] .mg-card__name, [aria-current=true] .mg-row__name").first().innerText()).trim();
/** Tune a channel from the Guide, and go to theater. */
const toTheater = async (name, mode = "Playlist") => {
  if (mode) await modeTab(mode).click();
  await guideCard(name).first().click();
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => (window.__presenting = true));
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await wake();
};
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
// The Guide's own order, as the Guide draws it: what PageDown must follow.
const guideOrder = (await page.locator(".guide__card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? "")))
  .map((l) => /^(Pin Channel \d+)/.exec(l)?.[1])
  .filter(Boolean);
check("the Guide lists Pin Channel 1, 2, 3 in order to start with", guideOrder.slice(0, 3).join() === "Pin Channel 1,Pin Channel 2,Pin Channel 3", guideOrder.slice(0, 3).join());

// ------------------------------------------------ mini: nothing is handled
await guideCard("Pin Channel 3").first().click();
await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
await page.evaluate(() => (window.__presenting = true));
await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
/** A key the page's listeners left alone: no one called preventDefault on it. */
const falls = (key) => page.evaluate((k) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return !e.defaultPrevented;
}, key);
check("in the mini player, G falls through", await falls("g"));
check("  and so does PageDown, and nothing was tuned", (await falls("PageDown")) && (await tunedId()) === "6002", String(await tunedId()));
check("  and the mini player has no guide", (await strip.count()) === 0 && (await page.locator('[aria-label="Mini-Guide"]').count()) === 0);

// ---------------------------------------------------------------- the strip
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
await wake();
check("shut in the theater, there is no strip", (await strip.count()) === 0);
check("  and the sidebar is open", !(await folded()));
await page.keyboard.press("g");
await strip.waitFor({ timeout: 3000 });
check("G opens the strip", (await strip.count()) === 1 && (await list.count()) === 0);
check("  and folds the sidebar", await foldsTo(true));
check("  on the channel playing, selected", (await selName()) === "Pin Channel 3");
check("  and marked Watching, once", (await watchingName()) === "Pin Channel 3" && (await page.locator(".mg-watching").count()) === 1 && /watching/i.test(await page.locator(".mg-watching").innerText()));
const heading = (await page.locator(".mg-name").innerText()).replace(/\s+/g, " ").trim();
check("  with the list's name and its count in the heading", heading === "Playlist 40 channels", heading);
check("  and the channel's own logo and title are gone from the bar", (await page.locator(".theater-bar__meta").count()) === 0);
check("  while the seek line and the controls stay", (await page.locator(".theater-seek").count()) === 1 && (await page.locator(".theater-controls").count()) === 1);
check("  the button is pressed", (await page.locator('button[aria-label="Mini-Guide"]').getAttribute("aria-pressed")) === "true");

// What the cards say, against the guide the fake panel serves.
const xml = await (await fetch(`${PANEL}/xmltv.php?username=pins&password=p`)).text();
const programmes = (ch) =>
  [...xml.matchAll(new RegExp(`<programme start="(\\d{14}) \\+0000" stop="(\\d{14}) \\+0000" channel="${ch}"><title>([^<]*)</title>`, "g"))].map((m) => {
    const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
    return { start: t(m[1]), end: t(m[2]), title: m[3] };
  });
const nowMs = Date.now();
const onNow = programmes("pin2.fake").find((p) => p.start <= nowMs && nowMs < p.end);
const card3 = page.locator('.mg-card[data-channel="p:6002"]');
const card3Text = (await card3.innerText()).replace(/\n+/g, " | ");
check("a card says the channel's name and what is on from the guide", !!onNow && card3Text.includes("Pin Channel 3") && card3Text.includes(onNow.title), `${card3Text} vs ${onNow?.title}`);
const leftMin = Number(/(\d+) min left/.exec(card3Text)?.[1] ?? NaN) + 60 * Number(/(\d+) hr/.exec(card3Text)?.[1] ?? 0);
const wantMin = onNow ? Math.ceil((onNow.end - nowMs) / 60_000) : NaN;
check("  and the time left, as the guide has it", Math.abs(leftMin - wantMin) <= 1 && /^(\d+ hr )?(\d+ min )?left$|min left$|hr left$/.test(/(\d+ (hr|min)[a-z0-9 ]*left)/.exec(card3Text)?.[1] ?? ""), `${leftMin} vs ${wantMin}`);
const filled = await card3.locator(".mg-prog i").evaluate((el) => parseFloat(el.style.width));
const wantPct = onNow ? Math.round(((nowMs - onNow.start) / (onNow.end - onNow.start)) * 100) : NaN;
check("  and its bar is how far in it is", Math.abs(filled - wantPct) <= 2 && filled > 0, `${filled} vs ${wantPct}`);
await shot("strip");

// A long list draws a window of itself.
const drawn = await page.locator(".mg-card").count();
check("a list of forty draws a window of it, not all forty", drawn >= 5 && drawn < 40, String(drawn));
check("  with the rest a spacer", (await page.locator(".mg-spacer").count()) >= 1);
const where = (loc) => loc.evaluate((el) => {
  const box = el.closest(".mg-cards, .mg-rows");
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  return JSON.stringify({ box: [b.left, b.top, b.right, b.bottom].map(Math.round), el: [r.left, r.top, r.right, r.bottom].map(Math.round), sl: box.scrollLeft, st: box.scrollTop });
});
const inView = (loc) => loc.evaluate((el) => {
  const box = el.closest(".mg-cards, .mg-rows").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 12 && r.bottom <= box.bottom + 12;
});
check("  and the selected card is in view", await inView(sel()));

// Browsing tunes nothing.
const before = await opens();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(300);
check("→ moves the selection along", (await selName()) === "Pin Channel 5", await selName());
check("  and tunes nothing: still watching the one that was playing", (await watchingName()) === "Pin Channel 3" && (await opens()) === before && (await tunedId()) === "6002", `${await watchingName()} ${await opens()} ${before}`);
await page.keyboard.press("ArrowLeft");
check("← moves it back", (await selName()) === "Pin Channel 4");
for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
await page.waitForFunction(() => document.querySelector(".mg-card[data-sel] .mg-card__name")?.textContent === "Pin Channel 24");
// The glide takes a moment to catch up with twenty presses.
const landed = await page
  .waitForFunction(() => {
    const el = document.querySelector(".mg-card[data-sel]");
    const b = el.closest(".mg-cards").getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.left >= b.left - 1 && r.right <= b.right + 1;
  }, null, { timeout: 4000 })
  .then(() => true, () => false);
check("twenty more along, the selection has scrolled into view", landed, await where(sel()));
check("  with the window moved with it", (await page.locator(".mg-card").count()) < 40 && (await page.locator('.mg-card[data-channel="p:6002"]').count()) === 0);
check("  and still nothing tuned", (await opens()) === before);

// ↑/↓ on the strip are the volume, not the guide's.
const vol = () => page.locator(".theater-vol__slider").evaluate((el) => Number(el.value));
const v0 = await vol();
await page.keyboard.press("ArrowDown");
check("↑/↓ with the strip open stay volume", (await vol()) < v0 && (await selName()) === "Pin Channel 24", `${v0} -> ${await vol()}`);
await page.keyboard.press("ArrowUp");

// Enter tunes it and closes.
await page.keyboard.press("Enter");
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
check("Enter tunes the selected channel", (await opens()) === before + 1 && (await tunedId()) === "6023", String(await tunedId()));
check("  and closes the guide, the player staying in the theater", (await strip.count()) === 0 && (await page.locator(".theater-overlay").count()) === 1);
check("  and the bar has the channel's title again", (await page.locator(".theater-bar__meta").count()) === 1);
check("  and the sidebar is back open", await foldsTo(false));

// ------------------------------------------------------------ PageDown / Up
await page.keyboard.press("PageDown");
await strip.waitFor({ timeout: 3000 });
const peekAt = Date.now();
check("PageDown tunes the next channel at once", (await tunedId()) === "6024" && (await opens()) === before + 2, String(await tunedId()));
check("  and shows the strip with it selected and Watching", (await selName()) === "Pin Channel 25" && (await watchingName()) === "Pin Channel 25");
check("  with no heading or switch while it peeks", await page.locator(".mg-head").evaluate((el) => getComputedStyle(el).visibility === "hidden"));
await shot("peek");
await page.waitForFunction(() => !document.querySelector(".mg-strip"), null, { timeout: 6000 });
const shownFor = Date.now() - peekAt;
check("  the strip lets go by itself after about two and a half seconds", shownFor > 2000 && shownFor < 4500, `${shownFor}ms`);
check("  and a peek leaves the sidebar alone", !(await folded()));
check("  and the channel stays tuned", (await tunedId()) === "6024");
await page.keyboard.press("PageUp");
await strip.waitFor({ timeout: 3000 });
check("PageUp goes back one", (await tunedId()) === "6023" && (await selName()) === "Pin Channel 24");
await page.keyboard.press("PageDown");
await page.keyboard.press("PageDown");
check("  and presses in the peek go on from where it landed", (await tunedId()) === "6025" && (await selName()) === "Pin Channel 26", `${await tunedId()} ${await selName()}`);
await page.waitForFunction(() => !document.querySelector(".mg-strip"), null, { timeout: 6000 });

// Wrap at both ends of the Guide's list: first back to channel 1, then up from it.
let n = 0;
while ((await tunedId()) !== "6039" && n++ < 20) await page.keyboard.press("PageDown");
check("PageDown walks on in the Guide's order up to the last channel", (await tunedId()) === "6039", String(await tunedId()));
await page.waitForTimeout(100);
const edge = await inView(sel());
check("  where the strip's window ends at the list's end, selection in view", edge && (await selName()) === "Pin Channel 40");
await page.keyboard.press("PageDown");
check("  and the one after it wraps to the first", (await tunedId()) === "6000" && (await selName()) === "Pin Channel 1" && (await watchingName()) === "Pin Channel 1", `${await tunedId()} ${await selName()}`);
await page.keyboard.press("PageUp");
check("  and PageUp from the first wraps to the last", (await tunedId()) === "6039" && (await selName()) === "Pin Channel 40", `${await tunedId()} ${await selName()}`);
await page.waitForFunction(() => !document.querySelector(".mg-strip"), null, { timeout: 6000 });

// ------------------------------------------------------------ the switch, List
await page.keyboard.press("g");
await strip.waitFor();
await page.locator('.mg-seg [data-seg="list"]').click();
await list.waitFor({ timeout: 3000 });
check("the switch flips to List", (await list.count()) === 1 && (await strip.count()) === 0);
check("  the same heading and switch, and the playing one still selected", (await selName()) === "Pin Channel 40" && (await page.locator(".mg-seg").count()) === 1 && /Playlist/.test(await page.locator(".mg-name").innerText()));
const rowText = (await page.locator(".mg-row[data-sel]").innerText()).replace(/\n+/g, " | ");
check("  rows say what's Next", /Next \d{1,2}:\d{2} (AM|PM) · /.test(rowText) || /Watching/.test(rowText), rowText);
const others = (await page.locator(".mg-row:not([data-sel]) .mg-row__next").allInnerTexts()).filter((t) => /^Next \d{1,2}:\d{2} (AM|PM) · \S/.test(t.trim()));
check("  and so does every other row", others.length >= 4, String(others.length));
check("  the bar's seek line and controls moved over for it", await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".theater-bar")).paddingLeft) >= 440));
await shot("list");
await page.keyboard.press("ArrowUp");
check("↑ moves up the list", (await selName()) === "Pin Channel 39", await selName());
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowDown");
check("↓ moves down it", (await selName()) === "Pin Channel 39", await selName());
const lb = await opens();
check("  without tuning", (await opens()) === lb && (await tunedId()) === "6039");
await page.keyboard.press("ArrowRight");
check("←/→ on the list are not the guide's (selection stays)", (await selName()) === "Pin Channel 39");
check("  the list's rows are in view", await inView(sel()));
await page.keyboard.press("Enter");
await page.waitForFunction(() => !document.querySelector(".mg-list"));
check("Enter on the list tunes and closes", (await tunedId()) === "6038" && (await opens()) === lb + 1, String(await tunedId()));

// The choice survives a reload.
check("the shape is remembered in storage", await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.miniGuide")).data === "list"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
await toTheater("Pin Channel 2", "Playlist");
await page.keyboard.press("g");
await list.waitFor({ timeout: 3000 });
check("after a reload, G opens the List", (await list.count()) === 1 && (await strip.count()) === 0 && (await selName()) === "Pin Channel 2");
check("  but a PageDown peek is still the strip", await (async () => {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".mg-list"));
  await page.keyboard.press("PageDown");
  await strip.waitFor({ timeout: 3000 });
  return (await list.count()) === 0;
})());
await page.waitForFunction(() => !document.querySelector(".mg-strip"), null, { timeout: 6000 });
// Put it back to the strip for what follows.
await page.keyboard.press("g");
await list.waitFor();
await page.locator('.mg-seg [data-seg="strip"]').click();
await strip.waitFor();
check("the switch back to Strip is remembered too", await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.miniGuide")).data === "strip"));
await page.keyboard.press("g");
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
check("G closes it again", (await strip.count()) === 0);

// ---------------------------------------------------------------- the button
await wake();
await page.locator('button[aria-label="Mini-Guide"]').click();
await strip.waitFor({ timeout: 3000 });
check("the Mini-Guide button opens it", (await strip.count()) === 1 && (await selName()) === "Pin Channel 3");
await page.keyboard.press("ArrowRight");
check("  and the keys are the guide's right after a click on it (it kept no focus)", (await selName()) === "Pin Channel 4", await selName());
await page.locator('button[aria-label="Mini-Guide"]').click();
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
check("  and pressed again it closes it", (await strip.count()) === 0);
await wake();
await page.locator('button[aria-label="Mini-Guide"]').click();
await strip.waitFor();
await page.locator('.mg-card[data-channel="p:6006"]').click();
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
check("a click on a card tunes it and closes", (await tunedId()) === "6006", String(await tunedId()));

// A sidebar folded by hand stays folded when the guide shuts.
await page.locator('button[aria-label="Collapse Sidebar"]').click();
await page.evaluate(() => document.activeElement?.blur());
await wake();
await page.keyboard.press("g");
await strip.waitFor();
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
await page.waitForTimeout(300);
check("a sidebar folded before the guide opened stays folded after", await folded());
await page.locator('button[aria-label="Expand Sidebar"]').click();
// The theater's keys skip a focused control, and the next checks press arrows.
await page.evaluate(() => document.activeElement?.blur());

// ------------------------------------------------------------------- Escape
await page.keyboard.press("f");
await page.waitForFunction(() => document.querySelector(".theater-overlay--fs"));
await page.keyboard.press("g");
await strip.waitFor();
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
await page.waitForTimeout(600);
check("Escape closes the guide and the player stays in fullscreen", (await strip.count()) === 0 && (await page.locator(".theater-overlay--fs").count()) === 1);
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".theater-overlay--fs"), null, { timeout: 3000 }).catch(() => {});
check("  and with it shut, the next Escape still leaves fullscreen", (await page.locator(".theater-overlay--fs").count()) === 0 && (await page.locator(".theater-overlay").count()) === 1);
await wake();

// ----------------------------------------------------------- volume, shut
await page.keyboard.press("ArrowDown");
const v2 = await vol();
await page.keyboard.press("ArrowUp");
const v3 = await vol();
check("↑/↓ with it shut still change the volume", v3 > v2, `${v2} -> ${v3}`);

// ------------------------------------------------------------- Favorites
await page.locator(".theater-topleft button[aria-label=Back]").click();
await page.locator(".mini-overlay").waitFor();
await modeTab("Favorites").click();
await page.locator(".guide__card").first().waitFor();
await guideCard("Pin Channel 6").first().click();
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await page.locator(".theater-overlay").waitFor();
await wake();
await page.keyboard.press("g");
await strip.waitFor();
const names = await page.locator(".mg-card .mg-card__name").allInnerTexts();
check("Favorites mode lists exactly the favorites, in their order", names.join() === "Pin Channel 6,Pin Channel 2,Pin Channel 11", names.join());
check("  under the heading Favorites and its count", /Favorites/.test(await page.locator(".mg-name").innerText()) && /3 channels/.test(await page.locator(".mg-name").innerText()));
check("  with no spacers: all of it is drawn", (await page.locator(".mg-spacer").count()) === 0);
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".mg-strip"));
const order = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("PageDown");
  order.push(await tunedId());
  await page.waitForFunction(() => document.querySelector(".mg-strip[data-peek]"));
}
check("PageDown follows the favorites' order and wraps at the end", order.map((x) => num(x)).join() === "2,11,6,2", order.map((x) => num(x)).join());
await page.waitForFunction(() => !document.querySelector(".mg-strip"), null, { timeout: 6000 });

// ----------------------------------------------------------- a recording
await page.locator(".theater-topleft button[aria-label=Back]").click();
await page.locator(".mini-overlay").waitFor();
await modeTab("Recordings").click();
await page.locator('.rec-row[data-id="p1"] button', { hasText: "Play" }).click();
await page.evaluate(() => (window.__dur = 600));
await page.locator(".mini-overlay").waitFor();
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await page.locator(".theater-overlay").waitFor();
await wake();
check("a recording plays with a film's scrubber, so this is the film's chrome", (await page.locator(".theater-seek__track--vod").count()) === 1);
const recOpens = await opens();
check("on a recording, G falls through and opens nothing", (await falls("g")) && (await strip.count()) === 0);
check("  PageDown and PageUp too, and nothing was tuned", (await falls("PageDown")) && (await falls("PageUp")) && (await opens()) === recOpens);
await page.keyboard.press("g");
await page.keyboard.press("PageDown");
await page.waitForTimeout(300);
check("  pressed for real: still no strip, no button", (await strip.count()) === 0 && (await list.count()) === 0 && (await page.locator('button[aria-label="Mini-Guide"]').count()) === 0);

// ------------------------------------------------- the overlay of a film
const film = await ctx.newPage();
film.on("pageerror", (e) => errors.push(String(e)));
await film.addInitScript(() => {
  const off = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {}, seekAbs() {}, setSpeed() {},
    expand() {}, collapse() {}, fullscreen() {}, exitFullscreen() {}, setMouseIgnore() {},
    getMeta: async () => ({ channelName: "Fake Movie", title: "Fake Movie", live: false }),
    onMeta: off, getLoading: () => false, onLoading: off, getTracks: () => null, onTracks: off,
    getTime: () => ({ pos: 300, dur: 6000 }), onTime: off, getChapters: () => [], onChapters: off,
  };
});
await film.goto(`${URL}?overlay=1`, { waitUntil: "networkidle" });
await film.waitForTimeout(800);
const filmFalls = (key) => film.evaluate((k) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return !e.defaultPrevented;
}, key);
check("the overlay of a film leaves G and PageDown alone", (await filmFalls("g")) && (await filmFalls("PageDown")) && (await filmFalls("PageUp")));
check("  and takes the keys it always did (ArrowUp is handled)", !(await filmFalls("ArrowUp")));
check("  and draws no guide", (await film.locator(".mg-strip, .mg-list, [aria-label=Mini-Guide]").count()) === 0);
await film.close();

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
