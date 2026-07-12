import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { buildCatalog } from "../src/catalog.js";
import { makeApp } from "../src/server.js";

const WEBHOOK_SECRET = "whsec_test_secret";

function testCatalog() {
  return buildCatalog({
    passPriceIds: ["price_pass_test"],
    themes: [
      {
        id: "nebula",
        name: "Nebula",
        blurb: "deep violet-noir",
        supportsLight: false,
        preview: { bg: "#0a0612", surface: "#120c1f", accent: "#c22727" },
        priceIds: ["price_nebula_test"],
      },
    ],
  });
}

async function startApp() {
  const db = openDb(":memory:");
  const catalog = testCatalog();
  const stripe = { webhooks: {}, checkout: { sessions: {} } };
  const app = makeApp({ db, stripe, catalog, webhookSecret: WEBHOOK_SECRET });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

function assertCorsHeaders(res) {
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    res.headers.get("access-control-allow-headers"),
    "content-type,x-license-key,x-machine",
  );
  assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
}

test("CORS: OPTIONS preflight on /validate returns 204 with the three CORS headers", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/validate`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assertCorsHeaders(res);
});

test("CORS: OPTIONS preflight on /payload/:themeId returns 204 with the three CORS headers", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/payload/nebula`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assertCorsHeaders(res);
});

test("CORS: preflights never touch the rate limiter budget, even well past the per-minute cap", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  // RATE_LIMIT_CAPACITY is 30/min in src/server.js — fire well past that,
  // as preflights only, and confirm none of them 429.
  const requests = [];
  for (let i = 0; i < 50; i++) {
    requests.push(fetch(`${base}/validate`, { method: "OPTIONS" }));
  }
  const results = await Promise.all(requests);
  for (const res of results) {
    assert.equal(res.status, 204, "a preflight must never be rate-limited");
  }
});

test("CORS: actual POST /validate response carries Access-Control-Allow-Origin", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: "BTV-0000-0000-0000-0000", machine: "m1" }),
  });
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("CORS: /webhook response does NOT carry Access-Control-Allow-Origin", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=not_a_real_signature" },
    body: JSON.stringify({ id: "evt_x", type: "checkout.session.completed", data: { object: { id: "cs_x" } } }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});
