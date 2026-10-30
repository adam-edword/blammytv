// E2E: a playlist's extra guide and its own User-Agent (plan 025, P5).
//
// Settings → Sources → a playlist → Advanced holds two optional fields. An
// EXTRA GUIDE (an XMLTV address) FILLS THE GAPS in the provider's guide: the
// provider's wins wherever it has programmes, the extra one fills only the
// channels the provider's left on "No Information", and one that cannot be
// had never costs the provider's guide. A USER-AGENT goes on every request
// for that playlist's URLs, and playback hands it to native with the stream.
//
// Against the fake panel's "extra" line: "Extra Covered" has programmes in the
// provider's guide, "Extra Gap Filled" and "Extra Gap Empty" have none, and
// /extra.xml covers the first gap and also "Extra Covered", with other titles.
//
// HOW. The IPC boundary is stubbed (verify-playerfault's pattern), so isTauri()
// is true and the app asks the way it does installed: http_get with headers.
// The stub does not fetch in the page, where User-Agent is a header a browser
// refuses to set, but hands the call to Node (page.exposeFunction), which
// sends exactly the headers it was given over a real socket, over its own
// default agent as the native client's default is merged under a caller's. So
// what the fake panel records (/__log) is what a provider would see.
//
// What this holds:
// - the gap fills, the channel the provider covers keeps the provider's
//   programme, the other gap stays "No Information";
// - the panel saw the playlist's agent on the sign-in, the channel list, the
//   guide, the connection count and the extra guide, and no other;
// - a stubbed inv_open receives the agent, and none without one;
// - a playlist with neither field makes the requests it always did, as the
//   default agent, and nothing for an extra guide; one with only an agent
//   makes the same requests as it, as the agent;
// - a broken extra-guide address leaves the provider's guide whole and says so
//   in Settings → Sources, as a note of its own;
// - the form: closed for a playlist with nothing set and open for one with
//   something, a bad address or agent cannot be saved, saving changes the
//   playlist, and clearing both takes the fields off it;
// - the palette finds it;
// - a playlist given an extra guide while the app was closed (the refresh
//   never landed) does not reuse the guide it had: the extra one is fetched.
//
//   node scripts/fake-panel.mjs   # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-guide-extra.mjs
import { createRequire } from "node:module";
import http from "node:http";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PANEL = "http://localhost:8081";
const AGENT = "TestApp/9.1 (Provider Check)";
/** What the native client sends when nobody has said (lib.rs http_client). */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const line = (adv = {}) => ({
  v: 1,
  data: [{ kind: "xtream", id: "ex", name: "Extra Line", enabled: true, server: PANEL, username: "extra", password: "p", ...adv }],
});
const COVERED = "ex:9001";
const GAP_FILLED = "ex:9002";
const GAP_EMPTY = "ex:9003";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** Native's http_get, as far as it matters: the headers it is given are sent,
 * over the default agent. Resolves the body as base64, or rejects as native
 * does, with "HTTP <status>". */
const nativeGet = (url, headers) =>
  new Promise((resolve, reject) => {
    const r = http.get(
      url,
      { headers: { "User-Agent": DEFAULT_UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", ...(headers ?? {}) } },
      (res) => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      },
    );
    r.on("error", reject);
  });

const panelLog = async (clear = false) => (await fetch(`${PANEL}/__log${clear ? "?clear=1" : ""}`)).json();

/** The page's side of the stub. Everything the harness reads later is a
 * window.__ global. */
function stub({ playlists }) {
  window.__calls = [];
  window.__opens = [];
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    invoke: (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") {
        return window
          .__nativeGet(args.url, args.headers ?? null)
          .then((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)
          .catch((e) => Promise.reject(String(e?.message ?? e).replace(/^Error: /, "")));
      }
      if (cmd === "inv_open") {
        window.__opens.push(args);
        window.__loadedAt = Date.now();
        return Promise.resolve();
      }
      if (cmd === "inv_stop") window.__loadedAt = null;
      if (cmd === "mpv_status") {
        const since = window.__loadedAt == null ? null : Date.now() - window.__loadedAt;
        const playing = since !== null && since >= 100;
        return Promise.resolve(
          JSON.stringify({
            pos: playing ? 5 : null,
            dur: null,
            presenting: playing,
            ended: false,
            buffering: false,
            seekable: true,
            cacheDur: 0,
            dvrStart: null,
            dvrEnd: null,
            audio: [],
            subs: [],
            chapters: [],
            sinceLoadMs: since,
          }),
        );
      }
      if (cmd === "frontend_status") return Promise.resolve({ serving: "", pending: "" });
      if (cmd === "frontend_check") return Promise.resolve("");
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  // Once: a reload below must see what the app and the harness left.
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify(playlists));
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
}

async function open(playlists) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.exposeFunction("__nativeGet", nativeGet);
  await page.addInitScript(stub, { playlists });
  return { ctx, page };
}

