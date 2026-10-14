#!/usr/bin/env node
// Plan 027, batch 0: ask a real Jellyfin what it actually answers, so the
// fake and the code are built on its shapes and not on the plan's memory.
//
//   node scripts/jf-probe.mjs [baseUrl]      (default http://127.0.0.1:8096)
//
// Signs in (password, typed hidden, never stored; or Quick Connect, no
// password), then walks sign-in, views, items, PlaybackInfo, a direct
// stream, play reports, resume / next up, segments, errors and a logout.
// It touches one episode's watch state and puts it back.
//
// Writes results.json and openapi.json into a folder under your temp dir
// and prints the path. Tokens and Quick Connect secrets are replaced with
// <redacted> everywhere; the password never reaches a file. Attach
// results.json to the thread. Env: JF_USER (default edd), JF_MODE (p or q).
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = (process.argv[2] || 'http://127.0.0.1:8096').replace(/\/+$/, '');
const USER = process.env.JF_USER || 'edd';
const DEVICE_ID = 'blammytv-probe';
const secrets = new Set();
const results = [];
const notes = [];
let spec = null;

// ---- prompting ----
let muted = false;
const sink = new Writable({
  write(chunk, enc, cb) {
    if (!muted) process.stdout.write(chunk, enc);
    cb();
  },
});
const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
function ask(q, hidden) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    muted = !!hidden;
    rl.question('', (a) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(a);
    });
  });
}

// ---- calls ----
function authHeader(token) {
  const parts = [
    'Client="BlammyTV"',
    'Device="PC"',
    `DeviceId="${DEVICE_ID}"`,
    'Version="0.0.0"',
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

function redact(s) {
  let out = String(s);
  for (const x of secrets) if (x) out = out.split(x).join('<redacted>');
  return out;
}

const KEEP_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'retry-after',
  'www-authenticate',
  'x-application-error-code',
  'location',
];

async function call(label, method, path, opt = {}) {
  const { token, headers = {}, body, secret = false, noAuth = false, binary = false } = opt;
  const h = { ...headers };
  if (!noAuth && !h.Authorization && !h['X-Emby-Authorization']) h.Authorization = authHeader(token);
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const rec = { label, method, path: redact(path) };
  if (body !== undefined) rec.requestBody = secret ? '[withheld]' : body;
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: h,
      body: payload,
      signal: AbortSignal.timeout(30000),
    });
    rec.status = res.status;
    rec.headers = {};
    for (const k of KEEP_HEADERS) if (res.headers.get(k)) rec.headers[k] = res.headers.get(k);
    const buf = Buffer.from(await res.arrayBuffer());
    rec.ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '';
    if (binary || /^(image|video|audio)\//.test(ct) || ct === 'application/octet-stream') {
      rec.bytes = buf.length;
    } else {
      const text = buf.toString('utf8');
      try {
        rec.body = JSON.parse(text);
      } catch {
        rec.body = text.slice(0, 4000);
      }
    }
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e);
  }
  const clean = JSON.parse(redact(JSON.stringify(rec)));
  results.push(clean);
  const tag = rec.error ? `ERR ${rec.error}` : rec.status;
  console.log(`  ${String(tag).padEnd(4)} ${method} ${redact(path).slice(0, 90)}`);
  return rec;
}

const ok = (r) => r && r.status >= 200 && r.status < 300;
const note = (s) => {
  notes.push(s);
  console.log(`  note: ${s}`);
};
const section = (s) => console.log(`\n== ${s}`);
const FIELDS =
  'ProviderIds,Overview,Genres,PrimaryImageAspectRatio,ProductionYear,RunTimeTicks,DateCreated,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,UserData,Path,MediaSources';
const pct = (ticks, p) => Math.floor((ticks * p) / 100);

// ---- 1. info ----
section('1. public info');
const info = await call('info', 'GET', '/System/Info/Public', { noAuth: true });
if (info.body && typeof info.body === 'object') {
  note(`Version ${info.body.Version}, ProductName ${info.body.ProductName}, aiostreams object: ${'aiostreams' in info.body}`);
}

