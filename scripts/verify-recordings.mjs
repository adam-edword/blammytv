// E2E: recording live TV (plan 029, batch B), the page's half, with the
// native side (rec.rs) stubbed at the IPC boundary.
//
// What it holds: the Record button in the theater (busy, Stop Recording with
// the time, a refusal's reason beside it), a recording that outlives a channel
// switch, the Guide's dot, the Recordings mode in Live TV with every status and
// its reason, `rec-update` events moving a row without a reload, Play handing
// native a real rect, Delete asking first, Library's section landing in Live TV
// Recordings, and Settings → Playback → Recordings Folder reaching `rec_start`.
// Phase 4: a finished recording's job (`job`, `progress`, `jobReason`, `saved`)
// as the row says it: waiting, under way with a percent, what it saved, why one
// was kept as it was; never the file's type; both lists; progress without a
// second rec_list.
//
// HOW. verify-live-idle's stub (isTauri() is true, the real player path runs),
// plus the rec_* commands over a small in-page model of native's index, and
// `rec-update` sent the way Tauri sends it: through the handler `listen`
// registered with plugin:event|listen. Every call is logged in __calls, so
// "stop was never asked" is a look at the whole run.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-recordings.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Offline: the fake panel and the app are all this talks to.
await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const stub = () => {
  window.__calls = [];
  window.__native = { recs: [], n: 0 };
  // What the next rec_start does: "ok", or a reason to refuse with. `gate`
  // holds it until the harness lets go, so the busy state can be looked at.
  window.__start = { refuse: null, gate: null };
  window.__pick = null;
  window.__presenting = false;
  const listeners = {};
  let cb = 0;
  const emit = (rec) => {
    for (const h of listeners["rec-update"] ?? []) window["_" + h]({ event: "rec-update", id: 0, payload: rec });
  };
  window.__emit = emit;
  /** native's index: change a record and tell the page, as rec.rs does. */
  const put = (rec) => {
    const i = window.__native.recs.findIndex((r) => r.id === rec.id);
    if (i < 0) window.__native.recs.push(rec);
    else window.__native.recs[i] = rec;
    emit(rec);
    return rec;
  };
  window.__put = put;
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
        return Promise.resolve([...window.__native.recs].sort((a, b) => b.startedAt - a.startedAt));
      if (cmd === "rec_start") {
        const make = () => {
          if (window.__start.refuse) return Promise.reject(window.__start.refuse);
          const id = "r" + ++window.__native.n;
          put({
            id, channel: args.channel, programme: args.programme ?? null, playlistId: args.playlistId,
            startedAt: Date.now(), endedAt: null, path: `C:\\Videos\\${id}.ts`, bytes: 0,
            status: "recording", reason: null,
          });
          return Promise.resolve(id);
        };
        return window.__start.gate ? window.__start.gate.then(make) : make();
      }
      if (cmd === "rec_stop") {
        const r = window.__native.recs.find((x) => x.id === args.id);
        return Promise.resolve(put({ ...r, status: "done", endedAt: Date.now(), bytes: r.bytes || 1024 }));
      }
      if (cmd === "rec_delete") {
        const r = window.__native.recs.find((x) => x.id === args.id);
        if (r?.status === "recording") return Promise.reject("stop the recording first");
        if (args.id === "locked") return Promise.reject("the file is in use or read-only");
        window.__native.recs = window.__native.recs.filter((x) => x.id !== args.id);
        return Promise.resolve(undefined);
      }
      if (cmd === "rec_default_folder") return Promise.resolve("C:\\Users\\sam\\Videos\\BlammyTV");
      if (cmd === "rec_pick_folder") return Promise.resolve(window.__pick);
      return Promise.resolve(undefined);
    },
  };
  // What @tauri-apps/api's unlisten reaches for; absent, an unmount throws.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [
        { kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" },
      ],
    }),
  );
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
  // Record's heads-up (D5) is verify-recconns' subject: here it is off, as after its Don't Show Again.
  localStorage.setItem("blammytv.recordingNotice", JSON.stringify({ v: 1, data: false }));
};
await page.addInitScript(stub);

