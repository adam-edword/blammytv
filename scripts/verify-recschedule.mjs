// E2E: record a programme from the Guide (plan 029, Phase 3), the page's half,
// with the native side (rec.rs) stubbed at the IPC boundary.
//
// What it holds:
// - Right-click a programme to come → Record keeps it (rec_schedule) with the
//   PROGRAMME's own start and end, not the padded ones (native adds the
//   minute either side), marks the cell with a hollow dot, and says so. The
//   menu then offers Cancel Recording, and Cancel Recording (menu or the
//   Recordings list's button) deletes it and takes the dot away.
// - A scheduled programme is a row in Live TV → Recordings: Scheduled, the
//   programme, Cancel Recording, and no Play, Show in Folder or Delete.
// - Native saying a start is due (`due`) makes the page start it through
//   rec_start with the scheduled record's id and no second row; a start
//   native refuses leaves Failed with its reason.
// - A programme that is on starts now (rec_start with `until`, the
//   programme's end), no schedule, and a recording of the channel then reads
//   "Recording", off.
// - A clash is said when it is scheduled: a line of one with a recording
//   running, a line of two with a recording and a scheduled one, and no
//   limit reported is never refused. A programme after a scheduled one,
//   clear of it, is not a clash.
// - A missed start is a row that says so and can only be deleted.
// - A channel's card has no Record in its menu: the item is for a programme.
//
// HOW. verify-recconns' stub (isTauri() is true, the panel's player_api
// answered here, reporting the stream recordings that run) with the schedule
// commands over a small in-page model of native's index. Every call is
// logged in __calls.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-recschedule.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PANEL = process.env.PANEL ?? "http://localhost:8081";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** A page with the stub in, on the Guide. `max` is the line's limit ("none"
 * for a panel that reports none). */