const row = (page, id) => page.locator(`.guide__row[data-channel="${id}"]`);
const titles = (page, id) =>
  row(page, id).locator(".guide__cell:not(.guide__cell--blank)").evaluateAll((els) => els.map((e) => e.dataset.hint ?? ""));
const blank = (page, id) => row(page, id).locator(".guide__cell--blank .guide__cell-body").textContent().catch(() => null);
const waitFor = async (page, fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
/** The Guide, loaded and its guide landed (the covered channel has its title). */
async function guideUp(page) {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await row(page, COVERED).waitFor({ timeout: 30_000 });
  return waitFor(page, async () => (await titles(page, COVERED)).some((t) => t.startsWith("Provider Hour")));
}
const lineOf = (log) => log.filter((e) => e.user === "extra" || e.path === "/extra.xml" || e.path === "/extra-broken.xml");
/** Stream's calls for the playlist's movies and shows (plan 028), made at
 * launch for every Xtream playlist and not the guide's business. */
const VOD_ACTIONS = ["get_vod_categories", "get_series_categories", "get_vod_streams", "get_series"];
/** What the guide asked, once each: "<path>?<action>". */
const kinds = (log) =>
  [...new Set(lineOf(log).filter((e) => !VOD_ACTIONS.includes(e.action)).map((e) => `${e.path}${e.action ? `?${e.action}` : ""}`))].sort();
const agentsOf = (log) => [...new Set(lineOf(log).map((e) => e.ua))];

const gear = (page) => page.getByRole("button", { name: "Settings", exact: true }).first();
const settingsUp = (page) => page.locator(".settings__body").waitFor({ timeout: 8000 });
/** Advanced's trigger, in the playlist's row (one for each playlist), and its fields, under the row while it is open. */
const trigger = (page) => page.locator('[data-setting="playlist-advanced"]');
const toggleBtn = (page) => trigger(page).first().getByRole("button");
const body = (page) => page.locator(".playlist-advanced__body").first();
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.playlists") ?? "null")?.data?.[0] ?? null);

// =====================================================================
// 1. Both fields set: the gap fills, the agent is on every request.
// =====================================================================
{
  await panelLog(true);
  const { ctx, page } = await open(line({ extraGuide: `${PANEL}/extra.xml`, userAgent: AGENT }));
  const up = await guideUp(page);
  check("the provider's guide lands", up);
  const filled = await waitFor(page, async () => (await titles(page, GAP_FILLED)).some((t) => t.startsWith("Extra Hour")));
  check("a channel the provider's guide left empty is filled from the extra guide", filled, JSON.stringify(await titles(page, GAP_FILLED)));
  const covered = await titles(page, COVERED);
  check(
    "  the channel the provider covers keeps the provider's programmes, though the extra guide has it too",
    covered.length > 0 && covered.every((t) => t.startsWith("Provider Hour")) && !covered.some((t) => /Extra/.test(t)),
    JSON.stringify(covered.slice(0, 3)),
  );
  check("  and the other gap stays on No Information", (await blank(page, GAP_EMPTY))?.trim() === "No Information", String(await blank(page, GAP_EMPTY)));

  const log = await panelLog();
  check(
    "the panel was asked for the sign-in, the lists, the guide and the extra guide",
    ["/extra.xml", "/player_api.php", "/player_api.php?get_live_categories", "/player_api.php?get_live_streams", "/xmltv.php"].every((k) => kinds(log).includes(k)),
    JSON.stringify(kinds(log)),
  );
  check("  every one of them as the playlist's own User-Agent, and as nothing else", agentsOf(log).length === 1 && agentsOf(log)[0] === AGENT, JSON.stringify(agentsOf(log)));
  check("  the extra guide once", lineOf(log).filter((e) => e.path === "/extra.xml").length === 1);

  // Playback: a channel from the Guide, in the mini player.
  await page.locator(".guide__channel button").first().click();
  const opened = await waitFor(page, () => page.evaluate(() => window.__opens.length > 0), 15_000);
  const opens = await page.evaluate(() => window.__opens);
  check("playing a channel asks native to open it", opened, String(opens.length));
  check("  with the playlist's agent", opens[0]?.userAgent === AGENT, JSON.stringify(Object.keys(opens[0] ?? {})));

  // ---- Settings → Sources: the Advanced disclosure, open because it holds something
  await gear(page).click();
  await settingsUp(page);
  await trigger(page).first().waitFor({ timeout: 8000 });
  check("Settings → Sources draws an Advanced for the playlist, in its row", (await trigger(page).count()) === 1 && (await trigger(page).locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' playlist-row ')]").count()) === 1);
  check("  open, because it holds something", (await toggleBtn(page).getAttribute("aria-expanded")) === "true");
  const guideField = body(page).getByLabel("Extra guide (XMLTV URL)");
  const agentField = body(page).getByLabel("User-Agent");
  check("  with the two values in their fields", (await guideField.inputValue()) === `${PANEL}/extra.xml` && (await agentField.inputValue()) === AGENT);
  check("  and the notes under them, in the app's words", (await body(page).textContent()).includes("Fills channels your provider’s guide leaves empty.") && (await body(page).textContent()).includes("Some providers only answer certain apps. Leave empty unless yours asks."));
  check("  nothing to save yet", (await body(page).getByRole("button", { name: "Save" }).count()) === 0);

  // A bad address, and a bad agent: said, and not savable.
  await guideField.fill("ftp://example.com/guide.xml");
  const saveBtn = body(page).getByRole("button", { name: "Save" });
  check("an address that is not http or https says so", (await body(page).textContent()).includes("Start the address with http:// or https://."));
  check("  and cannot be saved", await saveBtn.isDisabled());
  check("  the field is marked invalid for a screen reader", (await guideField.getAttribute("aria-invalid")) === "true");
  await guideField.fill(`${PANEL}/extra.xml`);
  await agentField.fill("badé agent");
  check("an agent with a character a header should not carry says so and cannot be saved", (await body(page).textContent()).includes("Use plain letters, numbers and punctuation only.") && (await saveBtn.isDisabled()));
  await agentField.fill(AGENT);
  check("put back as it was, there is nothing to save again", (await saveBtn.count()) === 0);

  // The palette finds it, and lands on it.
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 4000 });
  await page.keyboard.type("user agent");
  await page.waitForTimeout(300);
  const found = await page.evaluate(() =>
    [...document.querySelectorAll(".palette .mvpick__group")]
      .filter((g) => g.querySelector(".mvpick__sec")?.textContent === "Settings")
      .flatMap((g) => [...g.querySelectorAll(".mvpick__row")].map((r) => `${r.querySelector(".mvpick__nametext")?.textContent} / ${r.querySelector(".mvpick__sub")?.textContent}`)),
  );
  check('the palette finds "user agent" as Advanced, on Settings · Sources', found[0] === "Advanced / Settings · Sources", JSON.stringify(found));
  await page.keyboard.press("Enter");
  await settingsUp(page);
  const landed = await waitFor(
    page,
    () => page.evaluate(() => document.querySelector('[data-setting="playlist-advanced"]')?.classList.contains("setting--found") === true),
    4000,
  );
  check("  and Enter lands on it, lit", landed);

  // ---- A broken extra-guide address, saved from the form.
  await guideField.fill(`${PANEL}/extra-broken.xml`);
  await body(page).getByRole("button", { name: "Save" }).click();
  const p = await stored(page);
  check("Save puts the new address on the playlist, and the agent stays", p?.extraGuide === `${PANEL}/extra-broken.xml` && p?.userAgent === AGENT, JSON.stringify(p));
  const noted = await waitFor(page, async () => /Extra Guide: download failed/.test((await page.locator(".playlist-row__status").allTextContents()).join("|")), 25_000);
  const notes = await page.locator(".playlist-row__status").allTextContents();
  check("the playlist's row says the extra guide failed, as a note of its own", noted, JSON.stringify(notes));
  check("  without the address in it", !notes.join("|").includes("extra-broken") && !notes.join("|").includes("localhost:8081/"), JSON.stringify(notes));
  check("  and the provider's guide is not blamed: its own note is the one that starts Channels OK", !notes.some((t) => /Channels OK/.test(t)), JSON.stringify(notes));
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const after = await titles(page, COVERED);
  check("the provider's guide is whole behind it", after.length > 0 && after.every((t) => t.startsWith("Provider Hour")), JSON.stringify(after.slice(0, 3)));
  check("  and the lane the broken guide would have filled is back on No Information", (await blank(page, GAP_FILLED))?.trim() === "No Information", String(await blank(page, GAP_FILLED)));

  // ---- Clearing both takes the fields off the playlist.
  await gear(page).click();
  await settingsUp(page);
  await trigger(page).first().waitFor({ timeout: 8000 });
  await guideField.fill("");
  await agentField.fill("   ");
  await body(page).getByRole("button", { name: "Save" }).click();
  const cleared = await stored(page);
  check("clearing both and saving takes both off the playlist, as it was before", cleared && !("extraGuide" in cleared) && !("userAgent" in cleared), JSON.stringify(cleared));
  await ctx.close();
}

