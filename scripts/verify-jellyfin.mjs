// E2E: your own Jellyfin server (plan 027), against scripts/fake-jellyfin.mjs on
// :8196 (Jellyfin 12.2's real shapes). The page's jf commands (jf.rs in the
// app) are stubbed to forward to the fake from THIS process, the way
// verify-aiojf stubs aiojf_request: jf.rs's own tests cover the token, the
// header, the guard and the stream check; this covers what the app does with
// the server's answers. The token lives in this process and nowhere in the
// page, which a check asserts of everything the page stores or shows.
//
// - Settings → Sources → Stream → Jellyfin: a wrong password says so, a right
//   one shows who is signed in, Quick Connect shows a code and notices the
//   approval, Disconnect (two presses) revokes on the server, an older native
//   build says it needs the update.
// - Stream, no AIOStreams: the libraries are rows (no "sign in to AIOStreams"
//   card), a show opens its episodes, an episode lists the server's files,
//   and playing one opens the direct stream with no token in the address, after
//   the stream check. The Continue Watching entry says it was played from
//   Jellyfin, and resumes from there. A film the same.
// - With AIOStreams signed in too (fake-aio on :8084): both sets of rows, and
//   a title from a Jellyfin row never asks the addon for streams.
// - Clear All Login Info signs out, and takes the catalog mirror and the ids.
//
// Offline, as every harness is: every host but localhost is aborted.
//
//   (vite on :4173; scripts/fake-jellyfin.mjs on :8196; scripts/fake-aio.mjs on :8084)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-jellyfin.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PORT = Number(process.env.FAKE_JELLYFIN_PORT || 8196);
const FAKE = `http://localhost:${PORT}`;
const AIO = "http://localhost:8084/manifest.json";
const FIX = JSON.parse(readFileSync(new URL("./fixtures/jellyfin-12.2.json", import.meta.url), "utf8"));
const EP3 = FIX.episodeIds[2];
const MOVIE = FIX.movieId;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const fake = async (path, init) => (await fetch(FAKE + path, init)).json();
const faked = () => fake("/__log");

// ------------------------------------------------- the native side, in node
// What jf.rs does, as far as the page can tell: it holds the session, sends
// the token as a header, answers a 4xx as data, drops the token on a 401.
function makeNative(o) {
  const st = { token: null, user: null, secret: null, calls: [], prepared: [] };
  const hdr = () => ({ authorization: `MediaBrowser Token="${st.token}"`, "content-type": "application/json" });
  const status = () =>
    st.token
      ? { connected: true, userName: st.user.Name, userId: st.user.Id, base: FAKE, serverName: "Fake Jellyfin", version: "12.2.0" }
      : { connected: false };
  const call = (method, path, query, body, auth = true) => {
    const q = query ? "?" + new URLSearchParams(query) : "";
    return fetch(FAKE + path + q, {
      method,
      headers: auth ? hdr() : { "content-type": "application/json" },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
  };
  const adopt = (r) => {
    st.token = r.AccessToken;
    st.user = r.User;
  };
  async function run(cmd, args) {
    st.calls.push([cmd, args]);
    if (o.old) throw `Command ${cmd} not found`;
    switch (cmd) {
      case "jf_status":
        return status();
      case "jf_sign_in": {
        const r = await call("POST", "/Users/AuthenticateByName", null, { Username: args.user, Pw: args.password }, false);
        if (r.status === 401) throw "denied: the server refused that user name or password";
        adopt(await r.json());
        return status();
      }
      case "jf_quick_connect": {
        const r = await (await call("POST", "/QuickConnect/Initiate", null, null, false)).json();
        st.secret = r.Secret;
        return { code: r.Code, serverName: "Fake Jellyfin" };
      }
      case "jf_poll": {
        const r = await (await call("GET", "/QuickConnect/Connect", { secret: st.secret }, null, false)).json();
        if (!r.Authenticated) return "pending";
        adopt(await (await call("POST", "/Users/AuthenticateWithQuickConnect", null, { Secret: st.secret }, false)).json());
        return "approved";
      }
      case "jf_request": {
        if (!st.token) throw "unauthorized: not signed in";
        const r = await call(args.method, args.path, args.query, args.body);
        if (r.status === 401) st.token = null;
        return { status: r.status, body: await r.text() };
      }
      case "jf_sources": {
        const r = await call("POST", `/Items/${args.itemId}/PlaybackInfo`, null, {});
        if (r.status !== 200) return { status: r.status, sources: [] };
        const j = await r.json();
        return { status: 200, sources: j.MediaSources.map(({ Path: _path, ...s }) => s), playSessionId: j.PlaySessionId };
      }
      case "jf_prepare_stream":
        st.prepared.push(args.url);
        return { ok: true, needsAuth: false, status: 206, offOrigin: false };
      case "jf_disconnect": {
        const was = !!st.token;
        if (was) await call("POST", "/Sessions/Logout");
        st.token = null;
        return true;
      }
      default:
        return undefined;
    }
  }
  return { st, run };
}

// ----------------------------------------------------------- the page
const stub = ({ o }) => {
  window.__calls = [];
  window.__pos = 600;
  window.__dur = 6000;
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: async (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd.startsWith("jf_")) {
        const r = JSON.parse(await window.__jfNative(cmd, JSON.stringify(args ?? null)));
        if (r.err !== undefined) throw r.err;
        return r.ok;
      }
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "mpv_status")
        return JSON.stringify({ pos: window.__pos, dur: window.__dur, presenting: true, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] });
      return undefined;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
  if (o.aio) localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: o.aio }));
  if (o.signedIn)
    localStorage.setItem(
      "blammytv.jellyfin",
      JSON.stringify({ v: 1, data: { signedIn: { base: o.signedIn.base, userName: o.signedIn.userName, userId: o.signedIn.userId, serverName: "Fake Jellyfin" } } }),
    );
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
/** A page in a context of its own: each scenario starts from what it seeds.
 * `o.signed` has the native side hold a session already (and the page's own
 * record of it, as a launch after a sign-in would find). */