async function open({ max = 3 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Offline: the fake panel and the app are all this talks to.
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ max, panel }) => {
      window.__calls = [];
      window.__native = { recs: [], n: 0 };
      window.__panel = { max };
      window.__refuse = null;
      const listeners = {};
      let cb = 0;
      const emit = (rec) => {
        for (const h of listeners["rec-update"] ?? []) window["_" + h]({ event: "rec-update", id: 0, payload: rec });
      };
      /** native's index: change a record and tell the page, as rec.rs does. */
      window.__put = (rec) => {
        const i = window.__native.recs.findIndex((r) => r.id === rec.id);
        if (i < 0) window.__native.recs.push(rec);
        else window.__native.recs[i] = rec;
        emit(rec);
        return rec;
      };
      const find = (id) => window.__native.recs.find((r) => r.id === id);
      /** The scheduler finds a start due, as rec.rs's tick does. */
      window.__due = (id) => window.__put({ ...find(id), due: true });
      const PAD = 60_000;
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
          if (cmd === "http_get") {
            if (/player_api\.php/.test(args.url) && !/action=/.test(args.url)) {
              return fetch(args.url)
                .then((r) => r.json())
                .then((j) => {
                  const held = window.__native.recs.filter(
                    (r) => r.status === "recording" && !r.buffer && r.playlistId === "t",
                  ).length;
                  if (window.__panel.max === "none") {
                    delete j.user_info.max_connections;
                    delete j.user_info.active_cons;
                  } else {
                    j.user_info.active_cons = String(held);
                    j.user_info.max_connections = String(window.__panel.max);
                  }
                  return new TextEncoder().encode(JSON.stringify(j)).buffer;
                });
            }
            return fetch(args.url).then((r) => r.arrayBuffer());
          }
          if (cmd === "plugin:event|listen") {
            (listeners[args.event] ??= []).push(args.handler);
            return Promise.resolve(++cb);
          }
          if (cmd === "rec_list") return Promise.resolve([...window.__native.recs].sort((a, b) => b.startedAt - a.startedAt));
          if (cmd === "rec_schedule") {
            const dup = window.__native.recs.find(
              (r) => r.status === "scheduled" && r.channelId === args.channelId && r.startedAt === args.start,
            );
            if (dup) return Promise.resolve(dup);
            const id = "s" + ++window.__native.n;
            return Promise.resolve(
              window.__put({
                id, channel: args.channel, programme: args.programme ?? null, playlistId: args.playlistId,
                startedAt: args.start, endedAt: null, path: "", bytes: 0, status: "scheduled", reason: null,
                buffer: false, channelId: args.channelId,
                startAt: Math.max(args.start - PAD, Date.now()), stopAt: args.end + PAD,
              }),
            );
          }
          if (cmd === "rec_start") {
            const sched = args.scheduleId ? find(args.scheduleId) : null;
            if (args.scheduleId && sched?.status !== "scheduled") return Promise.reject("cancelled");
            if (window.__refuse) {
              if (sched) window.__put({ ...sched, status: "failed", reason: window.__refuse, due: false, endedAt: Date.now() });
              return Promise.reject(window.__refuse);
            }
            const id = args.scheduleId ?? "r" + ++window.__native.n;
            window.__put({
              id, channel: args.channel, programme: args.programme ?? null, playlistId: args.playlistId,
              startedAt: Date.now(), endedAt: null, path: `C:\\Videos\\${id}.ts`, bytes: 0,
              status: "recording", reason: null, buffer: false,
              ...(args.until ? { stopAt: args.until + PAD } : sched?.stopAt ? { stopAt: sched.stopAt } : {}),
            });
            return Promise.resolve(id);
          }
          if (cmd === "rec_schedule_fail") {
            const r = find(args.id);
            if (r?.status === "scheduled") window.__put({ ...r, status: "failed", reason: args.reason, due: false, endedAt: Date.now() });
            return Promise.resolve(undefined);
          }
          if (cmd === "rec_delete") {
            if (find(args.id)?.status === "recording") return Promise.reject("stop the recording first");
            window.__native.recs = window.__native.recs.filter((x) => x.id !== args.id);
            return Promise.resolve(undefined);
          }
          if (cmd === "rec_default_folder") return Promise.resolve("C:\\Users\\sam\\Videos\\BlammyTV");
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      localStorage.setItem(
        "blammytv.playlists",
        JSON.stringify({
          v: 1,
          data: [
            { kind: "xtream", id: "t", name: "Test", enabled: true, server: panel, username: "u", password: "p" },
          ],
        }),
      );
      localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
    },
    { max, panel: PANEL },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  // The guide arrives after the channels (an empty lane reads "No Information" until it does).
  await page.locator(`.guide__row[data-channel="t:101"] .guide__cell[data-start]`).first().waitFor({ timeout: 30_000 });
  // The line's reading is in: the sidebar's pill is drawn from it, and Record counts against it.
  if (max !== "none") await page.locator(".live-conns").first().waitFor({ timeout: 15_000 });
  return { ctx, page, errors };
}

const calls = (page, cmd) => page.evaluate((c) => window.__calls.filter((x) => x[0] === c).map((x) => x[1]), cmd);
const put = (page, rec) => page.evaluate((r) => window.__put(r), rec);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ESPN = "t:101";
const SKY = "t:102";
const MIN = 60_000;

/** A channel's programme cells: their own times, as the Guide drew them. */
const cells = (page, id) =>
  page.evaluate(
    (id) =>
      [...document.querySelectorAll(`.guide__row[data-channel="${id}"] .guide__cell[data-start]`)].map((c) => ({
        start: Number(c.dataset.start),
        end: Number(c.dataset.end),
        title: c.dataset.hint,
      })),
    id,
  );
const cell = (page, id, start) => page.locator(`.guide__row[data-channel="${id}"] .guide__cell[data-start="${start}"]`);
/** The first programme that starts at least `hours` from now. */
async function ahead(page, id, hours) {
  const now = await page.evaluate(() => Date.now());
  const c = (await cells(page, id)).find((x) => x.start >= now + hours * 60 * MIN - 30 * MIN && x.start > now + 65 * MIN);
  if (!c) throw new Error(`no programme ${hours}h ahead on ${id}`);
  return c;
}
const menu = (page) => page.locator("[data-slot=context-menu-content]");
const menuItems = (page) => menu(page).locator("[role=menuitem]");
async function rightClick(page, loc) {
  // A pinned cell is only as wide as what shows of it: click near its left edge.
  await loc.click({ button: "right", position: { x: 20, y: 20 } });
  await menu(page).waitFor({ timeout: 5000 });
}
const itemNames = async (page) => (await menuItems(page).allInnerTexts()).map((t) => t.trim());
const closeMenu = async (page) => {
  await page.keyboard.press("Escape");
  await menu(page).waitFor({ state: "detached", timeout: 5000 });
};
const toast = (page) => page.locator(".live-toast__msg");
/** The toast once it says something that matches, so an earlier one still
 * on screen is not read for it. */
