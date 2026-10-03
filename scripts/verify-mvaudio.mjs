// E2E: multi-view's sound is played from the app, not the webview.
//
// Stream, Live TV and Sports play through libmpv inside BlammyTV.exe, so a
// Discord window share with sound hears them. A multi-view tile is a <video>
// in the webview, and WebView2 renders its audio in its own process, which
// that capture misses. mvAudio.ts takes a copy of the sound tile's audio,
// applies the bar's volume and sends it to the native side (mvaudio.rs) in
// POSTs, and every tile's <video> is muted while that runs.
//
// Two halves, plus the failure paths:
//
// 1. REAL SOUND through the real module. A page on the dev server with a
//    <video> playing a stereo tone (a WAV the harness makes: no fixture, and
//    WebM/Opus is what this Chromium would decode, WAV needs no codec),
//    routed with mv_audio_open stubbed to a URL on this harness's own server.
//    The POSTs are decoded as what the native side would get: non-silent f32
//    stereo at the returned rate, the right channel at half the left's level
//    (the tone's), volume 0.5 at 0.125 of full (mpv's cubic curve), mute
//    silent but still flowing, the <video> muted throughout, no preflight, and
//    nothing sent once it is stopped. The gap between POSTs is measured and
//    printed: it is the data the jitter buffer's targets (mvaudio.rs) come
//    from.
// 2. THE WIRING in the tab. Under the multi-view stubs (tiles carry no
//    decodable audio here, so captureStream is the stub verify-mvsound uses,
//    a real oscillator): every tile's element is muted while routed, the
//    output is opened once, moving the sound takes one new copy from the new
//    tile, the bar's slider and mute drive what is sent, and leaving the tab
//    closes the output and the context.
// 3. THE FALLBACK. When mv_audio_open rejects (a hot bundle on an older native
//    build), the sound tile is unmuted at tileGain(volume) exactly as before.
//    When the output dies mid-run (the listener answers 503), the same. While
//    the context cannot start yet (no click), the same, and the next click
//    switches over. A context that stops mid-run (a device change does it)
//    hands the sound back too, and takes it again when it runs.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvaudio.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const W = 1600;
const H = 900;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** Poll until `fn` says yes, or `ms` runs out; whether it did. */
async function until(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
}

// ------------------------------------------------------------- the sink
/**
 * The native side's listener, as far as the page can tell: POST /a/<token>,
 * answered 204 with the CORS header. It keeps every request, with when it
 * arrived, so the batches can be decoded and their spacing measured. `mode`
 * "dead" answers 503, as mvaudio.rs does once its output has gone.
 */
async function sink() {
  const s = { posts: [], other: 0, mode: "ok" };
  s.server = http.createServer((rq, rs) => {
    const parts = [];
    rq.on("data", (d) => parts.push(d));
    rq.on("end", () => {
      if (rq.method !== "POST") {
        // A preflight would land here: the page was expected to send none.
        s.other++;
        rs.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
        return rs.end();
      }
      s.posts.push({
        at: Number(process.hrtime.bigint()) / 1e6,
        type: rq.headers["content-type"],
        origin: rq.headers.origin,
        path: rq.url,
        body: Buffer.concat(parts),
      });
      rs.writeHead(s.mode === "dead" ? 503 : 204, { "Access-Control-Allow-Origin": "*" });
      rs.end();
    });
  });
  await new Promise((r) => s.server.listen(0, "127.0.0.1", r));
  s.port = s.server.address().port;
  s.clear = () => (s.posts.length = 0);
  s.close = () => s.server.close();
  return s;
}

/** What a run of POSTs says: the level of each channel, how many frames, and
 * whether anything in it was not a number. Left and right are RMS. */
function level(posts) {
  let n = 0;
  let l = 0;
  let r = 0;
  let bad = 0;
  for (const p of posts) {
    const f = new Float32Array(p.body.buffer.slice(p.body.byteOffset, p.body.byteOffset + p.body.length));
    for (let i = 0; i + 1 < f.length; i += 2) {
      if (!Number.isFinite(f[i]) || !Number.isFinite(f[i + 1])) bad++;
      l += f[i] * f[i];
      r += f[i + 1] * f[i + 1];
      n++;
    }
  }
  return { frames: n, l: n ? Math.sqrt(l / n) : 0, r: n ? Math.sqrt(r / n) : 0, bad };
}

