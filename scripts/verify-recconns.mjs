// E2E: recordings and the connection limit (plan 029, batch C1), the page's
// half, with the native side (rec.rs) stubbed at the IPC boundary and the
// panel's count stood in for by the harness.
//
// What it holds:
// - D3. On a line that allows one stream, Record on the channel on screen
//   asks first (a dialog that says what it means), and only then reads the
//   player's buffer (rec_buffer_start, never rec_start). Cancel calls
//   neither. "Don't Show Again" skips the dialog next time, and Settings →
//   Playback → Recordings Folder brings it back. A buffer recording that
//   native ends by itself (Go Live, a channel change) puts the button back
//   to Record.
// - D5. Every other line gets a heads-up first, in the same dialog: a line
//   of three names its limit, one that reports none names the provider's.
//   Start Recording calls rec_start, Cancel calls nothing, and its own
//   Don't Show Again skips it next time. The two Don't Show Agains are
//   separate flags (D3 on a line of one still asks after the heads-up is
//   off, and the other way round), and Settings brings both back.
// - Counts. A recording starting or ending re-asks the panel (the sidebar
//   pill catches up), counted from the panel calls themselves.
// - Multi-View. A running stream recording is the app's own connection: one
//   fewer tile, and never "Elsewhere". Another device's stream still is.
// - Install and Restart wait while a recording runs, and say so; they go
//   ahead once it ends. The same while a finished one has a job (native is
//   repackaging or shrinking its file, Phase 4), running or still waiting its
//   turn, and they are let go when the job ends.
//
// HOW. verify-recordings' stub (isTauri() is true, the real player path
// runs) with rec_buffer_start added, and the panel's player_api answered here:
// it reports as in use every running stream recording (a buffer one opens no
// connection) plus whatever `__extra` says another device holds. Every call
// is logged in __calls.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-recconns.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** A page with the stub in, on the Guide, ready to play a channel.
 * `max` is the line's limit ("none" for a panel that does not report one),
 * `extra` the streams another device holds, `pending` a staged frontend. */
async function open({ max = 3, extra = 0, pending = "", query = "", tab = "live", seed = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ max, extra, pending, tab, seed }) => {
      window.__calls = [];
      window.__native = { recs: [], n: 0 };
      window.__panel = { max, extra };
      window.__pollAt = [];
      window.__pending = pending;
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
      const make = (args, buffer) => {
        const id = (buffer ? "b" : "r") + ++window.__native.n;
        window.__put({
          id, channel: args.channel, programme: args.programme ?? null, playlistId: args.playlistId,
          startedAt: Date.now(), endedAt: null, path: `C:\\Videos\\${id}.ts`, bytes: 0,
          status: "recording", reason: null, buffer,
        });
        return id;
      };
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
              window.__pollAt.push(Date.now());
              return fetch(args.url)
                .then((r) => r.json())
                .then((j) => {
                  // Only the stream recordings on this panel's line hold one of its connections.
                  const held = window.__native.recs.filter(
                    (r) => r.status === "recording" && !r.buffer && r.playlistId === "t",
                  ).length;
                  if (window.__panel.max === "none") {
                    delete j.user_info.max_connections;
                    delete j.user_info.active_cons;
                  } else {
                    j.user_info.active_cons = String(held + window.__panel.extra);
                    j.user_info.max_connections = String(window.__panel.max);
                  }
                  window.__answered = (window.__answered ?? 0) + 1;
                  return new TextEncoder().encode(JSON.stringify(j)).buffer;
                });
            }
            return fetch(args.url).then((r) => r.arrayBuffer());
          }
          if (cmd === "plugin:event|listen") {
            (listeners[args.event] ??= []).push(args.handler);
            return Promise.resolve(++cb);
          }
          if (cmd === "mpv_status" && window.__presenting)
            return Promise.resolve(
              JSON.stringify({
                pos: 10, dur: 0, presenting: true, ended: false, buffering: false, seekable: true,
                cacheDur: 0, dvrStart: 0, dvrEnd: 0, audio: [], subs: [], chapters: [],
              }),
            );
          if (cmd === "rec_list") return Promise.resolve([...window.__native.recs].sort((a, b) => b.startedAt - a.startedAt));
          if (cmd === "rec_start") return Promise.resolve(make(args, false));
          if (cmd === "rec_buffer_start") {
            if (window.__native.recs.some((r) => r.status === "recording" && r.buffer))
              return Promise.reject("the player's buffer is already being recorded");
            return Promise.resolve(make(args, true));
          }
          if (cmd === "rec_stop") {
            const r = window.__native.recs.find((x) => x.id === args.id);
            return Promise.resolve(window.__put({ ...r, status: "done", endedAt: Date.now(), bytes: 1024 }));
          }
          if (cmd === "rec_default_folder") return Promise.resolve("C:\\Users\\sam\\Videos\\BlammyTV");
          if (cmd === "frontend_status") return Promise.resolve({ serving: "", pending: window.__pending });
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      // What an earlier page left in storage (the "Don't Show Again" flags).
      for (const [k, v] of Object.entries(seed)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
      localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      localStorage.setItem(
        "blammytv.playlists",
        JSON.stringify({
          v: 1,
          data: [
            { kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" },
          ],
        }),
      );
      localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: tab }));
    },
    { max, extra, pending, tab, seed },
  );
  await page.goto(APP + query, { waitUntil: "domcontentloaded" });
  return { ctx, page, errors };
}