// =====================================================================
// 2. Neither field: the requests it always made, as the default agent.
// =====================================================================
let baseline;
{
  await panelLog(true);
  const { ctx, page } = await open(line());
  check("a playlist with neither field loads its guide", await guideUp(page));
  await page.waitForTimeout(800);
  const log = await panelLog();
  baseline = kinds(log);
  check(
    "it asks for the sign-in, the two lists and the guide, and for no extra guide",
    JSON.stringify(baseline) === JSON.stringify(["/player_api.php", "/player_api.php?get_live_categories", "/player_api.php?get_live_streams", "/xmltv.php"]),
    JSON.stringify(baseline),
  );
  check("  all of it as the default agent, which no field changed", agentsOf(log).length === 1 && agentsOf(log)[0] === DEFAULT_UA, JSON.stringify(agentsOf(log)));
  check("  and no lane is filled from anywhere else", (await blank(page, GAP_FILLED))?.trim() === "No Information" && (await blank(page, GAP_EMPTY))?.trim() === "No Information");
  await page.locator(".guide__channel button").first().click();
  await waitFor(page, () => page.evaluate(() => window.__opens.length > 0), 15_000);
  const opens = await page.evaluate(() => window.__opens);
  check("playing a channel sends inv_open the payload it always sent: no userAgent at all", opens.length > 0 && !("userAgent" in opens[0]), JSON.stringify(Object.keys(opens[0] ?? {})));

  await gear(page).click();
  await settingsUp(page);
  await trigger(page).first().waitFor({ timeout: 8000 });
  check("Advanced is closed for a playlist with nothing in it", (await toggleBtn(page).getAttribute("aria-expanded")) === "false");
  check("  with no field showing", (await page.locator(".playlist-advanced__body").count()) === 0);
  await toggleBtn(page).click();
  check("  and opens when pressed, to two empty fields", (await body(page).locator("input").count()) === 2 && (await body(page).getByLabel("User-Agent").inputValue()) === "");
  await body(page).getByLabel("User-Agent").fill(`  ${AGENT}  `);
  await body(page).getByRole("button", { name: "Save" }).click();
  const p = await stored(page);
  check("saving an agent puts it on the playlist, trimmed, and no extra guide", p?.userAgent === AGENT && !("extraGuide" in p), JSON.stringify(p));
  await ctx.close();
}