// ---- 2. spec ----
section('2. openapi spec');
for (const p of ['/api-docs/openapi.json', '/openapi.json', '/swagger/v1/swagger.json', '/api-docs/swagger.json']) {
  const r = await call('spec ' + p, 'GET', p, { noAuth: true });
  if (ok(r) && r.body && typeof r.body === 'object' && r.body.paths) {
    spec = r.body;
    // keep the big body out of results.json; openapi.json holds it
    results[results.length - 1].body = '[saved as openapi.json]';
    note(`spec served at ${p}`);
    break;
  }
}
const WANTED = [
  '/Users/AuthenticateByName',
  '/QuickConnect/Enabled',
  '/QuickConnect/Initiate',
  '/QuickConnect/Connect',
  '/QuickConnect/Authorize',
  '/Users/AuthenticateWithQuickConnect',
  '/Sessions/Logout',
  '/UserViews',
  '/Users/{userId}/Views',
  '/Items',
  '/Items/{itemId}',
  '/Users/{userId}/Items',
  '/Users/{userId}/Items/{itemId}',
  '/Items/{itemId}/PlaybackInfo',
  '/Videos/{itemId}/stream',
  '/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}',
  '/Videos/{videoId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}',
  '/UserItems/Resume',
  '/Users/{userId}/Items/Resume',
  '/Shows/NextUp',
  '/Shows/Upcoming',
  '/UserPlayedItems/{itemId}',
  '/Users/{userId}/PlayedItems/{itemId}',
  '/UserItems/{itemId}/UserData',
  '/Sessions/Playing',
  '/Sessions/Playing/Progress',
  '/Sessions/Playing/Stopped',
  '/MediaSegments/{itemId}',
  '/Items/{itemId}/Images/{imageType}',
  '/Shows/{seriesId}/Episodes',
  '/Shows/{seriesId}/Seasons',
  '/Items/Filters',
  '/System/Info/Public',
];
let specSummary = null;
if (spec) {
  const comps = spec.components?.parameters || {};
  const pdesc = (p) => {
    if (p.$ref) p = comps[p.$ref.split('/').pop()] || { name: p.$ref };
    return `${p.name}${p.required ? '*' : ''}@${p.in}`;
  };
  specSummary = { openapi: spec.openapi, title: spec.info?.title, version: spec.info?.version, pathCount: Object.keys(spec.paths).length, wanted: {} };
  for (const w of WANTED) {
    const e = spec.paths[w];
    if (!e) {
      specSummary.wanted[w] = 'ABSENT';
      continue;
    }
    specSummary.wanted[w] = {};
    for (const [m, op] of Object.entries(e)) {
      if (!op || typeof op !== 'object' || !op.responses) continue;
      specSummary.wanted[w][m.toUpperCase()] = {
        operationId: op.operationId,
        params: (op.parameters || []).map(pdesc),
        requestBody: op.requestBody ? Object.keys(op.requestBody.content || {}) : undefined,
        deprecated: op.deprecated || undefined,
        responses: Object.keys(op.responses),
      };
    }
  }
}