const calls = (page, cmd) => page.evaluate((c) => window.__calls.filter((x) => x[0] === c).map((x) => x[1]), cmd);
const put = (page, rec) => page.evaluate((r) => window.__put(r), rec);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (page, name) => page.locator(`.guide__row:has(.guide__card[aria-label^="${name}"]) .guide__card`);
const recButton = (page) => page.locator(".theater-controls .rec-btn button");
const label = (page) => recButton(page).getAttribute("aria-label");
const wake = async (page) => {
  await page.mouse.move(700, 300);
  await page.mouse.move(720, 330);
};
const backOut = async (page) => {
  await wake(page);
  await page.locator(".theater-topleft button[aria-label=Back]").click();
};
const ESPN = "Fake ESPN";
/** Into the theater on a channel, with the picture presenting. */
async function toTheater(page, name = ESPN) {
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await card(page, name).click();
  // The tune's own looks at the panel come 4s and 20s after this.
  await page.evaluate(() => (window.__tuneAt = Date.now()));
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => (window.__presenting = true));
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await recButton(page).waitFor({ timeout: 5000 });
}
/** The player closed, the way the mini player's Stop does it. */
async function closePlayer(page) {
  await backOut(page);
  await page.locator(".mini-overlay").waitFor({ timeout: 5000 });
  await page.locator('.mini-overlay [aria-label="Stop"]').click();
  await page.locator(".mini-overlay").waitFor({ state: "detached" });
}
const dialog = (page) => page.getByRole("dialog");
const warnStored = (page) => page.evaluate(() => localStorage.getItem("blammytv.recordingWarning"));
const noticeStored = (page) => page.evaluate(() => localStorage.getItem("blammytv.recordingNotice"));
/** The recording flags as the page itself stored them, to seed a later page. */
const flags = (page) =>
  page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /^blammytv\.recording(Warning|Notice)$/.test(k))));
const OFF = JSON.stringify({ v: 1, data: false });
const ON = JSON.stringify({ v: 1, data: true });
/** For the sections that are about something else than the heads-up: it is off, as after its Don't Show Again. */
const NO_HEADS_UP = { "blammytv.recordingNotice": OFF };
const BUFFER_TITLE = /Record What You’re Watching/;
const NOTICE_TITLE = /Recording Uses a Connection/;
const RUNNING = () => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording";
const IDLE = () => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Record";
/** The line's reading is in: the sidebar's pill is drawn from it. */
const readingIn = (page) => page.locator(".live-conns").first().waitFor({ timeout: 15_000 });