/** Milliseconds between the arrivals of consecutive POSTs, settled ones. */
function gaps(posts) {
  const g = posts.slice(10).map((p, i) => p.at - posts[i + 9].at);
  const sorted = [...g].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? NaN;
  return { n: g.length, median: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1] ?? NaN };
}

/** A stereo WAV, 48 kHz, two seconds: 440 Hz at half scale on the left, 660 Hz
 * at a quarter on the right. RMS 0.354 and 0.177 before any gain. */
function tone() {
  const rate = 48000;
  const n = rate * 2;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 4);
    b.writeInt16LE(Math.round(0.25 * 32767 * Math.sin((2 * Math.PI * 660 * i) / rate)), 46 + i * 4);
  }
  return b;
}

const launch = () =>
  chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    // Web Audio runs without a click, as it does in the app once anything has
    // been clicked.
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

/** Every AudioContext the page makes, so a run can suspend and resume the
 * module's own (the page makes no other). */
const TRACK_CONTEXTS = `(() => {
  window.__ctxs = [];
  const Ctx = window.AudioContext;
  window.AudioContext = class extends Ctx {
    constructor(...a) {
      super(...a);
      window.__ctxs.push(this);
    }
  };
})()`;

/**
 * A browser's autoplay policy, stood in for: this headless build starts every
 * AudioContext whatever the policy says (asking for the policy by its switch
 * changes nothing). A context made before the first pointerdown is suspended
 * at once, and resume() does nothing until there has been one, which is what
 * the real policy does to a page nobody has clicked.
 */
const AUTOPLAY_POLICY = `(() => {
  window.__gesture = false;
  addEventListener("pointerdown", () => (window.__gesture = true), true);
  const Ctx = window.AudioContext;
  const resume = Ctx.prototype.resume;
  Ctx.prototype.resume = function () {
    return window.__gesture ? resume.call(this) : Promise.resolve();
  };
  window.AudioContext = class extends Ctx {
    constructor(...a) {
      super(...a);
      if (!window.__gesture) void this.suspend();
    }
  };
})()`;

/** The IPC stub the multi-view harnesses use, with the sound output's three
 * commands added. `reject`: mv_audio_open fails, as it does on a native build
 * from before it. */
function ipc({ port, sinkPort, reject, rate }) {
  window.__calls = [];
  let cb = 0;
  let n = 0;
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
      window.__calls.push(cmd);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
      if (cmd === "mv_audio_open") {
        return reject
          ? Promise.reject("Command mv_audio_open not found")
          : Promise.resolve({ url: `http://127.0.0.1:${sinkPort}/a/test-token`, rate });
      }
      if (cmd === "mv_audio_stats") {
        return Promise.resolve({ open: true, rate, bufferedMs: 30, underruns: 0, overruns: 0, droppedMs: 0, chunks: 1 });
      }
      if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}

// ================================================ 1. real sound, the module
/** A page on the dev server, with the module imported as the app imports it
 * and a <video> playing the tone. */