async function openPage(o = {}) {
  const native = makeNative(o);
  if (o.signed) {
    const r = await (await fetch(FAKE + "/Users/AuthenticateByName", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Username: FIX.user.Name, Pw: "pw" }) })).json();
    native.st.token = r.AccessToken;
    native.st.user = r.User;
  }
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.logs = [];
  p.on("console", (m) => p.logs.push(m.text()));
  p.requests = [];
  p.on("request", (r) => p.requests.push(r.url()));
  p.native = native;
  await p.exposeFunction("__jfNative", async (cmd, args) => {
    try {
      return JSON.stringify({ ok: await native.run(cmd, JSON.parse(args)) });
    } catch (e) {
      return JSON.stringify({ err: String(e) });
    }
  });
  await p.addInitScript(stub, {
    o: { ...o, signedIn: o.signed ? { base: FAKE, userName: FIX.user.Name, userId: FIX.user.Id } : null },
  });
  await p.goto(APP, { waitUntil: "domcontentloaded" });
  return p;
}
const storeOf = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const waitFor = async (p, fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(200);
  }
  return false;
};
const openSettings = async (p) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 15_000 });
  await p.locator(".settings__body").first().waitFor({ timeout: 10_000 });
};
const openStreamTab = async (p) => {
  await openSettings(p);
  await p.getByRole("tab", { name: "Sources", exact: true }).click();
  await p.locator(".customize-rail").getByRole("tab", { name: "Stream", exact: true }).click();
  await p.locator(".settings-section").first().waitFor({ timeout: 10_000 });
};
const section = (p) => p.locator('[data-setting="jellyfin"]');
/** Everything the page keeps or shows, as one string, to look for the token in. */
const everything = (p) =>
  p.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, dom: document.body.innerText, calls: window.__calls }));
const opens = (p) => p.evaluate(() => window.__calls.filter(([c]) => c === "inv_open").map(([, a]) => a.url));