async function said(page, re) {
  // A toast that never comes reads as a failed check, not a crash.
  const came = await page
    .waitForFunction((src) => new RegExp(src).test(document.querySelector(".live-toast__msg")?.textContent ?? ""), re.source, { timeout: 8000 })
    .then(() => true, () => false);
  return came ? toast(page).innerText() : `(no toast matching ${re})`;
}
const dot = (page, id, start) => cell(page, id, start).locator(".guide__rec--sched");
const cardDot = (page, id) => page.locator(`.guide__row[data-channel="${id}"] .guide__card .guide__rec`);
const modeTab = (page, name) => page.locator(`.live-sidebar [role=tab][aria-label="${name}"]`);
const row = (page, id) => page.locator(`.rec-row[data-id="${id}"]`);
const natives = (page) => page.evaluate(() => window.__native.recs);

/** Record on a programme: right-click it and pick the item named `name`. */
async function pick(page, id, c, name) {
  await rightClick(page, cell(page, id, c.start));
  await menuItems(page).filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).click();
  await menu(page).waitFor({ state: "detached", timeout: 5000 });
}

// ============================================ scheduling, listing, cancelling
{
  const { ctx, page, errors } = await open({ max: 3 });
  const later = await ahead(page, ESPN, 2);

  await rightClick(page, cell(page, ESPN, later.start));
  let names = await itemNames(page);
  check("right-click a programme to come: Record is in the menu", names.includes("Record"), names.join(" | "));
  check("  and Cancel Recording is not", !names.includes("Cancel Recording"));
  check("  beside the channel’s own items", names.includes("Add to Multi-View"));
  await closeMenu(page);

  await pick(page, ESPN, later, "Record");
  const told = await said(page, /^Scheduled to record /);
  check("Record says it is scheduled, with the programme", /^Scheduled to record .+ \(.+\)\.$/.test(told) && told.includes(later.title), told);
  const sent = await calls(page, "rec_schedule");
  check("  it asked native once, for this channel and playlist", sent.length === 1 && sent[0].channelId === ESPN && sent[0].channel === "Fake ESPN 4K" && sent[0].playlistId === "t" && sent[0].programme === later.title, JSON.stringify(sent));
  check(
    "  with the programme’s own start and end (native adds the minute either side)",
    sent[0].start === later.start && sent[0].end === later.end,
    `${sent[0].start}..${sent[0].end} vs ${later.start}..${later.end}`,
  );
  check("  and started nothing yet", (await calls(page, "rec_start")).length === 0);
  await dot(page, ESPN, later.start).waitFor({ timeout: 5000 });
  check("the programme’s cell has the dot", (await dot(page, ESPN, later.start).count()) === 1);
  check("  and says so to a screen reader", /scheduled to record/.test((await cell(page, ESPN, later.start).getAttribute("aria-label")) ?? ""));
  check("  and no other cell has it", (await page.locator(".guide__rec--sched").count()) === 1);
  check("  and the channel’s card has no recording dot, as nothing is recording", (await cardDot(page, ESPN).count()) === 0);

  await rightClick(page, cell(page, ESPN, later.start));
  names = await itemNames(page);
  check("the menu then offers Cancel Recording, and not Record", names.includes("Cancel Recording") && !names.includes("Record"), names.join(" | "));
  await closeMenu(page);

  // The list.
  await modeTab(page, "Recordings").click();
  const sid = (await natives(page))[0].id;
  await row(page, sid).waitFor({ timeout: 5000 });
  const r = row(page, sid);
  check("Live TV → Recordings has the row, Scheduled", (await r.getAttribute("data-status")) === "scheduled" && /Scheduled/.test(await r.locator(".rec-row__status").innerText()));
  check("  with the programme and the channel", (await r.locator(".rec-row__title").innerText()) === later.title && /Fake ESPN 4K/.test(await r.locator(".rec-row__sub").innerText()));
  const meta = await r.locator(".rec-row__meta").innerText();
  check("  with no length or size (it has no file)", !/KB|MB|GB|\d:\d\d/.test(meta), meta);
  const buttons = (await r.getByRole("button").allInnerTexts()).map((t) => t.trim());
  check("  and Cancel Recording, with no Play, Show in Folder or Delete", buttons.length === 1 && buttons[0] === "Cancel Recording", buttons.join(" | "));
  await r.getByRole("button", { name: "Cancel Recording" }).click();
  await page.waitForFunction((id) => !document.querySelector(`.rec-row[data-id="${id}"]`), sid);
  const del = await calls(page, "rec_delete");
  check("Cancel Recording in the list deletes the record by id", del.length === 1 && del[0].id === sid, JSON.stringify(del));
  await page.locator(".guide-empty").waitFor({ timeout: 5000 });
  check("  and the list is empty again", (await page.locator(".rec-row").count()) === 0);
  await modeTab(page, "Playlist").click();
  await page.locator(".guide__channel").first().waitFor({ timeout: 5000 });
  check("  and the cell has lost its dot", (await dot(page, ESPN, later.start).count()) === 0);

  // And from the menu.
  await pick(page, ESPN, later, "Record");
  await dot(page, ESPN, later.start).waitFor({ timeout: 5000 });
  const id2 = (await natives(page))[0].id;
  await pick(page, ESPN, later, "Cancel Recording");
  await page.waitForFunction(([c, s]) => !document.querySelector(`.guide__row[data-channel="${c}"] .guide__cell[data-start="${s}"] .guide__rec--sched`), [ESPN, later.start]);
  const del2 = await calls(page, "rec_delete");
  check("Cancel Recording in the menu deletes it too, and the dot goes", del2.length === 2 && del2[1].id === id2 && (await natives(page)).length === 0);
  const gone = await said(page, /^Recording canceled\.$/);
  check("  and says so", gone === "Recording canceled.", gone);
  await rightClick(page, cell(page, ESPN, later.start));
  check("  and the menu offers Record again", (await itemNames(page)).includes("Record"));
  await closeMenu(page);

  // The card has no Record: it is for a programme.
  await rightClick(page, page.locator(`.guide__row[data-channel="${ESPN}"] .guide__card`));
  names = await itemNames(page);
  check("right-click a channel’s card: no Record (it is for a programme)", !names.includes("Record") && !names.includes("Cancel Recording") && names.includes("Add to Multi-View"), names.join(" | "));
  await closeMenu(page);

  // ------------------------------------------------ the start comes
  await pick(page, ESPN, later, "Record");
  await dot(page, ESPN, later.start).waitFor({ timeout: 5000 });
  const sched = (await natives(page))[0];
  await page.evaluate((id) => window.__due(id), sched.id);
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "rec_start"), null, { timeout: 10_000 });
  const started = (await calls(page, "rec_start"))[0];
  check(
    "native saying it is due makes the page start it, as Record does, with the record’s id",
    started.scheduleId === sched.id && /\/live\/u\/p\/101\.ts$/.test(started.url) && started.channel === "Fake ESPN 4K" && started.programme === later.title && started.playlistId === "t",
    JSON.stringify({ ...started, url: started.url.replace(/\/live\/.*/, "/live/…") }),
  );
  check("  with no end of its own (native has the record’s)", started.until == null);
  await page.waitForFunction((id) => window.__native.recs.find((r) => r.id === id)?.status === "recording", sched.id);
  check("  and it is one record, now recording, not two", (await natives(page)).length === 1);
  await cardDot(page, ESPN).waitFor({ timeout: 5000 });
  check("  the channel’s card shows the recording dot", (await cardDot(page, ESPN).count()) === 1);
  check("  and the cell’s scheduled dot is gone", (await dot(page, ESPN, later.start).count()) === 0);
  await sleep(300);
  check("  and it was asked for once", (await calls(page, "rec_start")).length === 1);
  check("  and the page reported no missing link, as it had one", (await calls(page, "rec_schedule_fail")).length === 0);
  await put(page, { ...(await natives(page))[0], status: "done", endedAt: Date.now(), bytes: 1024 });

  // A start native refuses: Failed, with why.
  const lateTwo = (await cells(page, ESPN)).find((c) => c.start >= later.end);
  await page.evaluate(() => (window.__refuse = "not enough free disk space (recording needs 2 GB)"));
  await pick(page, ESPN, lateTwo, "Record");
  await dot(page, ESPN, lateTwo.start).waitFor({ timeout: 5000 });
  const sched2 = (await natives(page)).find((r) => r.status === "scheduled");
  await page.evaluate((id) => window.__due(id), sched2.id);
  await page.waitForFunction((id) => window.__native.recs.find((r) => r.id === id)?.status === "failed", sched2.id);
  await modeTab(page, "Recordings").click();
  await row(page, sched2.id).waitFor({ timeout: 5000 });
  check(
    "a start native refuses leaves the row Failed, with native’s reason",
    (await row(page, sched2.id).getAttribute("data-status")) === "failed" && /Not enough free disk space/.test(await row(page, sched2.id).locator(".rec-row__why").innerText()),
    await row(page, sched2.id).innerText(),
  );
  const fb = (await row(page, sched2.id).getByRole("button").allInnerTexts()).map((t) => t.trim());
  check("  with no Show in Folder (it has no file), and Delete", !fb.includes("Show in Folder") && fb.includes("Delete"), fb.join(" | "));

  // A missed start.
  await put(page, {
    id: "miss1", channel: "Fake ESPN 4K", programme: "The One You Missed", playlistId: "t", startedAt: Date.now() - 3 * 60 * MIN,
    endedAt: Date.now() - 2 * 60 * MIN, path: "", bytes: 0, status: "missed", reason: "the app was not running at the start",
    buffer: false, channelId: ESPN, startAt: Date.now() - 3 * 60 * MIN - MIN, stopAt: Date.now() - 2 * 60 * MIN,
  });
  await row(page, "miss1").waitFor({ timeout: 5000 });
  const m = row(page, "miss1");
  check("a missed start is a row that says Missed, and why", (await m.getAttribute("data-status")) === "missed" && /Missed/.test(await m.locator(".rec-row__status").innerText()) && (await m.locator(".rec-row__why").innerText()) === "The app was not running at the start.", await m.innerText());
  const mb = (await m.getByRole("button").allInnerTexts()).map((t) => t.trim());
  check("  with Delete and nothing to play, show or cancel", mb.length === 1 && mb[0] === "Delete", mb.join(" | "));
  await modeTab(page, "Playlist").click();
  await page.locator(".guide__channel").first().waitFor({ timeout: 5000 });
  check("  and neither it nor the Failed one marks a programme in the Guide", (await page.locator(".guide__rec--sched").count()) === 0);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ================================================ a programme that is on
{
  const { ctx, page, errors } = await open({ max: 3 });
  const now = await page.evaluate(() => Date.now());
  const on = (await cells(page, ESPN)).find((c) => c.start <= now && now < c.end);
  await pick(page, ESPN, on, "Record");
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "rec_start"), null, { timeout: 10_000 });
  const s = (await calls(page, "rec_start"))[0];
  check(
    "Record on a programme that is on starts it now, through rec_start, until the programme’s end",
    s.until === on.end && s.scheduleId == null && /\/live\/u\/p\/101\.ts$/.test(s.url) && s.channel === "Fake ESPN 4K" && s.programme === on.title,
    JSON.stringify({ until: s.until, end: on.end, scheduleId: s.scheduleId }),
  );
  check("  and keeps nothing to wait for", (await calls(page, "rec_schedule")).length === 0);
  const now1 = await said(page, /^Recording /);
  check("  and says it is recording", now1 === `Recording ${on.title}.`, now1);
  await cardDot(page, ESPN).waitFor({ timeout: 5000 });
  await rightClick(page, cell(page, ESPN, on.start));
  const row1 = menuItems(page).filter({ hasText: /^\s*Recording\s*$/ });
  check("  and right-clicking it again says Recording, off", (await row1.count()) === 1 && ((await row1.getAttribute("aria-disabled")) === "true" || (await row1.getAttribute("data-disabled")) !== null));
  check("  with no Record or Cancel Recording beside it", !(await itemNames(page)).some((n) => n === "Record" || n === "Cancel Recording"));
  await closeMenu(page);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ===================================================== a line of one
{
  const { ctx, page, errors } = await open({ max: 1 });
  const later = await ahead(page, ESPN, 2);
  // Something is recording, and nothing says when it will stop.
  await put(page, {
    id: "run1", channel: "Fake Sky Sports FHD", programme: null, playlistId: "t", startedAt: Date.now() - MIN, endedAt: null,
    path: "C:\\Videos\\run1.ts", bytes: 0, status: "recording", reason: null, buffer: false,
  });
  await pick(page, ESPN, later, "Record");
  const clash1 = await said(page, /^Couldn’t schedule/);
  check(
    "on a line of one with a recording running, a clash is said when it is scheduled",
    clash1 === "Couldn’t schedule: 1 other recording overlaps this one, and your line allows 1 stream at once.",
    clash1,
  );
  check("  and nothing was kept", (await calls(page, "rec_schedule")).length === 0 && (await dot(page, ESPN, later.start).count()) === 0);
  // The recording ends: the line is free for it.
  await put(page, { ...(await natives(page))[0], status: "done", endedAt: Date.now(), bytes: 1024 });
  await pick(page, ESPN, later, "Record");
  await dot(page, ESPN, later.start).waitFor({ timeout: 5000 });
  check("  and once it has ended the same press schedules", (await calls(page, "rec_schedule")).length === 1);
  // A programme clear of it, hours later, is no clash; one on top of it is.
  const clear = (await cells(page, ESPN)).find((c) => c.start >= later.end + 2 * MIN);
  await pick(page, ESPN, clear, "Record");
  await dot(page, ESPN, clear.start).waitFor({ timeout: 5000 });
  check("a programme that starts after the scheduled one ends is not a clash", (await calls(page, "rec_schedule")).length === 2);
  const sky = (await cells(page, SKY)).find((c) => c.start < later.end && c.end > later.start);
  await pick(page, SKY, sky, "Record");
  await said(page, /^Couldn’t schedule/);
  check("  and another channel’s programme at the same time, on the same line, is", (await calls(page, "rec_schedule")).length === 2 && (await dot(page, SKY, sky.start).count()) === 0);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ===================================================== a line of two
{
  const { ctx, page, errors } = await open({ max: 2 });
  const later = await ahead(page, ESPN, 2);
  await put(page, {
    id: "run1", channel: "Fake Sky Sports FHD", programme: null, playlistId: "t", startedAt: Date.now() - MIN, endedAt: null,
    path: "C:\\Videos\\run1.ts", bytes: 0, status: "recording", reason: null, buffer: false,
  });
  await pick(page, ESPN, later, "Record");
  await dot(page, ESPN, later.start).waitFor({ timeout: 5000 });
  check("on a line of two, a recording and one more scheduled fit", (await calls(page, "rec_schedule")).length === 1);
  const sky = (await cells(page, SKY)).find((c) => c.start < later.end && c.end > later.start);
  await pick(page, SKY, sky, "Record");
  const clash2 = await said(page, /^Couldn’t schedule/);
  check(
    "  and a third, scheduled to overlap them, is a clash that counts both",
    clash2 === "Couldn’t schedule: 2 other recordings overlap this one, and your line allows 2 streams at once." && (await calls(page, "rec_schedule")).length === 1,
    clash2,
  );
  // A recording of the player’s own buffer opens no connection of its own.
  await put(page, { ...(await natives(page)).find((r) => r.id === "run1"), buffer: true });
  await pick(page, SKY, sky, "Record");
  await dot(page, SKY, sky.start).waitFor({ timeout: 5000 });
  check("  and a recording that reads the player’s buffer is not counted", (await calls(page, "rec_schedule")).length === 2);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ============================================ a line that reports no limit
{
  const { ctx, page, errors } = await open({ max: "none" });
  const later = await ahead(page, ESPN, 2);
  for (const id of ["a", "b", "c"])
    await put(page, {
      id, channel: "Fake Sky Sports FHD", programme: null, playlistId: "t", startedAt: Date.now() - MIN, endedAt: null,
      path: `C:\\Videos\\${id}.ts`, bytes: 0, status: "recording", reason: null, buffer: false,
    });
  await pick(page, ESPN, later, "Record");
  await dot(page, ESPN, later.start).waitFor({ timeout: 5000 });
  check("a line that reports no limit is never refused", (await calls(page, "rec_schedule")).length === 1);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
