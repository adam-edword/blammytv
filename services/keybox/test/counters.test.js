import test from "node:test";
import assert from "node:assert/strict";
import { openDb, bumpCounter, readCounters, COUNTER_NAMES } from "../src/db.js";
import { buildCatalog } from "../src/catalog.js";
import { makeApp } from "../src/server.js";

// The download-button tally: POST /count/:name, GET /counts, and the db layer
// under them. The properties that matter are that it counts correctly, that it
// cannot be turned into general-purpose storage by a stranger, and that it
// stores nothing but a number.

async function startApp() {
  const db = openDb(":memory:");
  const catalog = buildCatalog({ passPriceIds: [], themes: [] });
  const stripe = { webhooks: {}, checkout: { sessions: {} } };
  const app = makeApp({ db, stripe, catalog, webhookSecret: "whsec_unused" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { db, server, base: `http://127.0.0.1:${port}` };
}

test("counters: a fresh db reports every known counter as 0", () => {
  const db = openDb(":memory:");
  assert.deepEqual(readCounters(db), { download: 0 });
});

test("counters: bumpCounter creates then increments", () => {
  const db = openDb(":memory:");
  bumpCounter(db, "download");
  assert.equal(readCounters(db).download, 1);
  for (let i = 0; i < 9; i++) bumpCounter(db, "download");
  assert.equal(readCounters(db).download, 10);
});

test("POST /count/download increments and answers 204 with no body", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/count/download`, { method: "POST" });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
  assert.equal(readCounters(db).download, 1);

  await fetch(`${base}/count/download`, { method: "POST" });
  assert.equal(readCounters(db).download, 2);
});

test("GET /counts returns the numbers", async (t) => {
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  bumpCounter(db, "download");
  bumpCounter(db, "download");

  const res = await fetch(`${base}/counts`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { download: 2 });
});

test("POST /count/:name ignores a name that is not on the allowlist", async (t) => {
  // The endpoint is unauthenticated, so an unknown name must not create a row.
  // Otherwise anyone could write unbounded distinct keys into the database.
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  for (const name of ["visits", "../keys", "a".repeat(500)]) {
    const res = await fetch(`${base}/count/${encodeURIComponent(name)}`, {
      method: "POST",
    });
    assert.equal(res.status, 204, `${name} should still answer 204`);
  }

  const rows = db.prepare("SELECT name FROM counters").all();
  assert.deepEqual(rows, [], "no rows should have been created");
  assert.deepEqual(readCounters(db), { download: 0 });
});

test("counters: the row holds a name and a number, and nothing else", () => {
  // A regression guard on the promise the site makes. If a column that could
  // identify a visitor is ever added here, this fails and the docs and the
  // site copy have to be revisited at the same time.
  const db = openDb(":memory:");
  bumpCounter(db, "download");
  const columns = db.prepare("PRAGMA table_info(counters)").all().map((c) => c.name);
  assert.deepEqual(columns.sort(), ["n", "name"]);
});

test("counters: sendBeacon's text/plain POST is accepted", async (t) => {
  // navigator.sendBeacon posts with Content-Type text/plain (that is what
  // makes it a CORS-simple request that never preflights). express.json()
  // must not reject it, or every real beacon from the site 400s while the
  // no-body tests above keep passing.
  const { db, server, base } = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/count/download`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: "",
  });
  assert.equal(res.status, 204);
  assert.equal(readCounters(db).download, 1);
});

test("counters: the allowlist is what the site is allowed to send", () => {
  assert.deepEqual(COUNTER_NAMES, ["download"]);
});