// ============================================================= Settings
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({});
  await openStreamTab(p);
  const s = section(p);
  await s.waitFor({ timeout: 10_000 });
  check("Settings → Sources → Stream has a Jellyfin section beside AIOStreams", (await s.count()) === 1 && /Server address/.test(await s.innerText()));

  await s.getByLabel("Server address").fill(`localhost:${PORT}`);
  await s.getByLabel("User name").fill(FIX.user.Name);
  await s.getByLabel("Password").fill("not-the-password");
  await s.getByRole("button", { name: "Sign in", exact: true }).click();
  const denied = await waitFor(p, async () => /Wrong user name or password/.test(await s.innerText()));
  check("a wrong password says so, and signs in to nothing", denied && !p.native.st.token && (await storeOf(p, "jellyfin"))?.signedIn == null);

  await s.getByLabel("Password").fill("pw");
  await s.getByRole("button", { name: "Sign in", exact: true }).click();
  const signedIn = await waitFor(p, async () => new RegExp(`Signed in as ${FIX.user.Name}`).test(await s.innerText()));
  const rec = await storeOf(p, "jellyfin");
  check("the right one shows who is signed in", signedIn, await s.innerText());
  check("  and the page keeps who and where, no more", rec?.signedIn?.base === FAKE && rec.signedIn.userName === FIX.user.Name && !("token" in rec.signedIn), JSON.stringify(rec));
  const tok = p.native.st.token;
  check("  the token is nowhere the page can see: not stored, not shown, not in a call", !!tok && !(await everything(p)).includes(tok));
  // The password was in the one sign-in call (the stub's own record of it);
  // what the page stores or shows must not hold it, and its field is gone.
  const kept = await p.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, dom: document.body.innerText }));
  check("  the password is not kept either: not stored, not on screen", !kept.includes('"pw"') && !kept.includes('pw"') && (await s.getByLabel("Password").count()) === 0);

  const btn = s.getByRole("button", { name: "Disconnect", exact: true });
  await btn.click();
  check("Disconnect asks twice", (await s.getByRole("button", { name: /Click again to confirm/ }).count()) === 1 && !!p.native.st.token);
  await s.getByRole("button", { name: /Click again to confirm/ }).click();
  const out = await waitFor(p, async () => (await s.getByLabel("Server address").count()) === 1);
  const state = await fake("/__state");
  check("  then signs out here and on the server", out && !p.native.st.token && state.tokens === 0 && (await storeOf(p, "jellyfin"))?.signedIn == null, JSON.stringify(state));

  // Quick Connect.
  await s.getByLabel("Server address").fill(`localhost:${PORT}`);
  await s.getByRole("button", { name: "Use Quick Connect", exact: true }).click();
  const code = await waitFor(p, async () => /\b\d{3}\s?\d{3}\b|\b\d{6}\b/.test(await s.innerText()));
  const shown = (await s.innerText()).match(/\d{3}\s?\d{3}|\d{6}/)?.[0]?.replace(/\s/g, "");
  check("Quick Connect shows the six digit code to type into Jellyfin", code && /^\d{6}$/.test(shown ?? ""), await s.innerText());
  await fake(`/__approve?code=${shown}`);
  const approved = await waitFor(p, async () => new RegExp(`Signed in as ${FIX.user.Name}`).test(await s.innerText()), 15_000);
  check("  and notices the approval on its own", approved && !!p.native.st.token);
  await p.context().close();
}
{
  const p = await openPage({ old: true });
  await openStreamTab(p);
  const s = section(p);
  await s.waitFor({ timeout: 10_000 });
  check("a native build from before it says it needs the update, and offers no form", /latest BlammyTV/.test(await s.innerText()) && (await s.getByLabel("Server address").count()) === 0);
  await p.context().close();
}

