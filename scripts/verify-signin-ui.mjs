// E2E: signing in to AIOStreams from Settings (plan 024, B3b), with a fake of
// its Jellyfin side and a small Stremio addon in this process. The page's
// aiojf commands (aiojf.rs in the app) are stubbed to forward to the fake, the
// way verify-signin and verify-aiojf stub them: aiojf.rs's own tests cover the
// token, the guard and `derive`; this covers what the page shows and does.
//
// - Settings → Sources → Stream leads with the sign-in: an address
//   field, Connect, the code (large, copyable, approved on the configure
//   page, noticed on its own), then "Signed in as", the host (origin only),
//   when it last synced, Sync now, the Trakt line, the Connection Test and
//   Disconnect. The manifest field waits behind "Use a manifest URL instead".
// - D4: a stored manifest URL is deleted once there is a sign-in, whether the
//   approval is new or the account was connected already, and that signs
//   nobody out. Changing the URL later leaves the sign-in alone.
// - The Connection Test signed in: the catalogs, then a stream search for the
//   test title through aiojf_sources, no forensic probe; a failing search
//   shows red with no address in it.
// - A build that is connected but cannot open sources says so and keeps the
//   manifest field; a native build from before the sign-in offers the
//   manifest field and says it needs the update, and so does one that has the
//   sync but cannot open sources, signed out (no address sign-in there).
// - Stream's empty state points at signing in, not at pasting a manifest.
//
// Offline, as every harness is: every host but localhost is aborted.
//
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-signin-ui.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// ----------------------------------------------------------- packed ids
// AIOStreams' item id for tt0111161 as a movie (the plan's vector), written
// here on its own so a slip in the app's ids.ts cannot hide behind itself.
const TT0111161 = "a1110100000001b239ffffffff000000";
const TICKS = 10_000_000;

