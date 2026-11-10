// Shared by the Fluent harnesses that need the player: a page with the native
// side stubbed (isTauri() is true, the real player path runs, mpv is a black
// hole), the fake panel's "pins" line for channels, and a stand-in stream proxy
// for Multi-View's tiles. Nothing here asserts; each harness brings its own
// checks. The panel and app addresses come from the caller, so a harness run on
// other ports passes its own.
import http from "node:http";

/** A stream proxy that only ever says "video": Multi-View's tiles open it. */
export async function startProxy() {
  const server = http.createServer((rq, rs) => {
    rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
    const packet = Buffer.alloc(188);
    packet[0] = 0x47;
    const t = setInterval(() => rs.write(packet), 10);
    rs.on("close", () => clearInterval(t));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => server.close() };
}

const stub = ({ store, native, port, onboarded, whats }) => {
  if (onboarded) localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: whats }));
  sessionStorage.setItem("btv:welcome-played", "1");
  if (!sessionStorage.getItem("fluent-native-seeded")) {
    sessionStorage.setItem("fluent-native-seeded", "1");
    for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
  }
  if (!native) return;
  MediaSource.isTypeSupported = () => true;
  window.__presenting = false;
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
      if (cmd === "plugin:event|listen") return Promise.resolve(++cb);
      if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv`);
      if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
      if (cmd === "frontend_status") return Promise.resolve({ serving: "", pending: "" });
      if (cmd === "mpv_status" && window.__presenting)
        return Promise.resolve(JSON.stringify({ pos: 10, dur: window.__dur ?? 0, presenting: true, ended: false, buffering: false, seekable: true, cacheDur: 0, dvrStart: 0, dvrEnd: 0, audio: [], subs: [], chapters: [] }));
      if (cmd === "rec_list") return Promise.resolve([]);
      if (cmd === "rec_default_folder") return Promise.resolve("C:\\Users\\sam\\Videos\\BlammyTV");
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unlisten: () => {}, unregisterListener: () => {} };
};

/** The app under Fluent (or Default, with `pack: null`), a face, a window size.
 * `panel` is the fake panel's address; its "pins" line has forty channels. */
export async function openApp(browser, { url, panel, proxy, pack = "fluent", light = false, w = 1600, h = 900, dpr = 1, startup = "live", store = {}, native = true, onboarded = true, whats = "999.0", version = null }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: light ? "light" : "dark", reducedMotion: "reduce" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  // A page that wants What's New is served a version.ts ahead of the release
  // the data file announces (nothing in the source changes).
  if (version)
    await ctx.route("**/src/lib/version.ts*", (r) => r.fulfill({ contentType: "text/javascript", body: `export const APP_VERSION = "${version}";` }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  const all = {
    playlists: [{ kind: "xtream", id: "p", name: "Pins", enabled: true, server: panel, username: "pins", password: "p" }],
    startupTab: startup,
    multiviewNoticeSeen: true,
    recordingNotice: false,
    ...(pack ? { themePack: pack } : {}),
    ...(light ? { theme: "light" } : {}),
    ...store,
  };
  await page.addInitScript(stub, { store: all, native, port: proxy?.port, onboarded, whats });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

/** Guide, a channel, its mini player and then the theater over it, with the
 * player's chrome awake. Returns once the overlay is up. */
export async function openTheater(page) {
  await page.locator(".guide__card").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.locator(".guide__card").nth(2).click();
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => { window.__presenting = true; });
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  await wake(page);
}

/** The player's chrome hides when idle and takes no clicks; a move wakes it. */
export async function wake(page) {
  await page.mouse.move(800, 300);
  await page.mouse.move(820, 330);
  await page.waitForTimeout(400);
}

/** The lowest contrast ratio (WCAG) between each matched control's ink and what
 * it sits on: its own fill and every ancestor's, laid over black, which is the
 * stand-in picture. Returns [{ name, ratio }], the worst first. */
export function contrastOf(page, selector) {
  return page.evaluate((selector) => {
    const parse = (c) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = c;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
    const lum = (c) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || getComputedStyle(el).visibility === "hidden") continue;
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 0.99) break;
      }
      let base = [0, 0, 0];
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      const ink = parse(getComputedStyle(el).color);
      const fg = over(ink, base);
      const [a, b] = [lum(fg), lum(base)];
      out.push({ name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24) || el.className.slice(0, 24), ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) });
    }
    return out.sort((x, y) => x.ratio - y.ratio);
  }, selector);
}