// ---- 3. sign in ----
section('3. sign in');
await call('wrong password', 'POST', '/Users/AuthenticateByName', {
  body: { Username: USER, Pw: 'definitely-not-the-password-' + Date.now() },
  secret: true,
});
const mode = (process.env.JF_MODE || (await ask('sign in with (p)assword or (q)uick connect? [p/q] ', false))).trim().toLowerCase();
let token = null;
let userId = null;
let authResult = null;
if (mode.startsWith('q')) {
  const en = await call('qc enabled', 'GET', '/QuickConnect/Enabled', { noAuth: false });
  const init = await call('qc initiate', 'POST', '/QuickConnect/Initiate');
  if (ok(init) && init.body?.Secret) {
    secrets.add(init.body.Secret);
    console.log(`\n  QUICK CONNECT CODE: ${init.body.Code}`);
    console.log('  enter it in Jellyfin web while signed in as ' + USER + ': user menu > Quick Connect\n');
    let approved = false;
    const until = Date.now() + 5 * 60 * 1000;
    let first = true;
    while (Date.now() < until) {
      const c = await call('qc connect (pending)', 'GET', `/QuickConnect/Connect?secret=${init.body.Secret}`);
      if (first) first = false;
      if (c.body?.Authenticated) {
        approved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (approved) {
      const a = await call('qc authenticate', 'POST', '/Users/AuthenticateWithQuickConnect', {
        body: { Secret: init.body.Secret },
        secret: true,
      });
      authResult = a.body;
    } else note('quick connect code was never approved');
  } else note(`quick connect unavailable (enabled: ${JSON.stringify(en.body)})`);
} else {
  const pw = process.env.JF_PASS || (await ask(`password for ${USER} (hidden): `, true));
  const a = await call('authenticate by name', 'POST', '/Users/AuthenticateByName', {
    body: { Username: USER, Pw: pw },
    secret: true,
  });
  authResult = a.body;
}
if (authResult && authResult.AccessToken) {
  token = authResult.AccessToken;
  secrets.add(token);
  userId = authResult.User?.Id;
  note(`signed in as ${authResult.User?.Name} (${userId}), result keys: ${Object.keys(authResult).join(',')}`);
} else {
  note('NO TOKEN: stopping after what was captured');
}

async function finish() {
  const dir = join(tmpdir(), 'jf-probe-' + new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const out = { base: BASE, user: USER, notes, specSummary, calls: results };
  writeFileSync(join(dir, 'results.json'), redact(JSON.stringify(out, null, 2)));
  if (spec) writeFileSync(join(dir, 'openapi.json'), JSON.stringify(spec));
  console.log(`\nwrote ${join(dir, "results.json")}${spec ? " and openapi.json" : ""}`);
  console.log('attach results.json to the thread.');
  rl.close();
  process.exit(0);
}

if (token) {
  try {
    // how the token is accepted
    section('3b. how a token is accepted');
    const T = encodeURIComponent(token);
    await call('token: Authorization Token=', 'GET', '/UserViews', { token });
    await call('token: X-MediaBrowser-Token', 'GET', '/UserViews', { noAuth: true, headers: { 'X-MediaBrowser-Token': token } });
    await call('token: X-Emby-Token', 'GET', '/UserViews', { noAuth: true, headers: { 'X-Emby-Token': token } });
    await call('token: ?api_key=', 'GET', `/UserViews?api_key=${T}`, { noAuth: true });
    await call('token: ?ApiKey=', 'GET', `/UserViews?ApiKey=${T}`, { noAuth: true });
    await call('token: legacy X-Emby-Authorization', 'GET', '/UserViews', {
      noAuth: true,
      headers: { 'X-Emby-Authorization': authHeader(token).replace('MediaBrowser', 'MediaBrowser') },
    });
    await call('token: none', 'GET', '/UserViews', { noAuth: true });
    await call('token: bad', 'GET', '/UserViews', { token: 'deadbeef'.repeat(4) });

    // ---- 5. libraries ----
    section('5. libraries and items');
    const views = await call('views', 'GET', `/UserViews?userId=${userId}&includeHidden=false`, { token });
    await call('views (old form)', 'GET', `/Users/${userId}/Views`, { token });
    const viewList = views.body?.Items || [];
    let series = null;
    let movie = null;
    let zzz = null;
    for (const v of viewList) {
      note(`view ${v.Name} type=${v.CollectionType} id=${v.Id}`);
      const items = await call(`items in ${v.Name}`, 'GET', `/Items?ParentId=${v.Id}&Recursive=true&userId=${userId}&Fields=${FIELDS}&limit=50`, { token });
      for (const it of items.body?.Items || []) {
        if (it.Type === 'Series' && /severance/i.test(it.Name)) series = it;
        else if (it.Type === 'Series' && !zzz && /zzz/i.test(it.Name)) zzz = it;
        else if (it.Type === 'Series' && !series) series = it;
        if (it.Type === 'Movie' && !movie) movie = it;
      }
    }
    await call('items (library-wide, no parent)', 'GET', `/Items?Recursive=true&userId=${userId}&IncludeItemTypes=Series,Movie&Fields=ProviderIds&limit=50`, { token });
    await call('items (old form)', 'GET', `/Users/${userId}/Items?Recursive=true&IncludeItemTypes=Series,Movie&Fields=ProviderIds&limit=5`, { token });
    await call('filters', 'GET', `/Items/Filters?userId=${userId}`, { token });
    let ep = null;
    if (series) {
      note(`series ${series.Name} ProviderIds=${JSON.stringify(series.ProviderIds)}`);
      await call('single series', 'GET', `/Items/${series.Id}?userId=${userId}`, { token });
      await call('single series (old form)', 'GET', `/Users/${userId}/Items/${series.Id}`, { token });
      await call('seasons', 'GET', `/Shows/${series.Id}/Seasons?userId=${userId}&Fields=ProviderIds`, { token });
      const eps = await call('episodes', 'GET', `/Shows/${series.Id}/Episodes?userId=${userId}&Fields=${FIELDS}`, { token });
      ep = (eps.body?.Items || [])[0] || null;
      await call('series primary image (token)', 'GET', `/Items/${series.Id}/Images/Primary?maxWidth=300`, { token, binary: true });
      await call('series primary image (no token)', 'GET', `/Items/${series.Id}/Images/Primary?maxWidth=300`, { noAuth: true, binary: true });
    } else note('no series found');
    if (zzz) note(`Zzz ProviderIds=${JSON.stringify(zzz.ProviderIds)}`);
    if (movie) {
      note(`movie ${movie.Name} ProviderIds=${JSON.stringify(movie.ProviderIds)}`);
      await call('single movie', 'GET', `/Items/${movie.Id}?userId=${userId}`, { token });
    }
    if (!ep && movie) ep = movie;

    if (ep) {
      const id = ep.Id;
      // ---- 6. playback ----
      section('6. playback info and a direct stream');
      const pi1 = await call('playbackinfo (no profile)', 'POST', `/Items/${id}/PlaybackInfo?userId=${userId}`, { token, body: {} });
      const pi2 = await call('playbackinfo (direct play profile)', 'POST', `/Items/${id}/PlaybackInfo`, {
        token,
        body: {
          UserId: userId,
          DeviceProfile: {
            Name: 'blammytv-probe',
            MaxStreamingBitrate: 120000000,
            DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }],
            TranscodingProfiles: [],
            SubtitleProfiles: [{ Format: 'srt', Method: 'External' }, { Format: 'ass', Method: 'External' }],
          },
        },
      });
      await call('playbackinfo (GET form)', 'GET', `/Items/${id}/PlaybackInfo?userId=${userId}`, { token });
      const ms = (pi2.body?.MediaSources || pi1.body?.MediaSources || [])[0];
      if (ms) {
        const qs = `static=true&mediaSourceId=${ms.Id}${ms.ETag ? '&tag=' + ms.ETag : ''}${pi2.body?.PlaySessionId ? '&playSessionId=' + pi2.body.PlaySessionId : ''}`;
        const range = { Range: 'bytes=0-1023' };
        await call('stream (header token, range)', 'GET', `/Videos/${id}/stream?${qs}`, { token, headers: range, binary: true });
        await call('stream (no token)', 'GET', `/Videos/${id}/stream?${qs}`, { noAuth: true, headers: range, binary: true });
        await call('stream (api_key)', 'GET', `/Videos/${id}/stream?${qs}&api_key=${encodeURIComponent(token)}`, { noAuth: true, headers: range, binary: true });
        await call('stream (HEAD-ish, no range)', 'GET', `/Videos/${id}/stream?${qs}`, { token, headers: { Range: 'bytes=0-0' }, binary: true });
        for (const s of ms.MediaStreams || []) {
          if (s.Type === 'Subtitle' && (s.DeliveryUrl || s.IsExternal)) {
            const u = s.DeliveryUrl || `/Videos/${id}/${ms.Id}/Subtitles/${s.Index}/Stream.${s.Codec || 'srt'}`;
            await call(`subtitle ${s.Index} (${s.Codec})`, 'GET', u.startsWith('/') ? u : '/' + u, { token });
          }
        }
        // is the clip real? ffprobe, if it is installed (token as a header, not in the url)
        const fp = spawnSync(
          'ffprobe',
          ['-v', 'error', '-headers', `X-Emby-Token: ${token}\r\n`, '-show_format', '-show_streams', '-of', 'json', `${BASE}/Videos/${id}/stream?${qs}`],
          { encoding: 'utf8', timeout: 30000 },
        );
        if (fp.error) note('ffprobe not available: ' + fp.error.code);
        else {
          try {
            const j = JSON.parse(fp.stdout);
            results.push({ label: 'ffprobe', format: j.format?.format_name, duration: j.format?.duration, streams: (j.streams || []).map((s) => ({ type: s.codec_type, codec: s.codec_name, w: s.width, h: s.height })) });
          } catch {
            note('ffprobe output unreadable: ' + redact(fp.stderr || '').slice(0, 300));
          }
        }
      } else note('no MediaSources in PlaybackInfo');

      // ---- 7. reports ----
      section('7. play reports and what the server does with them');
      const dur = ms?.RunTimeTicks || ep.RunTimeTicks || 0;
      note(`episode ${ep.Name} (${id}) RunTimeTicks=${dur}`);
      const read = (label) => call(label, 'GET', `/Items/${id}?userId=${userId}&Fields=UserData`, { token });
      const readUD = (label) => call(label, 'GET', `/UserItems/${id}/UserData?userId=${userId}`, { token });
      await read('state before');
      const base = { ItemId: id, MediaSourceId: ms?.Id, PlaySessionId: pi2.body?.PlaySessionId || 'probe-session', CanSeek: true, PlayMethod: 'DirectPlay' };
      for (const p of [3, 50, 85, 95, 100]) {
        const ticks = pct(dur, p);
        await call(`playing @${p}%`, 'POST', '/Sessions/Playing', { token, body: { ...base, PositionTicks: 0 } });
        await call(`progress @${p}%`, 'POST', '/Sessions/Playing/Progress', { token, body: { ...base, PositionTicks: ticks, IsPaused: false, EventName: 'timeupdate' } });
        await call(`stopped @${p}%`, 'POST', '/Sessions/Playing/Stopped', { token, body: { ...base, PositionTicks: ticks } });
        await read(`state after stop @${p}%`);
        if (p === 50) {
          await call('resume list after 50%', 'GET', `/UserItems/Resume?userId=${userId}&Limit=20&MediaTypes=Video&Fields=ProviderIds,UserData`, { token });
          await call('resume list (old form)', 'GET', `/Users/${userId}/Items/Resume?Limit=20&MediaTypes=Video`, { token });
          if (series) await call('next up after 50%', 'GET', `/Shows/NextUp?userId=${userId}&SeriesId=${series.Id}&Fields=ProviderIds,UserData`, { token });
          await call('next up (all)', 'GET', `/Shows/NextUp?userId=${userId}&Fields=ProviderIds,UserData`, { token });
          await call('upcoming', 'GET', `/Shows/Upcoming?userId=${userId}&Fields=ProviderIds`, { token });
        }
        // put it back before the next case
        await call(`unplay after ${p}%`, 'DELETE', `/UserPlayedItems/${id}?userId=${userId}`, { token });
        await readUD(`userdata after unplay @${p}%`);
      }
      await call('mark played', 'POST', `/UserPlayedItems/${id}?userId=${userId}`, { token, body: {} });
      await read('state after mark played');
      await call('played list', 'GET', `/Items?userId=${userId}&Recursive=true&IsPlayed=true&Fields=ProviderIds&IncludeItemTypes=Episode,Movie`, { token });
      await call('unmark played', 'DELETE', `/UserPlayedItems/${id}?userId=${userId}`, { token });
      await call('zero the resume position', 'POST', `/UserItems/${id}/UserData?userId=${userId}`, { token, body: { PlaybackPositionTicks: 0, Played: false } });
      await read('state restored');

      section('8. segments');
      await call('segments', 'GET', `/MediaSegments/${id}`, { token });
    }

    // ---- 9. errors, logout ----
    section('9. errors and sign-out');
    await call('missing item', 'GET', `/Items/00000000000000000000000000000000?userId=${userId}`, { token });
    await call('bad route', 'GET', '/NotARealRoute', { token });
    await call('logout', 'POST', '/Sessions/Logout', { token });
    await call('after logout', 'GET', '/UserViews', { token });
  } catch (e) {
    note('probe stopped by an error: ' + (e && e.stack ? e.stack : e));
  }
}
await finish();