// ----------------------------------------------------------- the Jellyfin side
const VIEWS = [
  { id: "a2" + "1".repeat(30), type: "movie", cid: "fake.trending", name: "Trending Movies" },
  { id: "a2" + "2".repeat(30), type: "series", cid: "fake.shows", name: "Popular Shows" },
];
/** Every call the Jellyfin routes answered. */
const calls = [];
const jf = {
  /** What PlaybackInfo answers: 200, or a failure for the failing test. */
  sourcesStatus: 200,
  /** PlaybackInfo calls, with their body. */
  playbackInfo: [],
};
const reset = () => {
  calls.length = 0;
  jf.sourcesStatus = 200;
  jf.playbackInfo.length = 0;
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const list = (items) => ({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });

function mediaSources(jid) {
  return [0, 1, 2].map((i) => ({
    Protocol: "Http",
    Id: i === 0 ? jid : `ms-${jid}-${i}`,
    Path: `http://127.0.0.1/video/${jid}/${i}.mkv`,
    Type: "Default",
    Container: "mkv",
    Size: 1_000_000_000,
    Name: `⚡ Fake Debrid\nFake.File.${i}.1080p`,
    IsRemote: true,
    RunTimeTicks: 6000 * TICKS,
    IsInfiniteStream: false,
    aiostreams: { name: "⚡ Fake Debrid", description: `Fake.File.${i}.1080p`, service: "realdebrid", cached: true, bingeGroup: "aio|1080p|x", id: `s${i}` },
  }));
}

function jellyfin(rq, rs, path, q, body) {
  const send = (status, payload) => {
    rs.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    rs.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  calls.push({ method: rq.method, path, query: Object.fromEntries(q), body });
  let m;
  if (rq.method === "GET" && path === "/UserViews") {
    return send(200, list(VIEWS.map((v) => ({ Id: v.id, Type: "CollectionFolder", Name: v.name, IsFolder: true, Path: `/aiostreams/${v.type}/${v.cid}` }))));
  }
  if (rq.method === "GET" && path === "/Genres") return send(200, list([{ Name: "Drama", Type: "Genre" }]));
  if (rq.method === "GET" && path === "/Items" && q.get("ParentId")) {
    return send(
      200,
      list([
        {
          Id: TT0111161,
          Type: "Movie",
          Name: "Fake Movie One",
          ProductionYear: 2024,
          Genres: ["Drama"],
          ProviderIds: { Imdb: "tt0111161" },
          Path: "/aiostreams/movie/tt0111161/Fake Movie One.mkv",
          ImageTags: { Primary: "tag1" },
          UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false },
        },
      ]),
    );
  }
  if (rq.method === "GET" && /^\/Items\/[^/]+\/Images\//.test(path)) {
    rs.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    return rs.end(PNG);
  }
  if (rq.method === "POST" && (m = /^\/Items\/([0-9a-f]{32})\/PlaybackInfo$/.exec(path))) {
    jf.playbackInfo.push({ id: m[1], body, viaSources: rq.headers["x-aiojf-sources"] === "1" });
    if (jf.sourcesStatus !== 200) return send(jf.sourcesStatus, { Message: "fake failure" });
    return send(200, { MediaSources: mediaSources(m[1]), PlaySessionId: `ps-${m[1]}` });
  }
  // The sync's lists, and everything else unscoped: nothing.
  if (rq.method === "GET" && ["/UserItems/Resume", "/Items", "/Shows/NextUp", "/Shows/Upcoming"].includes(path)) return send(200, list([]));
  if (rq.method === "POST" && /^\/Sessions\//.test(path)) return send(204);
  return send(404, { Message: "fake jellyfin has no " + path });
}

// ---------------------------------------------------- the Stremio side
// A manifest with two catalogs, for the scenes that paste one.
let PORT = 0;
const server = http.createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    const url = new URL(rq.url, "http://x");
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": rq.headers["access-control-request-headers"] ?? "*",
    };
    if (rq.method === "OPTIONS") {
      rs.writeHead(204, cors);
      return rs.end();
    }
    if (url.pathname.startsWith("/jellyfin/")) {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* not JSON */
      }
      return jellyfin(rq, rs, url.pathname.slice("/jellyfin".length), url.searchParams, body);
    }
    const json = (payload) => {
      rs.writeHead(200, { "content-type": "application/json", ...cors });
      rs.end(JSON.stringify(payload));
    };
    const segs = url.pathname.replace(/\.json$/, "").split("/").slice(1).map(decodeURIComponent);
    if (segs[0] === "manifest") {
      return json({
        id: "fake.manifest",
        version: "1.0.0",
        name: "Fake Manifest",
        resources: ["catalog", "meta", "stream"],
        types: ["movie"],
        catalogs: [
          { type: "movie", id: "manifest.top", name: "Manifest Movies", extra: [{ name: "skip" }] },
          { type: "movie", id: "manifest.more", name: "More Movies", extra: [{ name: "skip" }] },
          { type: "movie", id: "manifest.last", name: "Last Movies", extra: [{ name: "skip" }] },
        ],
      });
    }
    if (segs[0] === "catalog") return json({ metas: [{ id: "tt0900001", type: "movie", name: "Manifest Film" }] });
    if (segs[0] === "stream") return json({ streams: [{ name: "x", url: `http://localhost:${PORT}/v.mp4` }] });
    rs.writeHead(404, cors);
    rs.end("not found");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/jellyfin`;
const MANIFEST_URL = `http://localhost:${PORT}/manifest.json`;
const CONFIGURE = `${ORIGIN}/stremio/configure`;