const calls = (cmd) => page.evaluate((c) => window.__calls.filter((x) => x[0] === c).map((x) => x[1]), cmd);
const put = (rec) => page.evaluate((r) => window.__put(r), rec);
const base = (o) => ({
  programme: null, playlistId: "t", endedAt: null, path: "C:\\Videos\\x.ts", bytes: 0,
  status: "done", reason: null, ...o,
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });

const modeTab = (name) => page.locator(`.live-sidebar [role=tab][aria-label="${name}"]`);
const card = (name) => page.locator(`.guide__row:has(.guide__card[aria-label^="${name}"]) .guide__card`);
/** The theater's chrome hides when idle and takes no clicks; a move wakes it. */
const wake = async () => {
  await page.mouse.move(700, 300);
  await page.mouse.move(720, 330);
};
const backOut = async () => {
  await wake();
  await page.locator(".theater-topleft button[aria-label=Back]").click();
};
const recButton = () => page.locator('.theater-controls .rec-btn button');

// ---------------------------------------------------------------- empty
await modeTab("Recordings").click();
await page.locator(".guide-empty").waitFor({ timeout: 5000 });
const empty = await page.locator(".guide-empty").innerText();
check(
  "Recordings mode with none says what to do next",
  /No Recordings Yet/.test(empty) && /Press Record while you watch a channel/.test(empty),
  empty.replace(/\n/g, " | "),
);
check("  and there is no Guide under it", (await page.locator(".guide").count()) === 0);
await modeTab("Playlist").click();
await page.locator(".guide__channel").first().waitFor({ timeout: 5000 });

// ----------------------------------------------------- Record in the player
const ESPN = "Fake ESPN";
const SKY = "Fake Sky Sports";
await card(ESPN).click();
await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
await page.evaluate(() => (window.__presenting = true));
await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
check("the mini player has no Record button (the theater's controls hold it)", (await page.locator(".mini-overlay .rec-btn").count()) === 0);
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
await recButton().waitFor({ timeout: 5000 });
check("in the theater, a live channel has Record", (await recButton().getAttribute("aria-label")) === "Record");

// Held at native, so the busy state can be looked at.
await page.evaluate(() => {
  window.__gate = (() => {
    let open;
    const p = new Promise((r) => (open = r));
    window.__open = open;
    return p;
  })();
  window.__start.gate = window.__gate;
});
await wake();
await recButton().click();
await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-busy") === "true");
check(
  "pressing it shows a busy state while native waits for bytes",
  (await recButton().getAttribute("aria-label")) === "Starting Recording…" && (await recButton().getAttribute("aria-disabled")) === "true",
);
await wake();
await recButton().click({ force: true }); // a second press while busy is nothing
await page.evaluate(() => {
  window.__start.gate = null;
  window.__open();
});
await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
const starts = await calls("rec_start");
check("  and only one rec_start went", starts.length === 1, String(starts.length));
const a = starts[0] ?? {};
check(
  "  with the channel's link, name, playlist and the programme on now",
  /\/live\/u\/p\/101\.ts$/.test(a.url ?? "") && a.channel === "Fake ESPN 4K" && a.playlistId === "t" && /^ESPN Hour \d+$/.test(a.programme ?? ""),
  JSON.stringify(a),
);
check("  no folder chosen yet, so none sent (native uses its default)", a.folder == null, JSON.stringify(a.folder));
check("  no User-Agent, as the playlist has none", !("userAgent" in a));
const t0 = await page.locator(".rec-btn__time").innerText();
check("now it is Stop Recording, with a red dot and the time", /^\d+:\d\d$/.test(t0) && (await page.locator(".rec-btn .rec-dot").count()) === 1, t0);
await page.waitForTimeout(2300);
const t1 = await page.locator(".rec-btn__time").innerText();
const secs = (s) => s.split(":").reduce((n, p) => n * 60 + Number(p), 0);
check("  and the time counts", secs(t1) >= secs(t0) + 2, `${t0} -> ${t1}`);