/** The flags after D3’s Don’t Show Again was ticked and nothing else. */
const saved = { d3Off: {} };

// ===================================================== D3: a line of one
{
  const { ctx, page, errors } = await open({ max: 1 });
  await toTheater(page);
  await readingIn(page);
  const kinds = async () => ({ stream: (await calls(page, "rec_start")).length, buffer: (await calls(page, "rec_buffer_start")).length });

  await wake(page);
  await recButton(page).click();
  await dialog(page).waitFor({ timeout: 5000 });
  const words = await dialog(page).innerText();
  check("on a line of one, Record asks first, with a dialog", /Record What You’re Watching/.test(words), words.replace(/\n/g, " | "));
  check(
    "  that says what it means: it records the picture, and when it stops",
    /Your line allows one stream, so this records from the picture you’re watching\. It stops if you change channels, go live, or the stream reconnects\./.test(words),
  );
  check("  with a verb to go ahead, Cancel and an unticked Don’t Show Again", (await dialog(page).getByRole("button", { name: "Start Recording" }).count()) === 1 && (await dialog(page).getByRole("button", { name: "Cancel" }).count()) === 1 && !(await dialog(page).getByLabel("Don’t Show Again").isChecked()));
  const k0 = await kinds();
  check("  and nothing has been started yet", k0.stream === 0 && k0.buffer === 0, JSON.stringify(k0));

  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await dialog(page).waitFor({ state: "detached", timeout: 5000 });
  const k1 = await kinds();
  check("Cancel calls neither rec_start nor rec_buffer_start", k1.stream === 0 && k1.buffer === 0, JSON.stringify(k1));
  check("  and the button is still Record", (await label(page)) === "Record");
  check("  and the warning is still on", (await warnStored(page)) === null);

  await wake(page);
  await recButton(page).click();
  await dialog(page).getByRole("button", { name: "Start Recording" }).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
  const k2 = await kinds();
  check("going ahead reads the player's buffer, and opens no second stream", k2.stream === 0 && k2.buffer === 1, JSON.stringify(k2));
  const b = (await calls(page, "rec_buffer_start"))[0] ?? {};
  check(
    "  with the channel, the programme on now, the playlist and no folder chosen",
    b.channel === "Fake ESPN 4K" && /^ESPN Hour \d+$/.test(b.programme ?? "") && b.playlistId === "t" && b.folder == null && !("url" in b),
    JSON.stringify(b),
  );
  check("  and now it is Stop Recording, with the dot", (await page.locator(".rec-btn .rec-dot").count()) === 1);
  await dialog(page).waitFor({ state: "detached", timeout: 5000 });
  check("  and the dialog is gone", (await dialog(page).count()) === 0);

  // Native ends it by itself when the player goes live or changes channel.
  await put(page, { ...(await page.evaluate(() => window.__native.recs[0])), status: "partial", endedAt: Date.now(), bytes: 4096, reason: "stopped when the channel changed" });
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Record");
  check("when native ends it (Go Live, a channel change) the button goes back to Record, with no rec_stop asked", (await calls(page, "rec_stop")).length === 0 && (await page.locator(".rec-btn .rec-dot").count()) === 0);

  // Stop Recording works as for any recording.
  await wake(page);
  await recButton(page).click();
  await dialog(page).getByRole("button", { name: "Start Recording" }).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Record");
  const stops = await calls(page, "rec_stop");
  check("Stop Recording ends a buffer recording through rec_stop by id", stops.length === 1 && stops[0].id === "b2", JSON.stringify(stops));

  // Don't Show Again.
  await wake(page);
  await recButton(page).click();
  await dialog(page).getByLabel("Don’t Show Again").check();
  await dialog(page).getByRole("button", { name: "Start Recording" }).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
  check("ticking Don’t Show Again and going ahead still records", (await kinds()).buffer === 3);
  check("  and keeps the choice, stored like the other settings", (await warnStored(page)) === OFF, String(await warnStored(page)));
  check("  and leaves the heads-up’s own choice alone", (await noticeStored(page)) === null);
  saved.d3Off = await flags(page);
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Record");
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => window.__calls.filter((c) => c[0] === "rec_buffer_start").length === 4);
  check("the next press skips the dialog and goes straight to the buffer", (await dialog(page).count()) === 0 && (await kinds()).stream === 0);
  await put(page, { ...(await page.evaluate(() => window.__native.recs.find((r) => r.id === "b4"))), status: "partial", endedAt: Date.now(), reason: "stopped when the channel changed" });

  // Settings brings it back.
  await closePlayer(page);
  await page.locator('.header__right [aria-label="Settings"]').click();
  await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Playback", exact: true }).click();
  const row = page.locator("[data-setting='recordings-folder']");
  await row.waitFor({ timeout: 5000 });
  const back = row.getByRole("button", { name: "Show Recording Warnings Again" });
  check("with the warning off, Settings → Playback → Recordings Folder offers to show the warnings again", (await back.count()) === 1);
  await back.click();
  check("  pressing it turns it on, and it goes", (await back.count()) === 0 && (await warnStored(page)) === ON);
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 });
  await toTheater(page);
  await wake(page);
  await recButton(page).click();
  await dialog(page).waitFor({ timeout: 5000 });
  check("  and the next Record asks again", (await dialog(page).count()) === 1);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ============================================ D5: a heads-up on every other line
{
  const { ctx, page, errors } = await open({ max: 3 });
  await toTheater(page);
  await readingIn(page);
  const starts = async () => ({ stream: (await calls(page, "rec_start")).length, buffer: (await calls(page, "rec_buffer_start")).length });

  await wake(page);
  await recButton(page).click();
  await dialog(page).waitFor({ timeout: 5000 });
  const words = await dialog(page).innerText();
  check("on a line of three, Record says it uses a connection, with a dialog", NOTICE_TITLE.test(words) && !BUFFER_TITLE.test(words), words.replace(/\n/g, " | "));
  check(
    "  that names the line’s number",
    /This recording uses one of the 3 streams your line allows, for as long as it runs\./.test(words),
  );
  check("  with Start Recording, Cancel and an unticked Don’t Show Again", (await dialog(page).getByRole("button", { name: "Start Recording" }).count()) === 1 && (await dialog(page).getByRole("button", { name: "Cancel" }).count()) === 1 && !(await dialog(page).getByLabel("Don’t Show Again").isChecked()));
  const s0 = await starts();
  check("  and nothing has been started yet", s0.stream === 0 && s0.buffer === 0, JSON.stringify(s0));

  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await dialog(page).waitFor({ state: "detached", timeout: 5000 });
  const s1 = await starts();
  check("on the heads-up, Cancel calls neither rec_start nor rec_buffer_start", s1.stream === 0 && s1.buffer === 0, JSON.stringify(s1));
  check("  and the button is still Record, with both choices untouched", (await label(page)) === "Record" && (await warnStored(page)) === null && (await noticeStored(page)) === null);

  await wake(page);
  await recButton(page).click();
  // Twice, quickly: the dialog takes clicks while it fades, and one press is one recording.
  await dialog(page).getByRole("button", { name: "Start Recording" }).dblclick();
  await page.waitForFunction(RUNNING);
  const s2 = await starts();
  check("Start Recording (double-clicked) opens one stream of its own, and reads no buffer", s2.stream === 1 && s2.buffer === 0, JSON.stringify(s2));
  const r = (await calls(page, "rec_start"))[0] ?? {};
  check("  for the channel and the playlist", r.channel === "Fake ESPN 4K" && r.playlistId === "t" && typeof r.url === "string", JSON.stringify(r));
  await dialog(page).waitFor({ state: "detached", timeout: 5000 });
  check("  and the dialog is gone, with the choices untouched", (await dialog(page).count()) === 0 && (await noticeStored(page)) === null && (await warnStored(page)) === null);
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(IDLE);

  // Don't Show Again.
  await wake(page);
  await recButton(page).click();
  await dialog(page).getByLabel("Don’t Show Again").check();
  await dialog(page).getByRole("button", { name: "Start Recording" }).click();
  await page.waitForFunction(RUNNING);
  check("ticking Don’t Show Again and going ahead still records", (await starts()).stream === 2);
  check("  and stores the heads-up’s choice, not D3’s", (await noticeStored(page)) === OFF && (await warnStored(page)) === null, `${await noticeStored(page)} / ${await warnStored(page)}`);
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(IDLE);
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => window.__calls.filter((c) => c[0] === "rec_start").length === 3);
  check("the next press skips the heads-up and opens the stream", (await dialog(page).count()) === 0 && (await starts()).buffer === 0);
  const noticeOff = await flags(page);
  check("the flags the page left: the heads-up off, D3’s still on", noticeOff["blammytv.recordingNotice"] === OFF && !("blammytv.recordingWarning" in noticeOff), JSON.stringify(noticeOff));
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(IDLE);

  // Settings brings it back.
  await closePlayer(page);
  await page.locator('.header__right [aria-label="Settings"]').click();
  await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Playback", exact: true }).click();
  const row = page.locator("[data-setting='recordings-folder']");
  await row.waitFor({ timeout: 5000 });
  const back = row.getByRole("button", { name: "Show Recording Warnings Again" });
  check("with only the heads-up off, Settings → Playback → Recordings Folder still offers the warnings again", (await back.count()) === 1);
  await back.click();
  check("  pressing it turns the heads-up on, and it goes", (await back.count()) === 0 && (await noticeStored(page)) === ON);
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 });
  await toTheater(page);
  await wake(page);
  await recButton(page).click();
  await dialog(page).waitFor({ timeout: 5000 });
  check("  and the next Record says it again", (await dialog(page).count()) === 1 && NOTICE_TITLE.test(await dialog(page).innerText()));
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();

  // The flags are separate: each one’s Don't Show Again leaves the other’s dialog alone.
  {
    const o = await open({ max: 1, seed: noticeOff });
    await toTheater(o.page);
    await readingIn(o.page);
    await wake(o.page);
    await recButton(o.page).click();
    await dialog(o.page).waitFor({ timeout: 5000 }).catch(() => {});
    const w = (await dialog(o.page).count()) ? await dialog(o.page).innerText() : "";
    check("with the heads-up off, a line of one still asks D3’s question", BUFFER_TITLE.test(w) && !NOTICE_TITLE.test(w), w.replace(/\n/g, " | "));
    await dialog(o.page).getByRole("button", { name: "Start Recording" }).click();
    await o.page.waitForFunction(RUNNING);
    await dialog(o.page).waitFor({ state: "detached", timeout: 5000 });
    await sleep(300);
    check("  and going ahead reads the buffer, with no second dialog after it", (await calls(o.page, "rec_buffer_start")).length === 1 && (await calls(o.page, "rec_start")).length === 0 && (await dialog(o.page).count()) === 0);
    check("  no page errors", o.errors.length === 0, o.errors.slice(0, 2).join(" | "));
    await o.ctx.close();
  }
  {
    const o = await open({ max: 3, seed: saved.d3Off });
    await toTheater(o.page);
    await readingIn(o.page);
    await wake(o.page);
    await recButton(o.page).click();
    await dialog(o.page).waitFor({ timeout: 5000 }).catch(() => {});
    const w = (await dialog(o.page).count()) ? await dialog(o.page).innerText() : "";
    check("with D3’s warning off, a line of three still gets the heads-up", NOTICE_TITLE.test(w), w.replace(/\n/g, " | "));
    check("  no page errors", o.errors.length === 0, o.errors.slice(0, 2).join(" | "));
    await o.ctx.close();
  }
  // Both off: one press in Settings brings both back.
  {
    const o = await open({ max: 3, seed: { ...saved.d3Off, ...noticeOff } });
    await o.page.locator('.header__right [aria-label="Settings"]').click();
    await o.page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Playback", exact: true }).click();
    const rowB = o.page.locator("[data-setting='recordings-folder']");
    await rowB.waitFor({ timeout: 5000 });
    const btn = rowB.getByRole("button", { name: "Show Recording Warnings Again" });
    check("with both off, Settings offers the warnings again", (await btn.count()) === 1 && (await warnStored(o.page)) === OFF && (await noticeStored(o.page)) === OFF);
    await btn.click();
    check("  and one press turns both back on", (await btn.count()) === 0 && (await warnStored(o.page)) === ON && (await noticeStored(o.page)) === ON, `${await warnStored(o.page)} / ${await noticeStored(o.page)}`);
    check("  no page errors", o.errors.length === 0, o.errors.slice(0, 2).join(" | "));
    await o.ctx.close();
  }
}