// ----------------------------------------------------------- the page
// One stub for every page. `o`: connected (the vault holds a token), manifest
// (a manifest URL is stored), noSources (a native build from before
// aiojf_sources), old (a native build from before the sign-in at all), start
// ("unsupported" | "bad"), poll ("expire").
const stub = ({ base, manifest, configure, o }) => {
  window.__calls = [];
  window.__copied = [];
  window.__connected = !!o.connected;
  let polls = 0;
  let cb = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => (window.__copied.push(t), Promise.resolve()) },
  });
  const forward = (args) => {
    const q = args.query ? "?" + new URLSearchParams(args.query) : "";
    return fetch(base + args.path + q, {
      method: args.method,
      headers: { "content-type": "application/json" },
      ...(args.body != null ? { body: JSON.stringify(args.body) } : {}),
    }).then(async (r) => ({ status: r.status, body: await r.text() }));
  };
  // aiojf.rs SOURCE_KEEPS: the only fields of a source the page is given.
  const KEEP = ["Id", "Path", "Name", "Type", "Size", "Container", "RunTimeTicks", "IsInfiniteStream", "aiostreams"];
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
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd.startsWith("aiojf_") && o.old) return Promise.reject(`Command ${cmd} not found`);
      if (cmd === "aiojf_status")
        return Promise.resolve(window.__connected ? { connected: true, userName: "Adam", userId: "u1", base } : { connected: false });
      if (cmd === "aiojf_start") {
        if (o.start === "unsupported") return Promise.reject("unsupported: no Jellyfin side on this instance");
        if (o.start === "bad") return Promise.reject("not an AIOStreams address");
        return Promise.resolve({ code: "123456", expiresIn: 600, configureUrl: configure });
      }
      if (cmd === "aiojf_poll") {
        if (o.poll === "expire") return Promise.resolve("expired");
        if (++polls < 2) return Promise.resolve("pending");
        window.__connected = true;
        return Promise.resolve("approved");
      }
      if (cmd === "aiojf_disconnect") {
        window.__connected = false;
        return Promise.resolve();
      }
      if (cmd === "aiojf_request") return forward(args);
      if (cmd === "aiojf_sources") {
        if (o.noSources) return Promise.reject("Command aiojf_sources not found");
        // As aiojf.rs: an id that is not 32 lower case hex is refused before a request.
        if (!/^[0-9a-f]{32}$/.test(args.itemId)) return Promise.reject("refused: not an AIOStreams item id");
        window.__sourceAsks = (window.__sourceAsks ?? []).concat([{ id: args.itemId, refresh: !!args.refresh }]);
        return fetch(`${base}/Items/${args.itemId}/PlaybackInfo`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aiojf-sources": "1" },
          body: JSON.stringify(args.refresh ? { Refresh: true } : { Fresh: true }),
        }).then(async (r) => {
          const body = await r.json().catch(() => ({}));
          return {
            status: r.status,
            sources: (body.MediaSources ?? []).map((s) => Object.fromEntries(KEEP.filter((k) => k in s).map((k) => [k, s[k]]))),
          };
        });
      }
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
  if (o.manifest) localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: manifest }));
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
async function openPage(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: "reduce" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(stub, { base: BASE, manifest: MANIFEST_URL, configure: CONFIGURE, o });
  await p.goto(APP, { waitUntil: "domcontentloaded" });
  return p;
}
const storeOf = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const waitFor = async (p, fn, ms = 12_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(150);
  }
  return false;
};
const callsOf = (p, cmd) => p.evaluate((c) => window.__calls.filter(([n]) => n === c).map(([, a]) => a), cmd);
/** Settings, on Sources → Stream. */
const toStreamTab = async (p) => {
  await p.locator("button[aria-label='Settings']").click({ timeout: 20_000 });
  await p.getByRole("tab", { name: "Sources", exact: true }).click();
  await p.locator(".customize-rail").getByRole("tab", { name: "Stream", exact: true }).click();
  await p.locator(".settings-section").first().waitFor({ timeout: 10_000 });
};
/** The address field. Exact: the manifest field's placeholder holds the host too. */
const addr = (p) => p.getByPlaceholder("aiostreams.example.com", { exact: true });
const MANIFEST_FIELD = /manifest\.json/;
const shot = async (p, name) => {
  if (process.env.SHOT_DIR) await p.locator(".settings__body").first().screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }).catch(() => {});
};