// A second channel whose link native refuses.
await backOut();
await page.locator(".mini-overlay").waitFor({ timeout: 5000 });
const dotAt = (name) => card(name).locator(".guide__rec").count();
check("the Guide puts a dot on the recording channel", (await dotAt(ESPN)) === 1);
check("  and on no other", (await page.locator(".guide__rec").count()) === 1);
await card(SKY).click();
await page.locator(".mini-overlay").waitFor();
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await recButton().waitFor();
check("switching channel did not stop the recording: no rec_stop was asked", (await calls("rec_stop")).length === 0);
check("  and it is still recording, in native's index", await page.evaluate(() => window.__native.recs[0].status === "recording"));
check("  and the new channel starts at Record, not Stop Recording", (await recButton().getAttribute("aria-label")) === "Record");
await page.evaluate(() => (window.__start.refuse = "ex.example refused the stream (403)"));
await wake();
await recButton().click();
await page.locator(".rec-btn__why").waitFor({ timeout: 5000 });
const why = await page.locator(".rec-btn__why").innerText();
check("a refusal's reason sits next to the button, as a sentence", why === "Couldn’t record: ex.example refused the stream (403).", why);
check("  the button is back to Record", (await recButton().getAttribute("aria-label")) === "Record");
check("  and the Guide shows no dot for it", (await page.locator(".guide__rec").count()) === 1);

// A folder or disk problem says how to fix it.
await page.evaluate(() => (window.__start.refuse = "not enough free disk space (recording needs 2 GB)"));
await wake();
await recButton().click();
await page.waitForFunction(() => /Pick another folder/.test(document.querySelector(".rec-btn__why")?.textContent ?? ""));
check("a full disk says where to go", /Settings → Playback\.$/.test(await page.locator(".rec-btn__why").innerText()));

// Back to a working link: the reason clears and it records.
await page.evaluate(() => (window.__start.refuse = null));
await wake();
await recButton().click();
await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
check("pressing again clears the reason and records", (await page.locator(".rec-btn__why").count()) === 0);
check("two channels, two recordings, both in the index", await page.evaluate(() => window.__native.recs.filter((r) => r.status === "recording").length === 2));

// Back to ESPN: still recording, the button knows.
await backOut();
await page.locator(".mini-overlay").waitFor();
check("the Guide has a dot on both", (await page.locator(".guide__rec").count()) === 2);
await card(ESPN).click();
await page.locator(".mini-overlay").waitFor();
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await recButton().waitFor();
await page.waitForFunction(() => document.querySelector(".theater-controls .rec-btn button")?.getAttribute("aria-label") === "Stop Recording");
const t2 = await page.locator(".rec-btn__time").innerText();
check("coming back to the channel shows Stop Recording and how long it has run", secs(t2) >= secs(t1), `${t1} -> ${t2}`);

// Closing the player does not end it.
await backOut();
await page.locator(".mini-overlay").waitFor();
await page.locator('.mini-overlay [aria-label="Stop"]').click();
await page.locator(".mini-overlay").waitFor({ state: "detached" });
check("closing the player does not stop a recording", (await calls("rec_stop")).length === 0 && (await page.locator(".guide__rec").count()) === 2);

// ------------------------------------------------------- the Recordings list
// Others the index already holds, told to the page by events.
const hour = 3600_000;
const now = Date.now();
await put(base({ id: "d1", channel: "Fake News Channel", programme: "Evening News", startedAt: now - 5 * hour, endedAt: now - 5 * hour + 3_723_000, bytes: 1.5 * 1024 ** 3, path: "C:\\Videos\\d1.ts" }));
await put(base({ id: "p1", channel: "Fake ESPN 4K", startedAt: now - 3 * hour, endedAt: now - 3 * hour + 600_000, bytes: 80 * 1024 ** 2, status: "partial", reason: "stream lost" }));
await put(base({ id: "f1", channel: "Fake Sky Sports FHD", startedAt: now - 2 * hour, endedAt: now - 2 * hour + 30_000, bytes: 0, status: "failed", reason: "no data from the stream for 20 seconds" }));
await put(base({ id: "locked", channel: "Fake News Channel", programme: "Locked Film", startedAt: now - 9 * hour, endedAt: now - 9 * hour + 60_000, bytes: 5 * 1024 ** 2 }));
await modeTab("Recordings").click();
await page.locator(".rec-row").first().waitFor({ timeout: 5000 });
const ids = await page.locator(".rec-row").evaluateAll((els) => els.map((e) => e.dataset.id));
check("the list is newest first", ids.join() === ["r2", "r1", "f1", "p1", "d1", "locked"].join(), ids.join());
const rows = Object.fromEntries((await page.locator(".rec-row").evaluateAll((els) => els.map((e) => [e.dataset.id, e.innerText.replace(/\n+/g, " | ")]))));
check("a recording of a programme leads with the programme, then the channel", /^Evening News \| Fake News Channel · / .test(rows.d1), rows.d1);
check("  and one without leads with the channel", /^Fake ESPN 4K \| /.test(rows.p1) && !/ · .* · .* · /.test(rows.p1), rows.p1);
check("  with how long and how big", /1:02:03/.test(rows.d1) && /1\.5 GB/.test(rows.d1), rows.d1);
check("Done reads Done", /Done/.test(rows.d1) && !/Partial|Failed|Recording/.test(rows.d1), rows.d1);
check("Partial says Partial and why", /Partial/.test(rows.p1) && /Stream lost\./.test(rows.p1) && /10:00/.test(rows.p1) && /80 MB/.test(rows.p1), rows.p1);
check("Failed says Failed and why", /Failed/.test(rows.f1) && /No data from the stream for 20 seconds\./.test(rows.f1), rows.f1);
check("a running one says Recording, with its dot", /Recording/.test(rows.r1 ?? "") && (await page.locator('.rec-row[data-id="r1"] .rec-dot').count()) === 1, rows.r1);