for (const [name, opts, line] of [
  ["a line of two", { max: 2 }, /This recording uses one of the 2 streams your line allows, for as long as it runs\./],
  ["a panel that reports no limit", { max: "none" }, /This recording uses one of your provider’s streams for as long as it runs\./],
]) {
  const { ctx, page, errors } = await open(opts);
  await toTheater(page);
  if (opts.max === "none") {
    // The panel has answered, with no limit in it: that is the path under test,
    // not a panel that has not answered yet.
    await page.waitForFunction(() => (window.__answered ?? 0) >= 1, null, { timeout: 15_000 });
    await sleep(300);
    check(`${name}: the panel answered and the sidebar has no pill for it`, (await page.locator(".live-conns").count()) === 0);
  } else await readingIn(page);
  await wake(page);
  await recButton(page).click();
  await dialog(page).waitFor({ timeout: 5000 });
  const words = await dialog(page).innerText();
  check(`${name}: Record says it uses a connection`, NOTICE_TITLE.test(words) && line.test(words), words.replace(/\n/g, " | "));
  check("  and has started nothing yet", (await calls(page, "rec_start")).length === 0 && (await calls(page, "rec_buffer_start")).length === 0);
  await dialog(page).getByRole("button", { name: "Start Recording" }).click();
  await page.waitForFunction(RUNNING);
  check("  then Start Recording opens a stream of its own, with no buffer recording", (await calls(page, "rec_start")).length === 1 && (await calls(page, "rec_buffer_start")).length === 0);
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ====================== the counts follow a recording, and Install waits for it
{
  const { ctx, page, errors } = await open({ max: 3, pending: "9.9.9", query: "?update=9.9.9", seed: NO_HEADS_UP });
  await toTheater(page);
  await readingIn(page);
  // The tune's own look at the panel (4s after it) comes first; the recording
  // is started after it, and finished with before its 20s look, so every look
  // in the windows below is the recording's.
  await page.waitForFunction(() => Date.now() - window.__tuneAt >= 6000, null, { timeout: 15_000 });
  const pill = () => page.locator(".live-conns").first().getAttribute("aria-label");
  check("before a recording the pill reads 0 of 3", (await pill()) === "0 of 3 streams in use", String(await pill()));

  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
  const started = Date.now();
  await page.waitForFunction((t) => window.__pollAt.some((p) => p > t + 3000), started, { timeout: 9000 }).catch(() => {});
  const afterStart = await page.evaluate((t) => window.__pollAt.filter((p) => p > t), started);
  check("starting a recording asks the panel again, after the post-tune delay", afterStart.length >= 1 && afterStart[0] - started >= 3000 && afterStart[0] - started < 9000, JSON.stringify(afterStart.map((p) => p - started)));
  await page.waitForFunction(() => document.querySelector(".live-conns")?.getAttribute("aria-label") === "1 of 3 streams in use", null, { timeout: 5000 }).catch(() => {});
  check("  so the sidebar’s pill catches up: 1 of 3", (await pill()) === "1 of 3 streams in use", String(await pill()));

  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Record");
  const stopped = Date.now();
  await page.waitForFunction((t) => window.__pollAt.some((p) => p > t + 3000), stopped, { timeout: 9000 }).catch(() => {});
  const afterStop = await page.evaluate((t) => window.__pollAt.filter((p) => p > t), stopped);
  check("stopping it asks again too", afterStop.length >= 1 && afterStop[0] - stopped >= 3000 && afterStop[0] - stopped < 9000, JSON.stringify(afterStop.map((p) => p - stopped)));
  await page.waitForFunction(() => document.querySelector(".live-conns")?.getAttribute("aria-label") === "0 of 3 streams in use", null, { timeout: 5000 }).catch(() => {});
  check("  and the pill reads 0 of 3 again", (await pill()) === "0 of 3 streams in use", String(await pill()));

  // Install and Restart: held while one runs, with no player open.
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
  await closePlayer(page);
  const chip = page.locator(".update-chip");
  await chip.waitFor({ timeout: 5000 });
  const tip = async (el) => {
    await page.mouse.move(5, 5);
    await el.hover();
    await page.locator("[role=tooltip]").first().waitFor({ timeout: 3000 });
    return (await page.locator("[role=tooltip]").first().innerText()).trim();
  };
  check("with a recording running and no player, the update chip says to stop recording", (await tip(chip)) === "Stop recording first. Then install.", await tip(chip));
  await chip.click();
  await sleep(300);
  check("  and pressing it installs nothing", (await calls(page, "install_update")).length === 0 && /Ready/.test(await chip.innerText()));

  await page.locator('.header__right [aria-label="Settings"]').click();
  await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "App", exact: true }).click();
  const restart = page.getByRole("button", { name: "Restart Now" });
  await restart.waitFor({ timeout: 5000 });
  check("Settings → App → Restart Now is held, and says why", (await restart.getAttribute("aria-disabled")) === "true" && (await tip(restart)) === "Stop recording first. It applies on its own next launch.", await tip(restart));
  await restart.click({ force: true }); // grey by aria-disabled, which Playwright reads as not enabled
  await sleep(300);
  check("  and pressing it restarts nothing", (await calls(page, "frontend_apply")).length === 0);
  // Ended behind the open page: the button lets go without a reload.
  await put(page, { ...(await page.evaluate(() => window.__native.recs.find((r) => r.status === "recording"))), status: "done", endedAt: Date.now(), bytes: 2048 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Restart Now")?.getAttribute("aria-disabled") === "false", null, { timeout: 5000 });
  await restart.click();
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "frontend_apply"), null, { timeout: 5000 });
  check("when the recording ends, Restart Now goes ahead", (await calls(page, "frontend_apply")).length === 1);

  // The file it made is still being worked on (plan 029, Phase 4): native is shrinking it, and a
  // restart would throw that away. Held the same way, and let go when the job ends.
  const jobOf = (o) => ({ id: "j1", channel: "Fake News", programme: null, playlistId: "t", startedAt: 1000, endedAt: 2000, path: "C:\\Videos\\j1.mkv", bytes: 4096, status: "done", reason: null, buffer: false, job: null, progress: null, jobReason: null, saved: 0, ...o });
  // A hint that never shows is a failed check, not a crash.
  const tipOrNone = (el) => tip(el).catch(() => null);
  const isHeld = () => page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Restart Now")?.getAttribute("aria-disabled"));
  await put(page, jobOf({ job: "shrink", progress: 0.3 }));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Restart Now")?.getAttribute("aria-disabled") === "true", null, { timeout: 5000 }).catch(() => {});
  check("a shrink under way holds Restart Now, and says to wait", (await tipOrNone(restart)) === "Wait for recordings to finish first. It applies on its own next launch.");
  await restart.click({ force: true });
  await sleep(300);
  check("  and pressing it restarts nothing", (await calls(page, "frontend_apply")).length === 1);
  await put(page, jobOf({ job: null, saved: 1024 }));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Restart Now")?.getAttribute("aria-disabled") === "false", null, { timeout: 5000 }).catch(() => {});
  check("when the job ends, Restart Now is let go with no reload", (await isHeld()) === "false");
  await put(page, jobOf({ job: "shrink", progress: null, saved: 0 }));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Restart Now")?.getAttribute("aria-disabled") === "true", null, { timeout: 5000 }).catch(() => {});
  check("a job still waiting its turn holds it too", (await isHeld()) === "true");
  await put(page, jobOf({ job: null }));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Restart Now")?.getAttribute("aria-disabled") === "false", null, { timeout: 5000 }).catch(() => {});

  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 });
  await put(page, jobOf({ job: "remux", progress: null }));
  check("the update chip says to wait while a repackaging is queued", (await tipOrNone(chip)) === "Wait for recordings to finish first. Then install.");
  await chip.click();
  await sleep(300);
  check("  and pressing it installs nothing", (await calls(page, "install_update")).length === 0);
  await put(page, jobOf({ job: null }));
  await sleep(300);
  check("  and the chip’s words are the usual ones again", (await tip(chip)) === "Download and Restart into the New Version", await tip(chip));
  await chip.click();
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "install_update"), null, { timeout: 5000 });
  check("  and it installs", (await calls(page, "install_update")).length === 1);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ============================================================== Multi-View