// ============================================================ signing in
// Nothing stored: the sign-in leads, the manifest waits behind a link.
{
  reset();
  const p = await openPage({});
  await toStreamTab(p);
  const field = addr(p);
  await field.waitFor({ timeout: 8000 });
  const connectBtn = p.getByRole("button", { name: "Connect", exact: true });
  check(
    "Signed out with nothing stored: the sign-in leads, with an AIOStreams address field and Connect",
    (await field.count()) === 1 && (await connectBtn.count()) === 1 && (await p.getByText("AIOStreams address", { exact: true }).count()) === 1,
  );
  check("  Connect waits for an address", await connectBtn.isDisabled());
  check(
    "  the manifest field and its Connection Test wait behind \"Use a manifest URL instead\"",
    (await p.getByPlaceholder(MANIFEST_FIELD).count()) === 0 &&
      (await p.getByRole("button", { name: "Use a manifest URL instead" }).count()) === 1 &&
      (await p.getByRole("button", { name: /Run Connection Test/ }).count()) === 0,
  );
  await shot(p, "signin-off");

  await field.fill("aiostreams.example.com");
  await connectBtn.click();
  const row = p.locator(".aio-row");
  const code = await row.locator(".trakt-row__code").innerText({ timeout: 8000 }).catch(() => "");
  const starts = await callsOf(p, "aiojf_start");
  check("Connect starts the code with the address as typed, and shows it large", code === "123456" && starts.length === 1 && starts[0].manifestUrl === "aiostreams.example.com", JSON.stringify({ code, starts }));
  const selectable = await row.locator(".trakt-row__code").evaluate((el) => getComputedStyle(el).userSelect);
  await row.getByRole("button", { name: "Copy code" }).click();
  const copied = await p.evaluate(() => [...window.__copied]);
  check("  the code can be selected, and its button copies it", selectable === "text" && copied.length === 1 && copied[0] === "123456", JSON.stringify({ selectable, copied }));
  check("  the note says where to approve it", /Save & Install, Jellyfin apps, Connect/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, " | "));
  await shot(p, "signin-code");
  await row.getByRole("button", { name: "Open AIOStreams" }).click();
  const opened = await callsOf(p, "open_external");
  check(
    "  Open AIOStreams copies it again and opens the configure page through the app",
    opened[0]?.url === CONFIGURE && (await p.evaluate(() => window.__copied.length)) === 2,
    JSON.stringify(opened),
  );
  check("  while it is pending the code stays up", (await p.locator(".aio-row .trakt-row__code").count()) === 1 && (await connectBtn.count()) === 0);

  // Approved on the second poll: the account, a first sync, and the rest.
  const on = await row.locator(".customize-row__title", { hasText: "Signed in as Adam" }).waitFor({ timeout: 14_000 }).then(() => true, () => false);
  await row.getByRole("button", { name: "Sync now" }).waitFor({ timeout: 8000 }).catch(() => {});
  const text = (await row.innerText()).replace(/\n/g, " | ");
  const buttons = await row.getByRole("button").allInnerTexts();
  check(
    "Approved on a later poll it says who is signed in, with Sync now and Disconnect",
    on && buttons.includes("Sync now") && buttons.includes("Disconnect") && !buttons.includes("Connect"),
    JSON.stringify({ on, buttons }),
  );
  check(
    "  the host is the origin only, never a path",
    text.includes(ORIGIN) && !text.includes("/jellyfin") && !text.includes("/stremio"),
    text,
  );
  const synced = await waitFor(p, async () => calls.some((c) => c.path === "/UserItems/Resume"), 8000);
  await waitFor(p, async () => /Synced (just now|a minute ago)/.test(await row.innerText()), 6000);
  check("  a first sync ran, and the line says when it last synced", synced && /Synced (just now|a minute ago)/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, " | "));
  check(
    "  the Trakt tracker line is here",
    /Leave any Trakt tracker out of your AIOStreams setup, or each play counts twice\./.test(await row.innerText()),
  );
  const si = (await storeOf(p, "aiojf"))?.signedIn;
  check("  and the sign-in is recorded on this device, with no token or id", si?.userName === "Adam" && JSON.stringify(si) === JSON.stringify({ base: BASE, userName: "Adam" }), JSON.stringify(si));
  check(
    "  the manifest field is not offered signed in, the Connection Test is",
    (await p.getByPlaceholder(MANIFEST_FIELD).count()) === 0 &&
      (await p.getByRole("button", { name: "Use a manifest URL instead" }).count()) === 0 &&
      (await p.getByRole("button", { name: /Run Connection Test/ }).count()) === 1 &&
      !/Update BlammyTV/.test(text),
    text,
  );
  await shot(p, "signin-on");

  // ------------------------------------------------------ the Connection Test
  await p.getByRole("button", { name: /Run Connection Test/ }).click();
  await p.locator(".aio-probe__row").nth(1).waitFor({ timeout: 15_000 }).catch(() => {});
  const rows = await p.$$eval(".aio-probe__row", (els) => els.map((e) => ({ bad: e.className.includes("--bad"), text: e.textContent })));
  const ask = await p.evaluate(() => window.__sourceAsks ?? []);
  check(
    "The Connection Test signed in: the catalogs (not counting search), then the test title's sources",
    rows.length === 2 && rows.every((r) => !r.bad) && /Catalogs.*OK, 2 catalogs/.test(rows[0].text) && /Sources \(test title\).*OK, 3 sources/.test(rows[1].text),
    JSON.stringify(rows.map((r) => r.text)),
  );
  check(
    "  the sources step is a stream search for tt0111161 through aiojf_sources, asked afresh",
    ask.length === 1 && ask[0].id === TT0111161 && ask[0].refresh === true && jf.playbackInfo.length === 1 && jf.playbackInfo[0].body?.Refresh === true && jf.playbackInfo[0].viaSources,
    JSON.stringify({ ask, playback: jf.playbackInfo }),
  );
  check(
    "  no forensic probe and no address in the results",
    (await callsOf(p, "http_probe")).length === 0 && (await p.locator(".aio-probe__forensic").count()) === 0 && !(await p.locator(".aio-probe").innerText()).includes(ORIGIN),
  );
  await shot(p, "signin-probe");
  // A search that fails shows red, in words, and the catalogs still show.
  jf.sourcesStatus = 500;
  await p.getByRole("button", { name: /Run Connection Test/ }).click();
  await p.waitForFunction(() => document.querySelectorAll(".aio-probe__row").length === 2 && document.querySelector(".aio-probe__row--bad"), null, { timeout: 15_000 }).catch(() => {});
  const bad = await p.$$eval(".aio-probe__row", (els) => els.map((e) => ({ bad: e.className.includes("--bad"), text: e.textContent })));
  check(
    "  a failing search is the second row in red, with what AIOStreams answered and no address",
    bad.length === 2 && !bad[0].bad && bad[1].bad && /answered 500/.test(bad[1].text) && !bad[1].text.includes(ORIGIN),
    JSON.stringify(bad.map((r) => r.text)),
  );
  jf.sourcesStatus = 200;

  // ------------------------------------------------------ Disconnect
  await row.getByRole("button", { name: "Disconnect", exact: true }).click();
  await row.getByRole("button", { name: /Click again to confirm/ }).click();
  const off = await p.getByRole("button", { name: "Connect", exact: true }).waitFor({ timeout: 6000 }).then(() => true, () => false);
  const dis = (await callsOf(p, "aiojf_disconnect")).length;
  check("Disconnect signs the device out: the address field is back, the sign-in is gone", off && dis === 1 && !(await storeOf(p, "aiojf"))?.signedIn, JSON.stringify({ off, dis, aiojf: await storeOf(p, "aiojf") }));
  await p.close();
}

