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
// - Discover, with and without AIOStreams: the libraries are in the grid and
//   the genre rail, a genre asks the server for that genre, a search finds
//   your titles, and a card opens the server's file with no addon asked.
// - Continue Watching: a card cleared after a play, with no sync since, still
//   resets the server's position (the play itself names the item).
// - With only a Jellyfin signed in, Settings → Playback and Appearance show
//   Stream's rows (Carousel Catalogs, which picks AIOStreams catalogs, stays
//   out) and Ctrl+K has Stream's places; with nothing signed in, neither.
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
  const st = { token: null, user: null, secret: null, calls: [], prepared: [], subs: [] };
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
      case "jf_set_subtitles":
        st.subs.push(...args.entries);
        return args.entries.reduce((n, e) => n + e.subtitles.length, 0);
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
const closeSettings = async (p) => {
  await p.keyboard.press("Escape");
  await p.locator(".settings__body").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
};
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
  check("Settings → Sources → Stream has a Jellyfin section beside AIOStreams", (await s.count()) === 1 && /Server Address/.test(await s.innerText()));

  check("  and says which Jellyfin it was tested on", /Tested on Jellyfin 12\.x/.test(await s.innerText()));
  const plain = async (addr) => {
    await s.getByLabel("Server address").fill(addr);
    return (await s.locator("[data-jf-plain]").count()) === 1;
  };
  check("an address that goes over plain http to another machine says it is not encrypted", (await plain("192.168.1.20:8096")) && /not encrypted/.test(await s.locator("[data-jf-plain]").innerText()));
  check("  and one to an https name, or to this PC, says nothing", !(await plain("jellyfin.example.com")) && !(await plain("https://192.168.1.20:8920")) && !(await plain(`localhost:${PORT}`)) && !(await plain("127.0.0.1")));

  await s.getByLabel("Server address").fill(`localhost:${PORT}`);
  await s.getByLabel("User name").fill(FIX.user.Name);
  await s.getByLabel("Password").fill("not-the-password");
  await s.getByRole("button", { name: "Sign In", exact: true }).click();
  const denied = await waitFor(p, async () => /Wrong user name or password/.test(await s.innerText()));
  check("a wrong password says so, and signs in to nothing", denied && !p.native.st.token && (await storeOf(p, "jellyfin"))?.signedIn == null);

  await s.getByLabel("Password").fill("pw");
  await s.getByRole("button", { name: "Sign In", exact: true }).click();
  const signedIn = await waitFor(p, async () => new RegExp(`Signed In as ${FIX.user.Name}`).test(await s.innerText()));
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
  check("Disconnect asks twice", (await s.getByRole("button", { name: /Click Again to Confirm/ }).count()) === 1 && !!p.native.st.token);
  await s.getByRole("button", { name: /Click Again to Confirm/ }).click();
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
  const approved = await waitFor(p, async () => new RegExp(`Signed In as ${FIX.user.Name}`).test(await s.innerText()), 15_000);
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
  check("the libraries are rows on Stream, with no AIOStreams signed in", titles.includes("Movies") && titles.includes("Shows") && (await p.getByText("Sign in to AIOStreams or Jellyfin").count()) === 0, JSON.stringify(titles));
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
  const subsFor = p.native.st.subs.find((e) => e.streamUrl === url);
  check(
    "  and native was told the .srt that sits beside it: its index and name, no address of its own",
    subsFor?.subtitles?.length === 1 && subsFor.subtitles[0].index === 0 && /English/.test(subsFor.subtitles[0].title) && subsFor.subtitles[0].language === "eng" && !JSON.stringify(p.native.st.subs).match(/Subtitles\/|api_?key|token/i),
    JSON.stringify(p.native.st.subs).slice(0, 300),
  );
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