async function module1(b, s, { rate = 44100, volume = 1, play = true, policy = false, track = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const errors = [];
  const warns = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "warning" && warns.push(m.text()));
  const blank = URL + "__blank";
  await page.route(blank, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>mvaudio</title>" }));
  // Same origin, or captureStream is silenced as a cross-origin read.
  await page.route(URL + "__tone.wav", (r) => r.fulfill({ contentType: "audio/wav", body: tone() }));
  await page.addInitScript(`(${ipc})(${JSON.stringify({ port: 0, sinkPort: s.port, reject: false, rate })})`);
  if (track) await page.addInitScript(TRACK_CONTEXTS);
  if (policy) await page.addInitScript(AUTOPLAY_POLICY);
  await page.goto(blank);
  await page.evaluate(
    async ({ volume, play }) => {
      const m = await import("/src/features/live/mvAudio.ts");
      const v = document.createElement("video");
      v.src = "/__tone.wav";
      v.loop = true;
      document.body.append(v);
      if (play) await v.play();
      window.__m = m;
      window.__v = v;
      window.__level = { id: "sound", volume, muted: false };
      m.setLevel("sound", volume, false);
      // The page's stand-in for the tile: bound as the sound tile, and handing
      // its element over for the copy, exactly as MultiviewTile does.
      window.__unbind = m.bindTile(v, true);
      window.__unroute = m.routeSound(v);
    },
    { volume, play },
  );
  const bar = (volume, muted) =>
    page.evaluate(([vol, mute]) => window.__m.setLevel("sound", vol, mute), [volume, muted]);
  const el = () => page.evaluate(() => [window.__v.muted, window.__v.volume]);
  return { ctx, page, errors, warns, bar, el };
}

{
  const s = await sink();
  const b = await launch();
  const RATE = 44100;
  const { ctx, page, errors, bar, el } = await module1(b, s, { rate: RATE, volume: 1 });
  const before = await el();
  check(
    "before the output is up, the sound tile plays in the webview as it always did",
    before[0] === false && near(before[1], 1, 1e-9),
    JSON.stringify(before),
  );
  await page.evaluate(() => (window.__stop = window.__m.startMvAudio()));
  const switched = await until(async () => (await el())[0] === true);
  check("once the native side has taken sound, the element is muted", switched, JSON.stringify(await el()));
  // From here the element stays muted whatever the bar does.
  await page.evaluate(() => {
    window.__unmuted = 0;
    window.__v.addEventListener("volumechange", () => window.__v.muted || window.__unmuted++);
  });

  await until(() => s.posts.length >= 25, 8000);
  s.clear();
  await sleep(2000);
  const full = level(s.posts);
  const g = gaps(s.posts);
  check(
    "POSTs arrive: text/plain from the page, to the sink's path, in whole stereo frames",
    s.posts.length > 50 &&
      s.posts.every((p) => p.type === "text/plain" && p.path === "/a/test-token" && p.origin === new globalThis.URL(URL).origin) &&
      s.posts.every((p) => p.body.length > 0 && p.body.length % 8 === 0 && p.body.length <= 65536),
    `${s.posts.length} in 2s, ${s.posts[0]?.body.length} bytes each`,
  );
  check(
    "and no preflight: a simple CORS request",
    s.other === 0,
    `${s.other} non-POST requests`,
  );
  const perSecond = full.frames / 2;
  check(
    "at the rate the output said (44100, not the page's own)",
    near(perSecond, RATE, RATE * 0.04),
    `${Math.round(perSecond)} frames a second`,
  );
  check(
    "non-silent f32, left at the tone's 0.354 and right at its 0.177: the channels are where they were",
    full.bad === 0 && near(full.l, 0.354, 0.04) && near(full.r, 0.177, 0.025),
    JSON.stringify({ l: +full.l.toFixed(4), r: +full.r.toFixed(4), bad: full.bad }),
  );
  console.log(
    `INFO gap between POSTs (ms): median ${g.median.toFixed(1)}, p99 ${g.p99.toFixed(1)}, max ${g.max.toFixed(1)}, over ${g.n} POSTs`,
  );

  await bar(0.5, false);
  await sleep(600);
  s.clear();
  await sleep(1500);
  const half = level(s.posts);
  check(
    "volume 0.5 sends 0.125 of full: mpv's cubic curve, not the slider",
    near(half.l / full.l, 0.125, 0.012) && near(half.r / full.r, 0.125, 0.012),
    `l ${(half.l / full.l).toFixed(4)}, r ${(half.r / full.r).toFixed(4)} of full`,
  );

  await bar(1, true);
  await sleep(600);
  s.clear();
  await sleep(1500);
  const muted = level(s.posts);
  check(
    "mute sends silence, and keeps sending it",
    s.posts.length > 40 && muted.l < 1e-4 && muted.r < 1e-4 && muted.bad === 0,
    `${s.posts.length} POSTs, l ${muted.l.toExponential(1)}`,
  );

  await bar(1, false);
  await sleep(600);
  s.clear();
  await sleep(1500);
  const back = level(s.posts);
  check("and unmuting brings the sound back", near(back.l, full.l, 0.02), `l ${back.l.toFixed(4)}`);

  const violations = await page.evaluate(() => window.__unmuted);
  const end = await el();
  check(
    "the <video> was muted throughout: through the volume change, the mute and the unmute",
    violations === 0 && end[0] === true && near(end[1], 1, 1e-9),
    JSON.stringify({ violations, end }),
  );

  await page.evaluate(() => window.__stop());
  await sleep(500);
  s.clear();
  await sleep(700);
  const calls = await page.evaluate(() => window.__calls);
  check(
    "stopping closes the output, and nothing is sent after it",
    calls.includes("mv_audio_close") && s.posts.length === 0,
    JSON.stringify({ calls, after: s.posts.length }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await b.close();
  s.close();
}

// =========================== 3a. the output dies mid-run: the page takes over
{
  const s = await sink();
  const b = await launch();
  const { ctx, page, errors, warns, el } = await module1(b, s, { rate: 48000, volume: 0.5 });
  await page.evaluate(() => (window.__stop = window.__m.startMvAudio()));
  const routed = await until(async () => (await el())[0] === true);
  await until(() => s.posts.length >= 10);
  // The listener now says what mvaudio.rs says when its output has gone.
  s.mode = "dead";
  const back = await until(async () => (await el())[0] === false, 8000);
  const now = await el();
  check(
    "a dead output hands the sound back to the webview, at the bar's volume on mpv's curve",
    routed && back && near(now[1], 0.5 ** 3, 1e-9),
    JSON.stringify({ routed, back, now }),
  );
  check(
    "and says why in the console",
    warns.some((w) => w.includes("[mv] sound stays in the webview")),
    warns.join(" | ").slice(0, 200),
  );
  await sleep(300);
  s.clear();
  await sleep(600);
  check("and stops sending", s.posts.length === 0, `${s.posts.length} POSTs after`);
  await page.evaluate(() => window.__stop());
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await b.close();
  s.close();
}

// ====================== 3c. the context cannot start until the page is clicked
// (the <video> is left not playing: this only reads its muting)
{
  const s = await sink();
  const b = await launch();
  const { ctx, page, errors, el } = await module1(b, s, { rate: 48000, volume: 0.5, play: false, policy: true });
  await page.evaluate(() => (window.__stop = window.__m.startMvAudio()));
  await sleep(1500);
  const waiting = await el();
  const sent = s.posts.length;
  check(
    "with the context waiting for a click, the sound stays in the webview and nothing is sent",
    waiting[0] === false && sent === 0,
    JSON.stringify({ waiting, sent }),
  );
  await page.mouse.click(40, 40);
  const switched = await until(async () => (await el())[0] === true, 6000);
  await until(() => s.posts.length >= 10);
  check(
    "the next click starts it, and the sound switches over",
    switched && s.posts.length >= 10,
    JSON.stringify({ switched, sent: s.posts.length }),
  );
  await page.evaluate(() => window.__stop());
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await b.close();
  s.close();
}

// ============ 3d. the context is suspended mid-run, and runs again
{
  const s = await sink();
  const b = await launch();
  const { ctx, page, errors, el } = await module1(b, s, { rate: 48000, volume: 0.5, track: true });
  await page.evaluate(() => (window.__stop = window.__m.startMvAudio()));
  const routed = await until(async () => (await el())[0] === true);
  await until(() => s.posts.length >= 10);
  // What a device change or the system does to a context: it stops.
  await page.evaluate(() => window.__ctxs[0].suspend());
  const out = await until(async () => (await el())[0] === false);
  const now = await el();
  await sleep(300);
  s.clear();
  await sleep(600);
  check(
    "a context that stops mid-run hands the sound back to the webview, and nothing is sent",
    routed && out && near(now[1], 0.5 ** 3, 1e-9) && s.posts.length === 0,
    JSON.stringify({ routed, out, now, sent: s.posts.length }),
  );
  await page.evaluate(() => window.__ctxs[0].resume().then(() => true, () => false));
  const again = await until(async () => (await el())[0] === true);
  await until(() => s.posts.length >= 10);
  check(
    "and when it runs again the sound goes back through the app",
    again && s.posts.length >= 10,
    JSON.stringify({ again, sent: s.posts.length }),
  );
  await page.evaluate(() => window.__stop());
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await b.close();
  s.close();
}

// ======================================================= 2. the tab's wiring
const ESPN = "Fake ESPN 4K";
const SKY = "Fake Sky Sports FHD";
const NEWS = "Fake News Channel";
const GRID = [
  { channelId: "t:101", label: ESPN },
  { channelId: "t:102", label: SKY },
  { channelId: "t:103", label: NEWS },
];
const proxy = http.createServer((rq, rs) => {
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => clearInterval(t));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;

async function openTab(b, s, { reject = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  const warns = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "warning" && warns.push(m.text()));
  await page.addInitScript(
    ({ grid }) => {
      MediaSource.isTypeSupported = () => true;
      // Every AudioContext the app makes, with what it was asked for: the
      // routing's is the one made with a sampleRate. The oscillator's own is
      // made outside the app and left out.
      window.__ctxs = [];
      let inStub = false;
      const Ctx = window.AudioContext;
      window.AudioContext = class extends Ctx {
        constructor(...a) {
          super(...a);
          if (!inStub) window.__ctxs.push({ ctx: this, opts: a[0] ?? null });
        }
      };
      // The tile's copy of its sound, as verify-mvsound has it: a 300 Hz tone
      // at 0.8. Each copy is noted with the tile it came from and who took it
      // (mvAudio, or mvLevel for the bars).
      window.__taken = [];
      HTMLMediaElement.prototype.captureStream = function () {
        const by = /mvAudio/.test(new Error().stack ?? "") ? "audio" : "level";
        const tile = this.closest(".mvtile")?.getAttribute("aria-label")?.split(",")[0] ?? "";
        window.__taken.push({ by, tile });
        inStub = true;
        const ac = new AudioContext();
        inStub = false;
        const osc = ac.createOscillator();
        osc.frequency.value = 300;
        const gain = ac.createGain();
        gain.gain.value = 0.8;
        const dest = ac.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        return dest.stream;
      };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(
          "blammytv.multiviewGrid",
          JSON.stringify({ v: 1, data: { picks: grid, sound: "t:101" } }),
        );
      }
      localStorage.setItem(
        "blammytv.playlists",
        JSON.stringify({
          v: 1,
          data: [
            {
              kind: "xtream",
              id: "t",
              name: "Test",
              enabled: true,
              server: "http://localhost:8081",
              username: "u",
              password: "p",
            },
          ],
        }),
      );
    },
    { grid: GRID },
  );
  await page.addInitScript(`(${ipc})(${JSON.stringify({ port: PORT, sinkPort: s.port, reject, rate: 48000 })})`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  const ready = await page
    .waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 3, null, {
      timeout: 15_000,
    })
    .then(() => true, () => false);
  if (!ready) throw new Error(`multi-view never showed its 3 tiles: ${JSON.stringify({ errors })}`);
  // Nothing decodes in the test Chromium, so the tiles never say they are
  // playing: say it for them, as verify-mvsound does.
  await page.evaluate(() =>
    document.querySelectorAll("video.mvtile__video").forEach((v) => v.dispatchEvent(new Event("playing"))),
  );
  return { ctx, page, errors, warns };
}

/** Each tile's <video>: [muted, volume]. */
const audio = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => {
        const v = e.querySelector("video");
        return [e.getAttribute("aria-label").split(",")[0], [v.muted, v.volume]];
      }),
    ),
  );
