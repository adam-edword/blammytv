import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { openDb, findBySession } from "../src/db.js";
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
      {
        id: "solstice",
        name: "Solstice",
        blurb: "test-only second theme",
        supportsLight: false,
        preview: { bg: "#000000", surface: "#111111", accent: "#c22727" },
        priceIds: ["price_solstice_test"],
      },
    ],
  });
}

// Uses the REAL Stripe SDK's webhooks module (constructEvent /
// generateTestHeaderString) so signature verification is genuinely
// exercised, not mocked away. Only checkout.sessions.listLineItems is
// stubbed, since that's the network call the webhook handler makes.
function makeStripeStub(lineItemsBySession) {
  const real = new Stripe("sk_test_dummy_not_a_real_key");
  return {
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        listLineItems: async (sessionId) => ({
          data: lineItemsBySession.get(sessionId) ?? [],
        }),
      },
    },
  };
}

async function startApp({ lineItemsBySession = new Map() } = {}) {
  const db = openDb(":memory:");
  const catalog = testCatalog();
  const stripe = makeStripeStub(lineItemsBySession);
  const app = makeApp({ db, stripe, catalog, webhookSecret: WEBHOOK_SECRET });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { db, catalog, stripe, server, base: `http://127.0.0.1:${port}` };
}

function signedRequest(stripe, eventObj) {
  const payload = JSON.stringify(eventObj);
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, header };
}

async function postWebhook(base, payload, signature) {
  return fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
}

test("webhook: bad signature is rejected with 400", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const payload = JSON.stringify({
    id: "evt_bad_sig",
    type: "checkout.session.completed",
    data: { object: { id: "cs_bad_sig" } },
  });
  const res = await postWebhook(base, payload, "t=1,v1=not_a_real_signature");
  assert.equal(res.status, 400);
});

test("webhook: pass purchase creates a pass key with no theme list", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_pass_1", [{ price: { id: "price_pass_test" } }]],
  ]);
  const { server, base, stripe, db } = await startApp({ lineItemsBySession });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_pass",
    type: "checkout.session.completed",
    data: { object: { id: "cs_pass_1" } },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);

  const record = findBySession(db, "cs_pass_1");
  assert.ok(record, "expected a key to be created for the session");
  assert.equal(record.kind, "pass");
  assert.deepEqual(record.themes, []);
});

test("webhook: single-theme purchase creates a themes key carrying that theme", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_theme_1", [{ price: { id: "price_nebula_test" } }]],
  ]);
  const { server, base, stripe, db } = await startApp({ lineItemsBySession });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_theme",
    type: "checkout.session.completed",
    data: { object: { id: "cs_theme_1" } },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);

  const record = findBySession(db, "cs_theme_1");
  assert.ok(record);
  assert.equal(record.kind, "themes");
  assert.deepEqual(record.themes, ["nebula"]);
});

test("webhook: unknown price ids are ignored, not treated as an error", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_unknown_1", [{ price: { id: "price_totally_unrecognized" } }]],
  ]);
  const { server, base, stripe, db } = await startApp({ lineItemsBySession });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_unknown",
    type: "checkout.session.completed",
    data: { object: { id: "cs_unknown_1" } },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);
  assert.equal(findBySession(db, "cs_unknown_1"), null);
});

test("webhook: replaying the same completed session does not create a duplicate key", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_replay_1", [{ price: { id: "price_nebula_test" } }]],
  ]);
  const { server, base, stripe, db } = await startApp({ lineItemsBySession });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_replay",
    type: "checkout.session.completed",
    data: { object: { id: "cs_replay_1" } },
  });

  const res1 = await postWebhook(base, payload, header);
  assert.equal(res1.status, 200);
  const record1 = findBySession(db, "cs_replay_1");

  const res2 = await postWebhook(base, payload, header);
  assert.equal(res2.status, 200);
  const record2 = findBySession(db, "cs_replay_1");

  assert.equal(record1.key, record2.key);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM keys WHERE stripe_session = ?")
    .get("cs_replay_1").n;
  assert.equal(count, 1);
});