// ============================================================ Discover
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await goTo(p, "discover");
  const names = () => p.locator(".disc-grid .stream-card__name").allInnerTexts();
  const shown = await waitFor(p, async () => (await names()).length > 0, 20_000);
  const ns = await names();
  check("Discover with only a Jellyfin: its titles are the grid, with no sign-in card", shown && ns.includes("The Turn") && ns.includes("Severance") && (await p.getByText("Sign in to AIOStreams or Jellyfin").count()) === 0, JSON.stringify(ns));
  const rail = await p.locator(".genre-card__name").allInnerTexts();
  check("  and the genre rail is the genres its titles carry", rail.includes("Documentary") && rail.includes("Drama") && rail.includes("Mystery"), JSON.stringify(rail));
  check("  with nothing asked of AIOStreams", !p.requests.some((u) => u.includes(":8084")));

  // A genre is the server's filter: only that genre's titles come back. And a
  // genre is rows now (plan 034, 1.0.30), so they are read from the rows, once
  // each (a title can be in more than one).
  const rowNames = () => p.locator(".genre-rows .stream-card__name").allInnerTexts().then((n) => [...new Set(n)]);
  await p.locator(".genre-card", { hasText: /^Documentary$/ }).click();
  const filtered = await waitFor(p, async () => {
    const n = await rowNames();
    return n.length === 1 && n[0] === "The Turn";
  }, 15_000);
  const asked = p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.path === "/Items" && a.query?.Genres === "Documentary");
  check("a genre card asks the server for that genre and shows only its titles", filtered && asked.length >= 1, JSON.stringify(await rowNames()));
  await p.locator(".genre-card--on").click();
  await waitFor(p, async () => (await names()).length >= 2);

  // Search: the server finds it, beside whatever the addon would.
  await p.locator(".navcap__searchinput").fill("sever");
  const found = await waitFor(p, async () => (await p.locator(".disc-grid .stream-card", { hasText: "Severance" }).count()) > 0, 15_000);
  const searched = p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.path === "/Items" && a.query?.SearchTerm === "sever");
  check("a search finds your title, asking the server across its libraries", found && searched.length >= 1 && searched.every(([, a]) => !("ParentId" in a.query)), JSON.stringify(searched.map(([, a]) => a.query?.IncludeItemTypes)));
  await p.locator(".navcap__searchinput").fill("");

  // A card from Discover opens the server's own file.
  await waitFor(p, async () => (await p.locator(".disc-grid .stream-card", { hasText: "The Turn" }).count()) > 0);
  await p.locator(".disc-grid .stream-card", { hasText: "The Turn" }).first().click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await p.waitForTimeout(1500);
  const lines = await p.locator(".vod-source").allInnerTexts();
  check("a card from Discover opens the server's file", lines.length >= 1 && /MKV|MP4/i.test(lines[0]), JSON.stringify(lines));
  await p.context().close();
}
{
  // With AIOStreams too: the addon's genres lead the rail, the server's follow,
  // and both sources' titles are in the grid.
  const p = await openPage({ signed: true, aio: AIO });
  await goTo(p, "discover");
  const names = () => p.locator(".disc-grid .stream-card__name").allInnerTexts();
  await waitFor(p, async () => (await names()).includes("The Turn"), 20_000);
  const rail = await p.locator(".genre-card__name").allInnerTexts();
  const ns = await names();
  const addonTitle = ns.find((n) => /Fake|Iron|Top/i.test(n));
  check("Discover with both: the grid has the server's titles and the addon's", ns.includes("The Turn") && !!addonTitle && addonTitle !== "The Turn", JSON.stringify(ns.slice(0, 12)));
  check("  and the rail is the addon's genres, then the ones only the server's titles have", rail.indexOf("Documentary") > rail.indexOf("Drama") && rail.includes("Mystery"), JSON.stringify(rail));
  // The addon is signed in here, so a Jellyfin card that lost its mark would ask it.
  const streamAsks = () => p.requests.filter((u) => u.includes(":8084/") && u.includes("/stream/"));
  const before = streamAsks().length;
  // From the genre's own page (a read of the server), not Stream's cached rows.
  const rowNames = () => p.locator(".genre-rows .stream-card__name").allInnerTexts().then((n) => [...new Set(n)]);
  await p.locator(".genre-card", { hasText: /^Documentary$/ }).click();
  await waitFor(p, async () => (await rowNames()).length === 1 && (await rowNames())[0] === "The Turn", 15_000);
  await p.locator(".genre-rows .stream-card", { hasText: "The Turn" }).first().click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await p.waitForTimeout(2500);
  const lines = await p.locator(".vod-source").allInnerTexts();
  check("a Jellyfin card in Discover opens the server's file and never asks the addon", streamAsks().length === before && lines.length >= 1 && /MKV|MP4/i.test(lines[0]), JSON.stringify({ before, now: streamAsks().length, lines }));
  await p.context().close();
}