// An event moves a row without a reload.
const before = await page.locator('.rec-row[data-id="r1"]').innerText();
await put({ ...(await page.evaluate(() => window.__native.recs.find((r) => r.id === "r1"))), bytes: 25 * 1024 ** 2 });
await page.waitForFunction(() => /25 MB/.test(document.querySelector('.rec-row[data-id="r1"]')?.innerText ?? ""));
check("a rec-update changes the size in place", !/25 MB/.test(before) && /25 MB/.test(await page.locator('.rec-row[data-id="r1"]').innerText()));
await put({ ...(await page.evaluate(() => window.__native.recs.find((r) => r.id === "p1"))), status: "done", reason: null });
await page.waitForFunction(() => !/Partial/.test(document.querySelector('.rec-row[data-id="p1"]')?.innerText ?? ""));
check("  and the status, taking its reason away", /Done/.test(await page.locator('.rec-row[data-id="p1"]').innerText()) && !/Stream lost/.test(await page.locator('.rec-row[data-id="p1"]').innerText()));
check("  without asking native again (one rec_list, at the start)", (await calls("rec_list")).length === 1, String((await calls("rec_list")).length));

// A running one offers Stop Recording, not Delete.
const runningBtns = await page.locator('.rec-row[data-id="r1"] button').allInnerTexts();
check("a running recording offers Stop Recording and Show in Folder, and no Delete or Play", runningBtns.join() === "Stop Recording,Show in Folder", runningBtns.join());
const doneBtns = await page.locator('.rec-row[data-id="d1"] button').allInnerTexts();
check("a finished one offers Play, Show in Folder and Delete", doneBtns.join() === "Play,Show in Folder,Delete", doneBtns.join());
await page.locator('.rec-row[data-id="d1"] button', { hasText: "Show in Folder" }).click();
check("Show in Folder asks native by id", JSON.stringify(await calls("rec_show")) === JSON.stringify([{ id: "d1" }]));

// Delete: asks first, never while it records.
await page.locator('.rec-row[data-id="d1"] button', { hasText: "Delete" }).click();
check("Delete asks to be pressed again, and has not deleted", (await calls("rec_delete")).length === 0 && /Click Again to Confirm/.test(await page.locator('.rec-row[data-id="d1"]').innerText()));
await page.locator('.rec-row[data-id="d1"] button', { hasText: "Click Again to Confirm" }).click();
await page.locator('.rec-row[data-id="d1"]').waitFor({ state: "detached", timeout: 5000 });
check("  the second press deletes it", JSON.stringify(await calls("rec_delete")) === JSON.stringify([{ id: "d1" }]));
await page.locator('.rec-row[data-id="locked"] button', { hasText: "Delete" }).click();
await page.locator('.rec-row[data-id="locked"] button', { hasText: "Click Again to Confirm" }).click();
await page.locator('.rec-row[data-id="locked"] [role=alert]').waitFor({ timeout: 5000 });
check(
  "a delete native refuses says why, on its row, and keeps the row",
  (await page.locator('.rec-row[data-id="locked"] [role=alert]').innerText()) === "Couldn’t delete: the file is in use or read-only.",
);

