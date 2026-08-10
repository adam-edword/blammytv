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

test("rate limit: a spoofed X-Forwarded-For cannot mint a fresh bucket", async (t) => {
  // `trust proxy: true` made req.ip the LEFTMOST forwarded entry, i.e. the
  // one the client typed, so rotating the header removed the limit outright.
  //
  // The header is written as our proxy would leave it: whatever the client
  // sent, followed by the address the proxy observed. With one trusted hop
  // Express counts in from the right and takes the proxy's value, so the
  // client's half is inert. Under the old setting it took the client's half
  // and every request below would have landed in its own bucket.
  const { server, base } = await startApp();
  t.after(() => server.close());

  const hit = (claimed) =>
    fetch(`${base}/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${claimed}, 10.0.0.7`,
      },
      body: JSON.stringify({ key: "BTV-XXXX", machine: "m1" }),
    });

  let limited = false;
  for (let i = 0; i < 40; i++) {
    const res = await hit("1.2.3.4");
    if (res.status === 429) { limited = true; break; }
  }
  assert.ok(limited, "the limiter should trip within 40 requests");

  // A different claimed address, same real peer. Still limited.
  const res = await hit("9.9.9.9");
  assert.equal(res.status, 429, "rotating the header must not reset the bucket");
});