// ============================================== Reporting what you watch
// A play from your Jellyfin is reported to it: a start, a progress report every
// ten seconds (paused when the position holds), and a stop with the real
// position. The app marks nothing played itself: the server keeps the position
// by its own rules, and a second device (a fresh page) finds it in Resume.
const TICKS = 10_000_000;
/** A call as the signed-in user, from this process: a way to be "the other app". */
const asUser = async (method, path, body) => {
  const a = await (await fetch(FAKE + "/Users/AuthenticateByName", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Username: FIX.user.Name, Pw: "pw" }) })).json();
  const h = { authorization: `MediaBrowser Token="${a.AccessToken}"`, "content-type": "application/json" };
  const r = await fetch(FAKE + path, { method, headers: h, ...(body != null ? { body: JSON.stringify(body) } : {}) });
  await fetch(FAKE + "/Sessions/Logout", { method: "POST", headers: h });
  return r;
};
const reports = async () => (await faked()).filter((c) => c.path.startsWith("/Sessions/Playing"));
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await p.locator('.stream-card[data-hint="Severance"]').first().click({ timeout: 15_000 });
  await p.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  await p.locator(".episode-card").nth(2).click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  // The episode is 600 seconds long: half way.
  await p.evaluate(() => ((window.__dur = 600), (window.__pos = 300)));
  await fake("/__log", { method: "DELETE" });
  await p.locator(".vod-source").first().click();
  await waitFor(p, async () => (await reports()).some((c) => c.path === "/Sessions/Playing"), 20_000);
  const start = (await reports()).find((c) => c.path === "/Sessions/Playing");
  await waitFor(p, async () => (await opens(p)).length > 0, 15_000);
  const url = (await opens(p))[0] ?? "";
  const src = new URL(url).searchParams.get("mediaSourceId");
  check(
    "a play starts a session on the server: the right item, the file it plays, its position",
    start?.body?.ItemId === EP3 && start.body.MediaSourceId === src && /^[0-9a-f]{32}$/.test(src ?? "") && start.body.PositionTicks === 300 * TICKS && start.body.PlayMethod === "DirectPlay",
    JSON.stringify(start?.body),
  );
  check("  under the play session the file lookup was given", typeof start?.body?.PlaySessionId === "string" && start.body.PlaySessionId.length > 8, JSON.stringify(start?.body?.PlaySessionId));
  await p.evaluate(() => (window.__pos = 330));
  await waitFor(p, async () => (await reports()).some((c) => c.path === "/Sessions/Playing/Progress"), 20_000);
  const prog = (await reports()).find((c) => c.path === "/Sessions/Playing/Progress");
  check("  and every ten seconds a progress report with where it is", prog?.body?.PositionTicks === 330 * TICKS && prog.body.IsPaused === false, JSON.stringify(prog?.body));
  // Still: a pause.
  const n0 = (await reports()).filter((c) => c.path === "/Sessions/Playing/Progress").length;
  await waitFor(p, async () => (await reports()).filter((c) => c.path === "/Sessions/Playing/Progress").length > n0, 20_000);
  const held = (await reports()).filter((c) => c.path === "/Sessions/Playing/Progress").at(-1);
  check("  a position that holds still is reported as paused", held?.body?.IsPaused === true && held.body.PositionTicks === 330 * TICKS, JSON.stringify(held?.body));
  // Leave.
  const ov = await p.locator(".theater-overlay").first().boundingBox();
  await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await p.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await p.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await waitFor(p, async () => (await reports()).some((c) => c.path === "/Sessions/Playing/Stopped"), 10_000);
  const stop = (await reports()).find((c) => c.path === "/Sessions/Playing/Stopped");
  check("leaving ends the session with the position it was left at", stop?.body?.ItemId === EP3 && stop.body.PositionTicks === 330 * TICKS, JSON.stringify(stop?.body));
  const all = await faked();
  check("  the app marked nothing played itself: the server's rules decide", !all.some((c) => c.path.startsWith("/UserPlayedItems")), JSON.stringify(all.filter((c) => c.path.startsWith("/UserPlayedItems"))));
  check("  and no report carried a credential in its address", (await reports()).every((c) => !Object.keys(c.query).some((k) => /^(api_?key|token)$/i.test(k))));
  const ud = (await fake("/__state")).ud[EP3];
  check("the server kept the position (half way is between its lines), and it is not played", ud?.PlaybackPositionTicks === 330 * TICKS && ud.Played === false, JSON.stringify(ud));
  await p.context().close();
}
{
  // Another app, a fresh page: it finds where you left off in Resume.
  const p = await openPage({ signed: true });
  const card = p.locator(".continue-card", { hasText: "Severance" }).first();
  await card.waitFor({ timeout: 20_000 });
  const cw = (await storeOf(p, "watching")) ?? [];
  const e = cw.find((x) => x.id === "tt11280740");
  check(
    "a fresh device finds the half-watched episode in Continue Watching, from Jellyfin, where it was left",
    e?.from === "jf" && e.episodeId === "tt11280740:1:3" && e.posSec === 330 && e.title === "Severance" && e.season === 1 && e.episode === 3,
    JSON.stringify(e),
  );
  check("  and Next Up does not list it twice (nothing is played yet)", (await p.locator(".media-row__title", { hasText: /^Next Up/ }).count()) === 0);
  await p.context().close();
}