// Stop Recording from the list.
await page.locator('.rec-row[data-id="r2"] button', { hasText: "Stop Recording" }).click();
await page.waitForFunction(() => /Done/.test(document.querySelector('.rec-row[data-id="r2"]')?.innerText ?? ""));
check("Stop Recording in the list ends it (rec_stop by id) and the row reads Done", JSON.stringify(await calls("rec_stop")) === JSON.stringify([{ id: "r2" }]));


// ------------------------------------------------ a finished recording's job (Phase 4)
// Native repackages every recording into .mkv, and with Smaller Files shrinks it
// after. The row says where that stands; the file's type is not the person's concern.
const jobRec = (o) => base({ channel: "Fake News Channel", endedAt: o.startedAt + 600_000, bytes: 100 * 1024 ** 2, path: "C:\\Videos\\j.mkv", jobReason: null, saved: 0, ...o });
await put(jobRec({ id: "jw", startedAt: now - 20 * hour, job: "remux", progress: null }));
await put(jobRec({ id: "jr", startedAt: now - 21 * hour, job: "remux", progress: 0.4 }));
await put(jobRec({ id: "sw", startedAt: now - 22 * hour, job: "shrink", progress: null }));
await put(jobRec({ id: "sr", startedAt: now - 23 * hour, job: "shrink", progress: 0.7 }));
await put(jobRec({ id: "sv", startedAt: now - 24 * hour, job: null, progress: null, saved: 1.2 * 1024 ** 3, bytes: 900 * 1024 ** 2 }));
await put(jobRec({ id: "kp", startedAt: now - 25 * hour, job: null, progress: null, jobReason: "it didn't get any smaller" }));
await put(jobRec({ id: "ps", startedAt: now - 26 * hour, status: "partial", reason: "stream lost", job: null, progress: null, jobReason: "not enough free disk space" }));
const jobRows = async () =>
  Object.fromEntries(await page.locator(".rec-row").evaluateAll((els) => els.map((e) => [e.dataset.id, e.innerText.replace(/\n+/g, " | ")])));