// ======================================================= Stream, Jellyfin alone
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await p.locator(".media-row__title", { hasText: /^Movies$/ }).first().waitFor({ timeout: 15_000 });
  const titles = await p.locator(".media-row__title").allInnerTexts();
  check("the libraries are rows on Stream, with no AIOStreams signed in", titles.includes("Movies") && titles.includes("Shows") && (await p.getByText("Sign in to your AIOStreams").count()) === 0, JSON.stringify(titles));
  const names = await p.locator(".stream-card__name").allInnerTexts();
  check("  with your titles on them", ["The Turn", "Severance", "Zzz Test Show"].every((n) => names.includes(n)), JSON.stringify(names));
  const log = await faked();
  check(
    "  every list call carries an item type (no folders), and none carried a credential in the query",
    log.filter((c) => c.path === "/Items").every((c) => /Movie|Series/.test(c.query.IncludeItemTypes ?? "")) && log.every((c) => !Object.keys(c.query).some((k) => /^(api_?key|token)$/i.test(k))),
    JSON.stringify(log.filter((c) => c.path === "/Items").map((c) => c.query.IncludeItemTypes)),
  );
  check("  the page asked for nothing from AIOStreams", !p.requests.some((u) => u.includes(":8084")));

  // A show, its episodes, an episode's files.
  await p.locator('.stream-card[data-hint="Severance"]').first().click({ timeout: 10_000 });
  await p.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  const eps = await p.locator(".episode-card").count();
  check("a show opens its episodes from the server", eps === 3, `${eps} episodes`);
  await p.locator(".episode-card").nth(2).click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const lines = await p.locator(".vod-source").first().innerText();
  check("an episode lists the server's file: its picture and its container", /720p|1080p|480p|\d+p/.test(lines) && /MKV|MP4/i.test(lines), lines);
  const pb = (await faked()).filter((c) => c.path === `/Items/${EP3}/PlaybackInfo`);
  check("  asked of the right episode", pb.length >= 1, JSON.stringify(pb.map((c) => c.path)));

  await p.locator(".vod-source").first().click();
  const started = await waitFor(p, async () => (await opens(p)).length > 0, 15_000);
  const url = (await opens(p))[0] ?? "";
  check(
    "playing it opens the direct stream, whole file, no token in the address",
    started && url.startsWith(`${FAKE}/Videos/${EP3}/stream?static=true&mediaSourceId=`) && !/api_?key|token|Token/i.test(url),
    url,
  );
  check("  the stream was checked before it was opened", p.native.st.prepared.length >= 1 && p.native.st.prepared[0] === url);
  check("  and the token is still only here", !(await everything(p)).includes(p.native.st.token));

  const cw = await storeOf(p, "watching");
  const e = cw?.find((x) => x.id === "tt11280740");
  check(
    "Continue Watching keeps it, and that it came from Jellyfin",
    e?.from === "jf" && e.episodeId === "tt11280740:1:3" && e.season === 1 && e.episode === 3 && e.title === "Severance",
    JSON.stringify(e),
  );
  check("  and AIOStreams' sync is not told (a play that is not its)", !p.logs.some((l) => l.startsWith("[aiojf]")));

  // Leave and resume it from the card: the server is asked again, not an addon.
  await p.evaluate(() => (window.__pos = 300));
  await p.waitForTimeout(6000); // the 5s progress tick
  const ov = await p.locator(".theater-overlay").first().boundingBox();
  await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await p.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await p.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await p.waitForTimeout(1500);
  await goTo(p, "home");
  const card = p.locator(".continue-card", { hasText: "Severance" }).first();
  await card.waitFor({ timeout: 10_000 });
  const before = (await opens(p)).length;
  const asks = (await faked()).filter((c) => c.path === `/Items/${EP3}/PlaybackInfo`).length;
  await card.click();
  const again = await waitFor(p, async () => (await opens(p)).length > before, 15_000);
  const asksAfter = (await faked()).filter((c) => c.path === `/Items/${EP3}/PlaybackInfo`).length;
  check("resuming from the card plays the same episode from Jellyfin", again && (await opens(p)).at(-1).includes(`/Videos/${EP3}/stream`), (await opens(p)).at(-1));
  check("  by asking the server for its files again", asksAfter > asks, `${asks} to ${asksAfter}`);
  const resumed = await p.evaluate(() => window.__calls.filter(([c]) => c === "inv_open").at(-1)[1].start);
  check("  at the position it left off (3 seconds back)", resumed === 297, String(resumed));
  await p.context().close();
}

// ----------------------------------------------------------- a film
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await p.locator('.stream-card[data-hint="The Turn"]').first().waitFor({ timeout: 15_000 });
  await p.locator('.stream-card[data-hint="The Turn"]').first().click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const detail = await p.locator(".vod-detail").first().innerText();
  check("a film opens its page with the server's file", (await p.locator(".vod-source").count()) >= 1, detail.slice(0, 120));
  await p.locator(".vod-source").first().click();
  const started = await waitFor(p, async () => (await opens(p)).length > 0, 15_000);
  const url = (await opens(p))[0] ?? "";
  check("playing it opens its direct stream", started && url.startsWith(`${FAKE}/Videos/${MOVIE}/stream?static=true&mediaSourceId=`), url);
  const cw = await storeOf(p, "watching");
  check("  and Continue Watching has it as a film from Jellyfin", cw?.[0]?.id === "tt2043923" && cw[0].from === "jf" && cw[0].kind === "movie", JSON.stringify(cw?.[0]));
  await p.context().close();
}