// ======================================================= Syncing with the server
await fake("/__reset", { method: "POST" });
{
  // The other apps: episode 1 played, episode 3 half way.
  await asUser("POST", `/UserPlayedItems/${FIX.episodeIds[0]}`);
  await asUser("POST", `/UserItems/${EP3}/UserData`, { PlaybackPositionTicks: 120 * TICKS, Played: false });
  const p = await openPage({ signed: true });
  const card = p.locator(".continue-card", { hasText: "Severance" }).first();
  await card.waitFor({ timeout: 20_000 });
  const ws = await storeOf(p, "jfWatched");
  check("what the server says is played is ticked, in a store of its own", JSON.stringify(ws?.episodes) === JSON.stringify({ tt11280740: ["tt11280740:1:1"] }) && (ws?.films ?? []).length === 0, JSON.stringify(ws));
  check("  and none of it is in the ledger Trakt and MAL push", !(await storeOf(p, "watchedEpisodes"))?.tt11280740);
  const rowTitle = await p.locator(".media-row__title", { hasText: /^Next Up/ }).first().innerText();
  const row = p.locator(".media-row", { has: p.locator(".media-row__title", { hasText: /^Next Up/ }) }).first();
  const rowText = await row.innerText();
  check("Next Up is a row on the Stream home, with the next episode of the show you are on", rowTitle === "Next Up" && /Severance/.test(rowText) && /Half Loop/.test(rowText), rowText);
  const nx = p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.path === "/Shows/NextUp");
  check("  asked with EnableResumable off (a half-watched episode is Continue Watching's)", nx.length >= 1 && nx.every(([, a]) => a.query?.EnableResumable === "false"), JSON.stringify(nx.map(([, a]) => a.query)));
  // The show's page ticks what the server has as played.
  await row.locator(".stream-card").first().click();
  await p.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  const ticked = await p.locator(".episode-card", { has: p.locator(".episode-card__seen") }).allInnerTexts();
  check("the show's page ticks episode 1, and only it", ticked.length === 1 && /Good News About Hell/.test(ticked[0]), JSON.stringify(ticked));
  await p.locator(".vod-back").first().click();
  await goTo(p, "home");

  // Settings: the line and Sync now.
  await openStreamTab(p);
  const s = section(p);
  check("Settings says when it last synced", /Synced/.test(await s.innerText()), await s.innerText());
  check(
    "  and says clearing a Continue Watching card resets the server's position, never a played mark",
    /resets that item's position on your server/.test(await s.locator("[data-jf-clear]").innerText()) && /never removed/.test(await s.locator("[data-jf-clear]").innerText()),
  );
  const reads = () => p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.path === "/UserItems/Resume").length;
  const before = reads();
  await s.getByRole("button", { name: "Sync now" }).click();
  check("  and Sync now reads the server again", await waitFor(p, async () => reads() > before, 10_000));
  await closeSettings(p);

  // The other app un-marks it: the next sync un-ticks here.
  await asUser("DELETE", `/UserPlayedItems/${FIX.episodeIds[0]}`);
  await openStreamTab(p);
  await section(p).getByRole("button", { name: "Sync now" }).click();
  const unticked = await waitFor(p, async () => ((await storeOf(p, "jfWatched"))?.episodes?.tt11280740 ?? []).length === 0, 10_000);
  check("un-marking it on the server un-ticks it here at the next sync", unticked, JSON.stringify(await storeOf(p, "jfWatched")));
  await closeSettings(p);

  // Clearing the card clears the server's position, or the next sync brings it back.
  const cardNow = p.locator(".continue-card", { hasText: "Severance" }).first();
  await cardNow.waitFor({ timeout: 10_000 });
  await cardNow.focus();
  await p.keyboard.press("Delete");
  const posts = () => p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.method === "POST" && a.path === `/UserItems/${EP3}/UserData`);
  await waitFor(p, async () => posts().length > 0, 8000);
  const body = posts()[0]?.[1]?.body;
  check("clearing the card resets the server's position for that episode", body?.PlaybackPositionTicks === 0 && body.Played === false, JSON.stringify(body));
  check("  and the server took it", (await fake("/__state")).ud[EP3]?.PlaybackPositionTicks === 0);
  await openStreamTab(p);
  const r0 = reads();
  await section(p).getByRole("button", { name: "Sync now" }).click();
  await waitFor(p, async () => reads() > r0, 10_000);
  await p.waitForTimeout(800);
  await closeSettings(p);
  check("a cleared card stays gone after the next sync", (await p.locator(".continue-card", { hasText: "Severance" }).count()) === 0 && ((await storeOf(p, "watching")) ?? []).every((w) => w.id !== "tt11280740"), JSON.stringify(await storeOf(p, "watching")));
  check("nothing in any of it carried the token to the page", !(await everything(p)).includes(p.native.st.token));
  await p.context().close();
}