let jr = await jobRows();
const listCallsBefore = (await calls("rec_list")).length;
check("a repackaging that waits its turn says Waiting to Finish", /Waiting to Finish/.test(jr.jw) && !/Finishing|Shrinking/.test(jr.jw), jr.jw);
check("a repackaging under way says Finishing with its percent", /Finishing 40%/.test(jr.jr) && !/Waiting/.test(jr.jr), jr.jr);
check("a shrink that waits its turn says Waiting to Shrink", /Waiting to Shrink/.test(jr.sw), jr.sw);
check("a shrink under way says Shrinking with its percent", /Shrinking 70%/.test(jr.sr) && !/Waiting/.test(jr.sr), jr.sr);
check("a job takes the status slot, so the row never says Done over it", ["jw", "jr", "sw", "sr"].every((id) => !/Done/.test(jr[id])), JSON.stringify([jr.jw, jr.sr]));
check("  and keeps its length and size beside it", / 10:00 /.test(jr.sr) && /100 MB/.test(jr.sr), jr.sr);
check("one with the shrink behind it says Done and what it saved", /Done/.test(jr.sv) && /Saved 1\.2 GB/.test(jr.sv) && /900 MB/.test(jr.sv) && !/Waiting|Shrinking|Finishing/.test(jr.sv), jr.sv);
check("why a job was given up is the row's note, as a sentence", /It didn't get any smaller\./.test(jr.kp) && /Done/.test(jr.kp), jr.kp);
check("  next to the recording's own reason when it has one", /Partial/.test(jr.ps) && /Stream lost\./.test(jr.ps) && /Not enough free disk space\./.test(jr.ps), jr.ps);
check("a row with no job and nothing saved says none of this", ["p1", "f1", "locked"].every((id) => jr[id] !== undefined && !/Waiting|Finishing|Shrinking|Saved/.test(jr[id])), JSON.stringify([jr.p1, jr.f1]));
check("no row names the file's type", Object.values(jr).every((t) => !/\.(mkv|ts)\b/i.test(t)), Object.values(jr).find((t) => /\.(mkv|ts)\b/i.test(t)));
const jobBtns = await page.locator('.rec-row[data-id="sr"] button').allInnerTexts();
check("a row with a job still offers Play, Show in Folder and Delete", jobBtns.join() === "Play,Show in Folder,Delete", jobBtns.join());

// Progress arrives as events: the row moves, and native is not asked for the list again.
await put(jobRec({ id: "sr", startedAt: now - 23 * hour, job: "shrink", progress: 0.9 }));
await page.waitForFunction(() => /Shrinking 90%/.test(document.querySelector('.rec-row[data-id="sr"]')?.innerText ?? ""));
await put(jobRec({ id: "jw", startedAt: now - 20 * hour, job: "remux", progress: 0 }));
await page.waitForFunction(() => /Finishing 0%/.test(document.querySelector('.rec-row[data-id="jw"]')?.innerText ?? ""));
const moved = await page.locator('.rec-row[data-id="sr"]').innerText();
check("a rec-update moves a job's percent in place, and a waiting one starts at 0%", /Shrinking 90%/.test(moved) && !/70%/.test(moved) && /Finishing 0%/.test(await page.locator('.rec-row[data-id="jw"]').innerText()), moved.replace(/\n+/g, " | "));
check("  without a second rec_list", (await calls("rec_list")).length === listCallsBefore, String((await calls("rec_list")).length - listCallsBefore));
// Remux done with Smaller Files on: it goes straight to waiting for the shrink, then runs, then done.
await put(jobRec({ id: "jw", startedAt: now - 20 * hour, job: "shrink", progress: null, saved: 40 * 1024 ** 2 }));
await page.waitForFunction(() => /Waiting to Shrink/.test(document.querySelector('.rec-row[data-id="jw"]')?.innerText ?? ""), null, { timeout: 3000 }).catch(() => {});
const handed = await page.locator('.rec-row[data-id="jw"]').innerText();
check("a repackaging that hands on to a shrink reads Waiting to Shrink, not what it saved so far", /Waiting to Shrink/.test(handed) && !/Saved/.test(handed), handed.replace(/\n+/g, " | "));
await put(jobRec({ id: "jw", startedAt: now - 20 * hour, job: null, progress: null, saved: 700 * 1024 ** 2, bytes: 60 * 1024 ** 2 }));
await page.waitForFunction(() => /Saved 700 MB/.test(document.querySelector('.rec-row[data-id="jw"]')?.innerText ?? ""));
const done = await page.locator('.rec-row[data-id="jw"]').innerText();
check("  and when the shrink ends the row says Done and Saved 700 MB, with the new size", /Done · 10:00 · 60 MB/.test(done) && !/Shrinking|Waiting/.test(done), done.replace(/\n+/g, " | "));
// A job that failed: no longer busy, and the reason arrives with the event.
await put(jobRec({ id: "sr", startedAt: now - 23 * hour, job: null, progress: null, jobReason: "the new file has errors the original doesn't" }));
await page.waitForFunction(() => /The new file has errors the original doesn't\./.test(document.querySelector('.rec-row[data-id="sr"]')?.innerText ?? ""));
check("a shrink given up says why and stops saying Shrinking", !/Shrinking|Waiting/.test(await page.locator('.rec-row[data-id="sr"]').innerText()));

// ------------------------------------------------------------------- Play
const opensBefore = (await calls("inv_open")).length;
await page.locator('.rec-row[data-id="p1"] button', { hasText: "Play" }).click();
await page.waitForFunction(() => window.__calls.some((c) => c[0] === "rec_play"), null, { timeout: 8000 });
const play = (await calls("rec_play"))[0];
check("Play asks native for that recording by id, with the player's rect", play?.id === "p1" && play.w > 0 && play.h > 0 && play.x >= 0 && play.y >= 0, JSON.stringify(play));
check("  through rec_play, not inv_open", (await calls("inv_open")).length === opensBefore);
check("  and the row is marked as playing", (await page.locator('.rec-row[data-id="p1"]').getAttribute("aria-current")) === "true");
check("  the hero says what it is", /Fake ESPN 4K/.test(await page.locator(".hero__details").innerText()));
await page.evaluate(() => (window.__dur = 600));
await page.locator(".mini-overlay").waitFor();
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await page.locator(".theater-overlay").waitFor();
check("a recording plays with a film's scrubber", (await page.locator(".theater-seek__track--vod").count()) === 1);
check("  and not a channel's: no Record, no Pop Out, no Sources, no Jump to Live",
  (await page.locator('[aria-label="Record"], [aria-label="Stop Recording"], [aria-label="Pop Out"], [aria-label="Sources"], [aria-label="Jump to Live"]').count()) === 0);
await backOut();
await page.locator(".mini-overlay").waitFor();

// Choosing a channel goes back to live, and lets the recording go.
await modeTab("Playlist").click();
check("the Guide's dot went with the recording that ended, and stayed on the one still running", (await dotAt(SKY)) === 0 && (await dotAt(ESPN)) === 1);
await card("Fake News").click();
await page.locator(".mini-overlay").waitFor();
await page.waitForFunction((n) => window.__calls.filter((c) => c[0] === "inv_open").length > n, opensBefore);
check("choosing a channel plays it live again (inv_open)", (await calls("inv_open")).length > opensBefore);

// ---------------------------------------------------------------- Settings
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await page.locator(".theater-overlay").waitFor();
await backOut();
await page.locator('.mini-overlay [aria-label="Stop"]').click();
await page.locator(".mini-overlay").waitFor({ state: "detached" });
await page.locator('.header__right [aria-label="Settings"]').click();
await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Playback", exact: true }).click();
const rowEl = page.locator("[data-setting='recordings-folder']");
await rowEl.waitFor({ timeout: 5000 });
await page.waitForFunction(() => /BlammyTV/.test(document.querySelector("[data-setting='recordings-folder']")?.innerText ?? ""));
const rowText = await rowEl.innerText();
check("Settings → Playback → Recordings Folder shows the default folder", /Recordings Folder/.test(rowText) && /C:\\Users\\sam\\Videos\\BlammyTV/.test(rowText), rowText.replace(/\n/g, " | "));
await page.evaluate(() => (window.__pick = null));
await rowEl.getByRole("button", { name: "Change…" }).click();
await page.waitForTimeout(300);
check("  a dismissed picker changes nothing", /BlammyTV/.test(await rowEl.innerText()) && (await page.evaluate(() => localStorage.getItem("blammytv.recordingsFolder"))) === null);
await page.evaluate(() => (window.__pick = "D:\\TV"));
await rowEl.getByRole("button", { name: "Change…" }).click();
await page.waitForFunction(() => /D:\\TV/.test(document.querySelector("[data-setting='recordings-folder']")?.innerText ?? ""));
const pickCall = (await calls("rec_pick_folder")).at(-1);
check("  Change… opens the picker where the folder is now", pickCall?.current === "C:\\Users\\sam\\Videos\\BlammyTV", JSON.stringify(pickCall));
check("  and keeps the one picked, stored like the other settings", (await page.evaluate(() => localStorage.getItem("blammytv.recordingsFolder"))) === JSON.stringify({ v: 1, data: "D:\\TV" }));
await page.keyboard.press("Escape");
await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 });