// ======================================================= AIOStreams too
await fake("/__reset", { method: "POST" });
// The fake addon serves Action, Comedy and Drama movies: give the film one of
// them, so a More Like This strip would have something to show.
await fake(`/__genres/${MOVIE}?names=Action`, { method: "POST" });
{
  const p = await openPage({ signed: true, aio: AIO });
  await p.locator(".media-row__title", { hasText: /^Movies$/ }).first().waitFor({ timeout: 20_000 });
  await p.locator(".media-row__title", { hasText: /^Top Movies$/ }).first().waitFor({ timeout: 20_000 });
  const titles = await p.locator(".media-row__title").allInnerTexts();
  check("both sets of rows show, the addon's first", titles.indexOf("Top Movies") >= 0 && titles.indexOf("Movies") > titles.indexOf("Top Movies"), JSON.stringify(titles));
  const streamAsks = () => p.requests.filter((u) => u.includes(":8084/") && u.includes("/stream/"));
  // The control: an addon title does ask the addon, and gets a More Like This.
  await p.locator(".media-row", { has: p.locator(".media-row__title", { hasText: /^Top Movies$/ }) }).locator(".stream-card").first().click({ timeout: 10_000 });
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  const control = await waitFor(p, async () => (await p.locator(".vod-more").count()) > 0, 10_000);
  check("(control) an addon title asks the addon for streams, and has its More Like This strip", streamAsks().length > 0 && control, JSON.stringify(streamAsks()));
  await p.locator(".vod-back").first().click();
  await goTo(p, "home");
  const asked = streamAsks().length;
  // A film from a Jellyfin row: its own file, nothing from the addon.
  await p.locator('.stream-card[data-hint="The Turn"]').first().click({ timeout: 10_000 });
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await p.waitForTimeout(2500);
  const lines = await p.locator(".vod-source").allInnerTexts();
  check("a film from a Jellyfin row never asks the addon for streams, and lists the server's file", streamAsks().length === asked && lines.length >= 1 && /MKV|MP4/i.test(lines[0]), JSON.stringify({ asked, now: streamAsks().length, lines }));
  check("  and gets no More Like This from the addon's catalogs", (await p.locator(".vod-more").count()) === 0);
  await p.locator(".vod-back").first().click();
  await goTo(p, "home");
  // An episode of a show from a Jellyfin row: the same.
  await p.locator('.stream-card[data-hint="Severance"]').first().click({ timeout: 10_000 });
  await p.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  await p.locator(".episode-card").nth(0).click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  check("  nor does one of its episodes", streamAsks().length === asked && (await p.locator(".vod-source").count()) >= 1, JSON.stringify(streamAsks()));
  await p.context().close();
}

// ================================================ Clear All Login Info
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await p.locator(".media-row__title", { hasText: /^Movies$/ }).first().waitFor({ timeout: 15_000 });
  check("the build is mirrored for the next launch, with the ids it named", !!(await storeOf(p, "jfVodCache")) && !!(await storeOf(p, "jfIds")));
  await openSettings(p);
  await p.getByRole("tab", { name: "App", exact: true }).click();
  const clear = p.locator('[data-setting="clear-logins"]').getByRole("button");
  await clear.scrollIntoViewIfNeeded();
  await clear.click();
  await clear.click();
  const signedOut = await waitFor(p, async () => !p.native.st.token && (await storeOf(p, "jellyfin"))?.signedIn == null);
  const state = await fake("/__state");
  check("Clear All Login Info signs out of Jellyfin, here and on the server", signedOut && state.tokens === 0, JSON.stringify(state));
  check("  and takes what was read from it: the mirror and the ids", (await storeOf(p, "jfVodCache")) == null && (await storeOf(p, "jfIds")) == null);
  await p.context().close();
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