// ========================= Clearing the card of what you just played
// The sync is what names the server's item for each Continue Watching card, and
// it runs at launch, on focus after 15 minutes away, after a sign-in and on Sync
// now. So a card from a play made since then is not in its list: the clear has to
// know the item from the play itself, or the server keeps the position and the
// next sync brings the card back.
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await p.locator('.stream-card[data-hint="Severance"]').first().click({ timeout: 15_000 });
  await p.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  await p.locator(".episode-card").nth(2).click();
  await p.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await p.evaluate(() => ((window.__dur = 600), (window.__pos = 300)));
  await fake("/__log", { method: "DELETE" });
  const resumeReads = () => p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.path === "/UserItems/Resume").length;
  const syncedBefore = resumeReads();
  await p.locator(".vod-source").first().click();
  await waitFor(p, async () => (await reports()).some((c) => c.path === "/Sessions/Playing"), 20_000);
  await p.evaluate(() => (window.__pos = 330));
  await p.waitForTimeout(6000); // the 5s progress tick writes the position to Continue Watching
  const ov = await p.locator(".theater-overlay").first().boundingBox();
  await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await p.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await p.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await waitFor(p, async () => (await reports()).some((c) => c.path === "/Sessions/Playing/Stopped"), 10_000);
  await goTo(p, "home");
  const card = p.locator(".continue-card", { hasText: "Severance" }).first();
  await card.waitFor({ timeout: 10_000 });
  const kept = (await fake("/__state")).ud[EP3];
  check(
    "(set up) the episode was played part way and left: the server holds its position, and the card is there",
    kept?.PlaybackPositionTicks > 0 && kept.Played === false && resumeReads() === syncedBefore,
    JSON.stringify({ kept, reads: [syncedBefore, resumeReads()] }),
  );
  await card.focus();
  await p.keyboard.press("Delete");
  const posted = async () => (await faked()).filter((c) => c.method === "POST" && c.path === `/UserItems/${EP3}/UserData`);
  const sent = await waitFor(p, async () => (await posted()).length > 0, 8000);
  const body = p.native.st.calls.filter(([c, a]) => c === "jf_request" && a.method === "POST" && a.path === `/UserItems/${EP3}/UserData`)[0]?.[1]?.body;
  check(
    "clearing it with no sync since the play resets the server's position for that episode",
    sent && body?.PlaybackPositionTicks === 0 && body.Played === false && resumeReads() === syncedBefore,
    JSON.stringify({ sent, body, reads: [syncedBefore, resumeReads()] }),
  );
  const ud = (await fake("/__state")).ud[EP3];
  check("  and the server took it: no position, not played", ud?.PlaybackPositionTicks === 0 && ud.Played === false, JSON.stringify(ud));
  check("  and the card stays cleared", (await p.locator(".continue-card", { hasText: "Severance" }).count()) === 0);
  await p.context().close();
}