await card("Fake News").click();
await page.locator(".mini-overlay").waitFor();
await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
await recButton().waitFor();
await wake();
await recButton().click();
await page.waitForFunction(() => window.__calls.filter((c) => c[0] === "rec_start").length >= 4);
const last = (await calls("rec_start")).at(-1);
check("the next rec_start carries the folder", last?.folder === "D:\\TV" && last.channel === "Fake News Channel", JSON.stringify(last));
await backOut();
await page.locator('.mini-overlay [aria-label="Stop"]').click();

// ----------------------------------------------------------------- Library
await goTo(page, "mylist");
await page.locator(".library__recordings .rec-row").first().waitFor({ timeout: 5000 });
const libIds = await page.locator(".library__recordings .rec-row").evaluateAll((els) => els.map((e) => e.dataset.id));
const live = await page.evaluate(() => window.__native.recs.map((r) => r.id));
check("Library has a Recordings section with the same items", /Recordings/.test(await page.locator(".library__recordings h3").innerText()) && [...libIds].sort().join() === [...live].sort().join(), `${libIds} vs ${live}`);
check("  a finished one offers Play, Show in Folder and Delete", (await page.locator('.library__recordings .rec-row[data-id="p1"] button').allInnerTexts()).join() === "Play,Show in Folder,Delete");
await put(jobRec({ id: "sw", startedAt: now - 22 * hour, job: "shrink", progress: null }));
await put(jobRec({ id: "sr", startedAt: now - 23 * hour, job: "shrink", progress: 0.55 }));
await put(jobRec({ id: "jr", startedAt: now - 21 * hour, job: "remux", progress: 0.4 }));
await page.waitForFunction(() => /Shrinking 55%/.test(document.querySelector('.library__recordings .rec-row[data-id="sr"]')?.innerText ?? ""));
const libJobs = Object.fromEntries(await page.locator(".library__recordings .rec-row").evaluateAll((els) => els.map((e) => [e.dataset.id, e.innerText.replace(/\n+/g, " | ")])));
check("Library's section says the same: Waiting to Shrink, Shrinking 55%, Finishing 40%, and what was saved", /Waiting to Shrink/.test(libJobs.sw) && /Shrinking 55%/.test(libJobs.sr) && /Finishing 40%/.test(libJobs.jr) && /Saved 700 MB/.test(libJobs.jw), JSON.stringify([libJobs.sw, libJobs.sr, libJobs.jr, libJobs.jw]));
check("  and none of its rows names the file's type", Object.values(libJobs).every((t) => !/\.(mkv|ts)\b/i.test(t)));
const playsBefore = (await calls("rec_play")).length;
await page.locator('.library__recordings .rec-row[data-id="p1"] button', { hasText: "Play" }).click();
await page.locator(".live-sidebar").waitFor({ timeout: 10_000 });
check("Play in Library goes to Live TV in Recordings mode", (await modeTab("Recordings").getAttribute("aria-selected")) === "true" && (await page.locator(".rec-row").count()) > 0);
await page.waitForFunction((n) => window.__calls.filter((c) => c[0] === "rec_play").length > n, playsBefore, { timeout: 8000 });
const lib = (await calls("rec_play")).at(-1);
check("  and plays it there, by id, with a real rect", lib?.id === "p1" && lib.w > 0 && lib.h > 0, JSON.stringify(lib));
check("  the same player: no second one for recordings", (await page.locator("#player-slot").count()) === 1);

