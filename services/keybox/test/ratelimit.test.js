import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { buildCatalog } from "../src/catalog.js";
import { makeApp } from "../src/server.js";

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
  const app = makeApp({ db, stripe, catalog, webhookSecret: "whsec_unused" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test("rate limiter: /validate returns 429 once a single IP exceeds the per-minute budget", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const CAPACITY = 30; // matches RATE_LIMIT_CAPACITY in src/server.js
  const requests = [];
  for (let i = 0; i < CAPACITY; i++) {
    requests.push(
      fetch(`${base}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "BTV-0000-0000-0000-0000", machine: `m${i}` }),
      }),
    );
  }
  const results = await Promise.all(requests);
  for (const res of results) {
    assert.notEqual(res.status, 429, "requests within budget should not be rate-limited");
  }

  const overBudget = await fetch(`${base}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: "BTV-0000-0000-0000-0000", machine: "over-budget" }),
  });
  assert.equal(overBudget.status, 429);
  assert.deepEqual(await overBudget.json(), { ok: false, reason: "rate_limited" });
});

test("rate limiter: /payload is limited independently but shares the same per-IP mechanism", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  // Burn this IP's entire budget on /validate first...
  const CAPACITY = 30;
  for (let i = 0; i < CAPACITY; i++) {
    await fetch(`${base}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "BTV-0000-0000-0000-0000", machine: `m${i}` }),
    });
  }

  // ...then confirm /payload (same IP, shared bucket) trips the same limiter.
  const res = await fetch(`${base}/payload/nebula`);
  assert.equal(res.status, 429);
});