// ============ Stream's settings and the palette, with only a Jellyfin
// Stream works on a Jellyfin alone, and its rows change what a Jellyfin play
// does (skipping, the autoplay countdown, the row size), so Settings shows them
// and Ctrl+K has Stream's places: neither waits for an AIOStreams.
await fake("/__reset", { method: "POST" });
{
  const p = await openPage({ signed: true });
  await p.locator(".media-row__title", { hasText: /^Movies$/ }).first().waitFor({ timeout: 15_000 });
  const places = async () => {
    await p.keyboard.press("Control+k");
    await p.locator(".palette").waitFor({ timeout: 4000 });
    const names = await p.evaluate(() => [...document.querySelectorAll(".palette .mvpick__row .mvpick__nametext")].map((r) => r.textContent));
    await p.keyboard.press("Escape");
    await p.locator(".palette").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    return names;
  };
  const named = await places();
  check("Ctrl+K with only a Jellyfin has Stream, Discover and Library to go to", ["Stream", "Discover", "Library"].every((n) => named.includes(n)), JSON.stringify(named));

  await openSettings(p);
  await p.getByRole("tab", { name: "Playback", exact: true }).click();
  await p.waitForTimeout(400);
  const PLAY = ["one-click-play", "source-failover", "autoplay-next", "up-next-card", "skipping", "preferred-language"];
  const playHave = await p.evaluate((ids) => ids.map((id) => document.querySelectorAll(`.settings__body [data-setting="${id}"]`).length), PLAY);
  const playText = (await p.locator(".settings__body").innerText()).replace(/\n/g, " ");
  check(
    "  Playback shows Autoplay Next Episode and the rest of Stream's rows, not the sign-in note",
    playHave.every((n) => n === 1) && /Autoplay Next Episode/.test(playText) && !/to see these settings/.test(playText),
    JSON.stringify({ playHave, text: playText.slice(0, 120) }),
  );

  await p.getByRole("tab", { name: "Appearance", exact: true }).click();
  await p.waitForTimeout(400);
  const LOOK = ["featured-carousel", "card-details", "player-overlay", "row-size"];
  const lookHave = await p.evaluate((ids) => ids.map((id) => document.querySelectorAll(`.settings__body [data-setting="${id}"]`).length), LOOK);
  const lookText = (await p.locator(".settings__body").innerText()).replace(/\n/g, " ");
  check(
    "  Appearance's Stream pill shows the carousel, card details, player overlay and row size, not the sign-in note",
    lookHave.every((n) => n === 1) && !/to see these settings/.test(lookText),
    JSON.stringify({ lookHave, text: lookText.slice(0, 120) }),
  );
  // The hero comes from the library with no addon, so the carousel is real here;
  // what stays out is the picker of AIOStreams catalogs, which has none to list.
  const carouselOn = await p.evaluate(() => document.querySelector('[data-setting="featured-carousel"] [role=switch]')?.getAttribute("aria-checked") ?? null);
  check(
    "  and Carousel Catalogs stays out, with the carousel on: it picks AIOStreams catalogs",
    carouselOn === "true" && (await p.locator('[data-setting="hero-sources"]').count()) === 0,
    String(carouselOn),
  );
  await closeSettings(p);
  await p.context().close();
}
{
  // The control: signed in to nothing, neither the places nor the rows appear.
  const p = await openPage({});
  await p.waitForSelector(".navcap", { timeout: 20_000 });
  await p.keyboard.press("Control+k");
  await p.locator(".palette").waitFor({ timeout: 4000 });
  const named = await p.evaluate(() => [...document.querySelectorAll(".palette .mvpick__row .mvpick__nametext")].map((r) => r.textContent));
  await p.keyboard.press("Escape");
  await p.locator(".palette").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("(control) Ctrl+K with nothing signed in has none of Stream's places", named.includes("Settings") && !["Stream", "Discover", "Library"].some((n) => named.includes(n)), JSON.stringify(named));
  await openSettings(p);
  await p.getByRole("tab", { name: "Playback", exact: true }).click();
  await p.waitForTimeout(400);
  const text = (await p.locator(".settings__body").innerText()).replace(/\n/g, " ");
  check(
    "  and Playback says to sign in to an AIOStreams or a Jellyfin, with no Stream rows",
    /Sign in to AIOStreams or Jellyfin to see these settings/.test(text) && (await p.getByRole("button", { name: "Go to Sources" }).count()) === 1 && (await p.locator('.settings__body [data-setting="autoplay-next"]').count()) === 0,
    text.slice(0, 160),
  );
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