// ------------------------------------- Play, with no channel catalog behind it
// Library's Play lands in Live TV Recordings. With no playlist, or one the
// provider refuses, there is no channel list, and the recording has to play
// anyway: its list, its hero and its player do not wait for the catalog.
for (const [name, lists] of [
  ["no playlist", []],
  [
    "a playlist the provider refuses",
    [{ kind: "xtream", id: "t", name: "Dead", enabled: true, server: "http://localhost:9", username: "u", password: "p" }],
  ],
]) {
  const bare = await ctx.newPage();
  bare.on("pageerror", (e) => errors.push(String(e)));
  await bare.addInitScript(stub);
  await bare.addInitScript((pl) => {
    localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: pl }));
    window.__native.recs.push({
      id: "solo", channel: "Lonely Channel", programme: "Lonely Show", playlistId: "t", startedAt: Date.now() - 3600_000,
      endedAt: Date.now() - 1800_000, path: "C:\\Videos\\solo.ts", bytes: 1024 ** 3, status: "done", reason: null, buffer: false,
    });
  }, lists);
  await bare.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(bare, "mylist");
  await bare.locator('.library__recordings .rec-row[data-id="solo"]').waitFor({ timeout: 15_000 });
  await bare.locator('.library__recordings .rec-row[data-id="solo"] button', { hasText: "Play" }).click();
  await bare.locator(".live-sidebar").waitFor({ timeout: 10_000 });
  await bare.waitForFunction(() => window.__calls.some((c) => c[0] === "rec_play"), null, { timeout: 8000 });
  const bp = await bare.evaluate(() => window.__calls.filter((c) => c[0] === "rec_play").map((c) => c[1]));
  check(`${name}: Play in Library plays the recording, by id, with a real rect`, bp[0]?.id === "solo" && bp[0].w > 0 && bp[0].h > 0, JSON.stringify(bp));
  check(`  and Live TV lists it in Recordings mode`, (await bare.locator(".rec-row").count()) === 1 && (await bare.locator(`.live-sidebar [role=tab][aria-label="Recordings"]`).getAttribute("aria-selected")) === "true");
  check(`  the hero says what it is`, /Lonely Show/.test(await bare.locator(".hero__details").innerText()));
  check(`  and no channel error or empty card sits over it`, (await bare.locator(".live-status").count()) === 0);
  await bare.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
