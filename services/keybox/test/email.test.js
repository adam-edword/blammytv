import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { openDb, getKey } from "../src/db.js";
import { buildCatalog } from "../src/catalog.js";
import { makeApp } from "../src/server.js";
import { createMailer } from "../src/mailer.js";

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

// Same stub shape as webhook.test.js: real Stripe SDK for signature
// verification, only listLineItems stubbed.
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

// Records every sendKeyEmail call; `impl` lets a test override behavior
// (e.g. throw) without duplicating the recording logic.
function makeFakeMailer(impl) {
  const calls = [];
  return {
    calls,
    mailer: {
      async sendKeyEmail(args) {
        calls.push(args);
        if (impl) return impl(args);
        return { sent: true };
      },
    },
  };
}

async function startApp({ lineItemsBySession = new Map(), mailer } = {}) {
  const db = openDb(":memory:");
  const catalog = testCatalog();
  const stripe = makeStripeStub(lineItemsBySession);
  const app = makeApp({ db, stripe, catalog, webhookSecret: WEBHOOK_SECRET, mailer });
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

test("createMailer({}): no-op mailer never throws and reports not_configured", async () => {
  const mailer = createMailer({});
  const result = await mailer.sendKeyEmail({
    to: "buyer@example.com",
    key: "BTV-TEST-TEST-TEST-TEST",
    kind: "pass",
    themeNames: [],
  });
  assert.deepEqual(result, { sent: false, reason: "not_configured" });
});

test("createMailer({apiKey}) without from is still the no-op path", async () => {
  const mailer = createMailer({ apiKey: "re_test_key" });
  const result = await mailer.sendKeyEmail({ to: "x@example.com", key: "k", kind: "pass" });
  assert.deepEqual(result, { sent: false, reason: "not_configured" });
});

test("webhook: pass purchase with a buyer email sends exactly one key email and marks emailed_at", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_email_pass", [{ price: { id: "price_pass_test" } }]],
  ]);
  const { calls, mailer } = makeFakeMailer();
  const { server, base, stripe, db } = await startApp({ lineItemsBySession, mailer });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_email_pass",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_email_pass",
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, "buyer@example.com");
  assert.equal(calls[0].kind, "pass");
  assert.equal(typeof calls[0].key, "string");

  const row = db.prepare("SELECT * FROM keys WHERE stripe_session = ?").get("cs_email_pass");
  assert.ok(row.emailed_at, "expected emailed_at to be set after a successful send");

  const record = getKey(db, row.key);
  assert.equal(record.key, calls[0].key);
});

test("webhook: replaying an already-emailed session does not send a second email", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_email_replay", [{ price: { id: "price_nebula_test" } }]],
  ]);
  const { calls, mailer } = makeFakeMailer();
  const { server, base, stripe } = await startApp({ lineItemsBySession, mailer });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_email_replay",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_email_replay",
        customer_details: { email: "buyer@example.com" },
      },
    },
  });

  const res1 = await postWebhook(base, payload, header);
  assert.equal(res1.status, 200);
  const res2 = await postWebhook(base, payload, header);
  assert.equal(res2.status, 200);

  assert.equal(calls.length, 1, "expected the replay to be gated by emailed_at, not re-sent");
});

test("webhook: a mailer that throws does not fail key creation or the webhook response", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_email_fail", [{ price: { id: "price_pass_test" } }]],
  ]);
  const { calls, mailer } = makeFakeMailer(async () => {
    throw new Error("simulated Resend outage");
  });
  const { server, base, stripe, db } = await startApp({ lineItemsBySession, mailer });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_email_fail",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_email_fail",
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "expected the send to have been attempted");

  const row = db.prepare("SELECT * FROM keys WHERE stripe_session = ?").get("cs_email_fail");
  assert.ok(row, "expected the key to still be created despite the email failure");
  assert.equal(row.emailed_at, null, "expected emailed_at to stay NULL after a failed send");
});

test("webhook: a session with no buyer email creates a key without sending or erroring", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_email_none", [{ price: { id: "price_pass_test" } }]],
  ]);
  const { calls, mailer } = makeFakeMailer();
  const { server, base, stripe, db } = await startApp({ lineItemsBySession, mailer });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_email_none",
    type: "checkout.session.completed",
    data: { object: { id: "cs_email_none" } },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);

  assert.equal(calls.length, 0);
  const row = db.prepare("SELECT * FROM keys WHERE stripe_session = ?").get("cs_email_none");
  assert.ok(row, "expected the key to still be created");
  assert.equal(row.emailed_at, null);
});

test("webhook: makeApp with no mailer arg (default no-op) still creates keys and returns 200", async (t) => {
  const lineItemsBySession = new Map([
    ["cs_email_default", [{ price: { id: "price_pass_test" } }]],
  ]);
  // No `mailer` passed to startApp -> makeApp's default NOOP_MAILER.
  const { server, base, stripe, db } = await startApp({ lineItemsBySession });
  t.after(() => server.close());

  const { payload, header } = signedRequest(stripe, {
    id: "evt_email_default",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_email_default",
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
  const res = await postWebhook(base, payload, header);
  assert.equal(res.status, 200);

  const row = db.prepare("SELECT * FROM keys WHERE stripe_session = ?").get("cs_email_default");
  assert.ok(row, "expected the key to be created via the default no-op mailer path");
  assert.equal(row.emailed_at, null, "no-op mailer never marks emailed_at");
});