/** Multi-View with a stream recording running on the line, once the panel's
 * count has had time to settle (the second look is 20s after the tab opens),
 * and what the meter and the picker say. */
async function multiviewWith({ extra }) {
  const { ctx, page, errors } = await open({ max: 3, extra, seed: NO_HEADS_UP });
  await toTheater(page);
  await readingIn(page);
  await wake(page);
  await recButton(page).click();
  await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
  await closePlayer(page);
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  const meter = page.locator(".mvmeter");
  await meter.waitFor({ timeout: 10_000 });
  const opened = Date.now();
  // The count settles on the look 20s in; until then nothing is "elsewhere".
  await page.waitForFunction((t) => window.__pollAt.filter((p) => p > t + 19_000).length > 0, opened, { timeout: 30_000 });
  await sleep(500);
  const text = await meter.getAttribute("aria-label");
  // A recording on ANOTHER line says nothing about this one's count: it leaves
  // the settled Elsewhere where it is.
  await page.evaluate(() =>
    window.__put({
      id: "other1", channel: "Elsewhere News", programme: null, playlistId: "other", startedAt: Date.now(),
      endedAt: null, path: "C:\\Videos\\o.ts", bytes: 0, status: "recording", reason: null, buffer: false,
    }),
  );
  await sleep(700);
  const after = await meter.getAttribute("aria-label");
  await page.keyboard.press("a");
  const footer = page.locator(".mvpick__room");
  await footer.waitFor({ timeout: 5000 });
  const room = (await footer.innerText()).trim();
  const errs = errors.slice();
  await ctx.close();
  return { text, after, room, errs };
}
{
  const a = await multiviewWith({ extra: 0 });
  check("Multi-View, a recording running on the line: the meter counts it as one in use", a.text === "1 of 3 Streams in Use", a.text);
  check("  and the settled count does not call it Elsewhere", !/Elsewhere/.test(a.text), a.text);
  check("  and the picker offers one tile fewer: 2 of the 3", a.room === "2 more fit on your line.", a.room);
  const b = await multiviewWith({ extra: 1 });
  check("another device’s stream still reads as Elsewhere, beside the recording", b.text === "2 of 3 Streams in Use · 1 Elsewhere", b.text);
  check("  and takes its slot too: 1 more fits", b.room === "1 more fits on your line.", b.room);
  check("a recording on another line leaves Elsewhere showing", b.after === b.text && /1 Elsewhere/.test(b.after), `${b.text} -> ${b.after}`);
  check("no page errors", a.errs.length === 0 && b.errs.length === 0, [...a.errs, ...b.errs].slice(0, 2).join(" | "));
}

await browser.close();
process.exit(fail ? 1 : 0);