// "Use a manifest URL instead" reveals today's field and its Connection Test.
{
  reset();
  const p = await openPage({});
  await toStreamTab(p);
  await p.getByRole("button", { name: "Use a manifest URL instead" }).click();
  const field = p.getByPlaceholder(MANIFEST_FIELD);
  await field.waitFor({ timeout: 5000 });
  check(
    "\"Use a manifest URL instead\" reveals the manifest field, as it always was",
    (await field.count()) === 1 && (await p.getByRole("button", { name: "Submit", exact: true }).count()) === 1 && (await p.getByRole("button", { name: "Use a manifest URL instead" }).count()) === 0,
  );
  await shot(p, "signin-manifest");
  await field.fill(MANIFEST_URL);
  await p.getByRole("button", { name: "Submit", exact: true }).click();
  await p.waitForFunction(() => document.querySelectorAll(".aio-probe__row").length >= 3, null, { timeout: 15_000 }).catch(() => {});
  const rows = await p.$$eval(".aio-probe__row", (els) => els.map((e) => e.textContent));
  check(
    "  Submit saves it and runs the manifest test: manifest, catalog, streams",
    (await storeOf(p, "aiostreams")) === MANIFEST_URL && rows.length === 3 && /Manifest.*OK, 3 catalogs/.test(rows[0]) && /Streams \(test title\).*OK/.test(rows[2]),
    JSON.stringify(rows),
  );
  check("  and none of it touched the sign-in", (await callsOf(p, "aiojf_disconnect")).length === 0 && (await callsOf(p, "aiojf_start")).length === 0);
  await p.close();
}