// =====================================================================
// 3. An agent and no extra guide: the same requests, as the agent.
// =====================================================================
{
  await panelLog(true);
  const { ctx, page } = await open(line({ userAgent: AGENT }));
  check("a playlist with only an agent loads its guide", await guideUp(page));
  await page.waitForTimeout(800);
  const log = await panelLog();
  check("it makes the very requests a playlist without one makes", JSON.stringify(kinds(log)) === JSON.stringify(baseline), JSON.stringify(kinds(log)));
  check("  as the agent", agentsOf(log).length === 1 && agentsOf(log)[0] === AGENT, JSON.stringify(agentsOf(log)));
  await page.locator(".guide__channel button").first().click();
  await waitFor(page, () => page.evaluate(() => window.__opens.length > 0), 15_000);
  check("  and plays with it", (await page.evaluate(() => window.__opens[0]?.userAgent)) === AGENT);
  await ctx.close();
}

// =====================================================================
// 4. An extra guide set while the app was closed is fetched, not skipped.
// =====================================================================
{
  await panelLog(true);
  const { ctx, page } = await open(line());
  check("a guide is loaded and written to the disk record", await guideUp(page));
  // The record is written 1.5s after the guide lands.
  await page.waitForTimeout(2500);
  // The playlist gets an extra guide with the app closed to Settings: no
  // refresh, no event. The next launch finds a record that is a few minutes
  // old, for a playlist that has changed.
  await page.evaluate((u) => {
    const raw = JSON.parse(localStorage.getItem("blammytv.playlists"));
    raw.data[0].extraGuide = u;
    localStorage.setItem("blammytv.playlists", JSON.stringify(raw));
  }, `${PANEL}/extra.xml`);
  await panelLog(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await row(page, COVERED).waitFor({ timeout: 30_000 });
  const filled = await waitFor(page, async () => (await titles(page, GAP_FILLED)).some((t) => t.startsWith("Extra Hour")), 25_000);
  check("the next launch fills the gap from the extra guide, though the guide it had was minutes old", filled, JSON.stringify(await titles(page, GAP_FILLED)));
  const log = await panelLog();
  check("  by downloading both guides again, the provider's and the extra one", kinds(log).includes("/xmltv.php") && kinds(log).includes("/extra.xml"), JSON.stringify(kinds(log)));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