const calls = (page) => page.evaluate(() => window.__calls);
const count = (list, cmd) => list.filter((c) => c === cmd).length;
const takenBy = (page, by) => page.evaluate((who) => window.__taken.filter((t) => t.by === who).map((t) => t.tile), by);

{
  const s = await sink();
  const b = await launch();
  const { ctx, page, errors } = await openTab(b, s);
  await page.locator(".mvvol__slider").fill("1");
  const routed = await until(async () => {
    const a = await audio(page);
    return Object.values(a).every(([muted]) => muted) && s.posts.length > 5;
  });
  const a = await audio(page);
  check(
    "routed, every tile's <video> is muted, the sound tile's too, and none is left at a volume",
    routed && Object.values(a).every(([muted, vol]) => muted && vol === 1),
    JSON.stringify(a),
  );
  const c0 = await calls(page);
  check(
    "the output is opened once, and not closed while the tab is up",
    count(c0, "mv_audio_open") === 1 && count(c0, "mv_audio_close") === 0,
    JSON.stringify(c0.filter((c) => c.startsWith("mv_audio"))),
  );
  const first = await takenBy(page, "audio");
  check("one copy is taken for the sound, from the sound tile", JSON.stringify(first) === JSON.stringify([ESPN]), JSON.stringify(first));

  // The bar drives what is sent: the real slider and mute button.
  await sleep(400);
  s.clear();
  await sleep(1200);
  const loud = level(s.posts);
  await page.locator(".mvvol__slider").fill("0.5");
  await sleep(600);
  s.clear();
  await sleep(1200);
  const soft = level(s.posts);
  check(
    "the bar's slider at 0.5 sends 0.125 of what it sent at 1",
    loud.l > 0.3 && near(soft.l / loud.l, 0.125, 0.012),
    `${loud.l.toFixed(3)} then ${soft.l.toFixed(4)}: ${(soft.l / loud.l).toFixed(4)}`,
  );
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await sleep(600);
  s.clear();
  await sleep(1200);
  const hush = level(s.posts);
  check("and its Mute sends silence", s.posts.length > 20 && hush.l < 1e-4, `${s.posts.length} POSTs, l ${hush.l.toExponential(1)}`);
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await page.locator(".mvvol__slider").fill("1");

  // The sound moves: one new copy, from the new tile; still every tile muted.
  await page.locator(`.mvtile[aria-label^="${NEWS},"]`).click({ position: { x: 60, y: 60 } });
  await sleep(500);
  const second = await takenBy(page, "audio");
  const posts0 = s.posts.length;
  await sleep(600);
  const a2 = await audio(page);
  check(
    "moving the sound to another tile rewires it: one more copy, from that tile",
    JSON.stringify(second) === JSON.stringify([ESPN, NEWS]),
    JSON.stringify(second),
  );
  check(
    "every tile is still muted, and sound still arrives",
    Object.values(a2).every(([muted]) => muted) && s.posts.length > posts0,
    JSON.stringify({ a2, more: s.posts.length - posts0 }),
  );
  const c1 = await calls(page);
  check("and the output was not opened again for it", count(c1, "mv_audio_open") === 1, JSON.stringify(count(c1, "mv_audio_open")));

  await goTo(page, "guide");
  await sleep(600);
  const c2 = await calls(page);
  const mine = await page.evaluate(() => window.__ctxs.filter((c) => c.opts?.sampleRate).map((c) => c.ctx.state));
  s.clear();
  await sleep(700);
  check(
    "leaving the tab closes the output once, closes the context, and stops sending",
    count(c2, "mv_audio_close") === 1 && count(c2, "mv_audio_open") === 1 && JSON.stringify(mine) === '["closed"]' && s.posts.length === 0,
    JSON.stringify({ close: count(c2, "mv_audio_close"), open: count(c2, "mv_audio_open"), mine, after: s.posts.length }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await b.close();
  s.close();
}

// ============================ 3b. the output cannot be opened: today's sound
{
  const s = await sink();
  const b = await launch();
  const { ctx, page, errors, warns } = await openTab(b, s, { reject: true });
  await page.locator(".mvvol__slider").fill("0.4");
  await sleep(1500);
  const a = await audio(page);
  // On mpv's curve, the slider cubed (v0.10.2): 0.4 plays at 0.064.
  check(
    "when mv_audio_open rejects, the sound tile is unmuted at the bar's volume on mpv's curve, the others muted: as before",
    a[ESPN][0] === false &&
      near(a[ESPN][1], 0.4 ** 3, 1e-6) &&
      a[SKY][0] &&
      a[NEWS][0],
    JSON.stringify(a),
  );
  const c = await calls(page);
  const taken = await takenBy(page, "audio");
  const made = await page.evaluate(() => window.__ctxs.filter((c) => c.opts?.sampleRate).length);
  check(
    "it asked once, made no context and no copy of its own, and sent nothing",
    count(c, "mv_audio_open") === 1 && taken.length === 0 && made === 0 && s.posts.length === 0,
    JSON.stringify({ asked: count(c, "mv_audio_open"), taken, made, sent: s.posts.length }),
  );
  check(
    "and says so in the console",
    warns.some((w) => w.includes("[mv] sound stays in the webview")),
    warns.join(" | ").slice(0, 200),
  );
  // Mute and the keys still work on the webview's own sound.
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await sleep(200);
  const m = await audio(page);
  check("and Mute still mutes it", m[ESPN][0] === true, JSON.stringify(m));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await b.close();
  s.close();
}

proxy.close();
process.exit(fail ? 1 : 0);