// ============================================================ D4
// A manifest stored, then a sign-in approved from Settings: the manifest goes,
// the sign-in stays, and nobody is signed out.
{
  reset();
  const p = await openPage({ manifest: true });
  await toStreamTab(p);
  check(
    "With a manifest stored and no sign-in, the manifest field is offered up front",
    (await p.getByPlaceholder(MANIFEST_FIELD).inputValue({ timeout: 5000 }).catch(() => "")) === MANIFEST_URL,
  );
  await addr(p).fill("aiostreams.example.com");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  const on = await p.locator(".aio-row .customize-row__title", { hasText: "Signed in as Adam" }).waitFor({ timeout: 14_000 }).then(() => true, () => false);
  await waitFor(p, async () => !(await storeOf(p, "aiostreams")), 4000);
  const stored = await storeOf(p, "aiostreams");
  check("D4: approving a sign-in deletes the stored manifest URL", on && !stored, JSON.stringify({ on, stored }));
  check(
    "  and signs nobody out: the sign-in is kept, and no disconnect went to the native side",
    (await storeOf(p, "aiojf"))?.signedIn?.base === BASE && (await callsOf(p, "aiojf_disconnect")).length === 0 && (await p.locator(".aio-row .customize-row__title", { hasText: "Signed in as Adam" }).count()) === 1,
    JSON.stringify({ signedIn: (await storeOf(p, "aiojf"))?.signedIn, disconnects: (await callsOf(p, "aiojf_disconnect")).length }),
  );
  check("  the manifest field goes from the screen with it", (await p.getByPlaceholder(MANIFEST_FIELD).count()) === 0);
  await p.close();
}
// Connected already at launch (a plan 023 user): the first status read
// records the sign-in, drops the manifest, and Settings shows it signed in.
{
  reset();
  const p = await openPage({ connected: true, manifest: true });
  const gone = await waitFor(p, async () => !(await storeOf(p, "aiostreams")), 15_000);
  const kept = await waitFor(p, async () => (await storeOf(p, "aiojf"))?.signedIn?.base === BASE, 5000);
  check("D4: an account connected before this build loses its manifest URL at launch, and keeps its sign-in", gone && kept, JSON.stringify({ aio: await storeOf(p, "aiostreams"), aiojf: await storeOf(p, "aiojf") }));
  check("  without a disconnect", (await callsOf(p, "aiojf_disconnect")).length === 0);
  await toStreamTab(p);
  await p.locator(".aio-row .customize-row__title", { hasText: "Signed in as Adam" }).waitFor({ timeout: 8000 });
  // The next load: Stream's rows are the instance's views, with no manifest to fall back on.
  await p.reload({ waitUntil: "domcontentloaded" });
  const rowsUp = await p.locator(".media-row__title", { hasText: /^Trending Movies$/ }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
  check("  and Stream's rows come from the sign-in on the next load: the instance's views", rowsUp && calls.some((c) => c.path === "/UserViews"));
  await p.close();
}

// ============================================================ other builds
// Connected, on a native build from before aiojf_sources: it cannot browse by
// the sign-in, so it says so, keeps its manifest, and still offers the field.
{
  reset();
  const p = await openPage({ connected: true, noSources: true, manifest: true });
  await toStreamTab(p);
  const row = p.locator(".aio-row");
  await row.locator(".customize-row__title", { hasText: "Signed in as Adam" }).waitFor({ timeout: 8000 });
  const text = (await row.innerText()).replace(/\n/g, " | ");
  check("A connected build that cannot open sources says \"Update BlammyTV to browse with your sign-in.\"", /Update BlammyTV to browse with your sign-in\./.test(text), text);
  check(
    "  keeps the manifest path: the field is there, holding the URL, and the manifest is not deleted",
    (await p.getByPlaceholder(MANIFEST_FIELD).inputValue()) === MANIFEST_URL && (await storeOf(p, "aiostreams")) === MANIFEST_URL && !(await storeOf(p, "aiojf"))?.signedIn,
  );
  check(
    "  and still offers Sync now and Disconnect",
    (await row.getByRole("button", { name: "Sync now" }).count()) === 1 && (await row.getByRole("button", { name: "Disconnect", exact: true }).count()) === 1,
  );
  await shot(p, "signin-cannot-source");
  // Changing the URL leaves the sign-in alone (plan 023 signed out here).
  await p.getByPlaceholder(MANIFEST_FIELD).fill(MANIFEST_URL + "?x=1");
  await p.getByRole("button", { name: "Submit", exact: true }).click();
  await p.waitForTimeout(800);
  check(
    "  changing the URL later leaves the sign-in alone",
    (await callsOf(p, "aiojf_disconnect")).length === 0 && (await row.locator(".customize-row__title", { hasText: "Signed in as Adam" }).count()) === 1,
  );
  await p.close();
}
// A native build from before the sign-in: the manifest field, and a word.
{
  reset();
  const p = await openPage({ old: true });
  await toStreamTab(p);
  await p.getByPlaceholder(MANIFEST_FIELD).waitFor({ timeout: 8000 });
  check(
    "A native build from before the sign-in offers the manifest field and says it needs the update",
    (await addr(p).count()) === 0 && (await p.getByRole("button", { name: "Connect", exact: true }).count()) === 0 && /needs the latest BlammyTV/.test(await p.locator(".settings-section").first().innerText()),
  );
  await p.close();
}

// A native build with the sync but not aiojf_sources (plan 023's): its
// `aiojf_start` refuses a plain address, so a new sign-in is not offered on it
// (onboarding gates the same way). The manifest field is, with the update line.
{
  reset();
  const p = await openPage({ noSources: true });
  await toStreamTab(p);
  await p.getByPlaceholder(MANIFEST_FIELD).waitFor({ timeout: 8000 }).catch(() => {});
  const text = (await p.locator(".settings-section").first().innerText()).replace(/\n/g, " | ");
  check(
    "A build that has the sync but cannot open sources offers no address sign-in, signed out: the manifest field, and the update line",
    (await addr(p).count()) === 0 &&
      (await p.getByRole("button", { name: "Connect", exact: true }).count()) === 0 &&
      (await p.locator(".aio-row").count()) === 0 &&
      /needs the latest BlammyTV/.test(text),
    text,
  );
  await p.close();
}

// ============================================================ sign-in failures
{
  reset();
  const p = await openPage({ start: "unsupported" });
  await toStreamTab(p);
  await addr(p).fill("aiostreams.example.com");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  const said = await p.getByText(/needs version 2\.35 or later, with its Jellyfin side on/).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("An instance with no Jellyfin side says it needs 2.35 with the Jellyfin side on, and the manifest still works", said && /A manifest URL still works\./.test(await p.locator(".settings-section").first().innerText()));
  check("  and the address stays for another try", (await addr(p).inputValue()) === "aiostreams.example.com");
  await p.close();
}
{
  reset();
  const p = await openPage({ start: "bad" });
  await toStreamTab(p);
  await addr(p).fill("not an address");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  const said = await p.getByText("That doesn't look like an AIOStreams address.").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("An address the native side refuses is said plainly", said);
  await p.close();
}
{
  reset();
  const p = await openPage({ poll: "expire" });
  await toStreamTab(p);
  await addr(p).fill("aiostreams.example.com");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  await p.locator(".aio-row .trakt-row__code").waitFor({ timeout: 5000 });
  const said = await p.getByText("The code ran out. Connect again for a new one.").waitFor({ timeout: 8000 }).then(() => true, () => false);
  check("An expired code says so and offers Connect again", said && (await p.getByRole("button", { name: "Connect", exact: true }).count()) === 1);
  await p.close();
}
{
  // Cancel stops the attempt: a poll that answers after it changes nothing.
  reset();
  const p = await openPage({});
  await toStreamTab(p);
  await addr(p).fill("aiostreams.example.com");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  await p.locator(".aio-row .trakt-row__code").waitFor({ timeout: 5000 });
  await p.getByRole("button", { name: "Cancel", exact: true }).click();
  const polls0 = (await callsOf(p, "aiojf_poll")).length;
  await p.waitForTimeout(7000);
  check(
    "Cancel returns to the address field and the polling stops",
    (await addr(p).count()) === 1 && (await callsOf(p, "aiojf_poll")).length === polls0 && !(await storeOf(p, "aiojf"))?.signedIn,
    `${polls0} polls at Cancel, ${(await callsOf(p, "aiojf_poll")).length} after`,
  );
  await p.close();
}

// ============================================================ Stream's empty state
{
  reset();
  const p = await openPage({});
  const note = p.locator(".stream__note");
  await note.waitFor({ timeout: 20_000 });
  const text = (await note.innerText()).replace(/\n/g, " | ");
  check(
    "With no connection, Stream's empty state points at signing in",
    /Sign in to your AIOStreams in Settings → Sources → Stream/.test(text) && !/manifest/i.test(text),
    text,
  );
  await p.close();
}

check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
