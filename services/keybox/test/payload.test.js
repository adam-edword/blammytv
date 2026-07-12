import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openDb, createKey, touchActivation } from "../src/db.js";
import { loadCatalog } from "../src/catalog.js";
import { makeApp } from "../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEBULA_CSS = readFileSync(
  path.join(__dirname, "..", "payloads", "nebula.css"),
  "utf8",
);

async function startApp() {
  const db = openDb(":memory:");
  const catalog = loadCatalog(); // real catalog.json — nebula.css exists on disk for it
  const stripe = { webhooks: {}, checkout: { sessions: {} } };
  const app = makeApp({ db, stripe, catalog, webhookSecret: "whsec_unused" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { db, catalog, server, base: `http://127.0.0.1:${port}` };
}

function getPayload(base, themeId, headers = {}) {
  return fetch(`${base}/payload/${themeId}`, { headers });
}

test("payload: entitled + activated machine gets the real CSS payload", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "themes", themes: ["nebula"], session: "cs_a" });
  touchActivation(db, key, "m1");

  const res = await getPayload(base, "nebula", { "x-license-key": key, "x-machine": "m1" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/css/);
  const body = await res.text();
  assert.equal(body, NEBULA_CSS);
  assert.match(body, /data-theme-pack="nebula"/);
});

test("payload: a key that doesn't own the theme is rejected as not_entitled", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "themes", themes: ["some-other-theme"], session: "cs_b" });
  touchActivation(db, key, "m1");

  const res = await getPayload(base, "nebula", { "x-license-key": key, "x-machine": "m1" });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "not_entitled" });
});

test("payload: missing license headers are rejected as not_entitled", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const res = await getPayload(base, "nebula");
  assert.equal(res.status, 403);
});

test("payload: entitled key on a machine that never activated is rejected as not_entitled", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "pass", themes: [], session: "cs_c" });
  // Note: no touchActivation call — this machine was never registered.

  const res = await getPayload(base, "nebula", { "x-license-key": key, "x-machine": "never-seen" });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "not_entitled" });
});

test("payload: unknown theme id 404s", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "pass", themes: [], session: "cs_d" });
  touchActivation(db, key, "m1");

  const res = await getPayload(base, "does-not-exist", { "x-license-key": key, "x-machine": "m1" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { ok: false, reason: "unknown_theme" });
});

test("payload: path-traversal attempt in the theme id is rejected without touching the filesystem", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const { key } = createKey(db, { kind: "pass", themes: [], session: "cs_e" });
  touchActivation(db, key, "m1");

  // The catalog allowlist rejects this before any fs.readFile happens — the
  // theme id is never spliced raw into a path, so this just misses the
  // catalog lookup and 404s like any other unknown id would.
  const res = await getPayload(base, "..%2F..%2Fetc%2Fpasswd", {
    "x-license-key": key,
    "x-machine": "m1",
  });
  assert.equal(res.status, 404);
});
