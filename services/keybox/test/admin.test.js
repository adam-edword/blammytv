import test from "node:test";
import assert from "node:assert/strict";
import {
  openDb,
  createKey,
  touchActivation,
  listKeys,
  deleteKey,
  getKey,
  activationCount,
} from "../src/db.js";
import { resolveEmails, keysForEmail } from "../scripts/admin.mjs";

// The db-layer behaviour behind scripts/admin.mjs (mint/list/revoke), the
// unlimited-key activation bypass, and the CLI's Stripe-backed buyer-email
// lookup (list's email column + the `email <ADDRESS>` command).

test("createKey: unlimited flag round-trips (and defaults to false)", () => {
  const db = openDb(":memory:");

  const normal = createKey(db, { kind: "pass", session: "cs_a" });
  assert.equal(normal.unlimited, false);

  const admin = createKey(db, { kind: "pass", unlimited: true, session: null });
  assert.equal(admin.unlimited, true);
  // Re-read from the DB to prove it persisted, not just echoed back.
  assert.equal(getKey(db, admin.key).unlimited, true);
});

test("touchActivation: default cap unchanged; an explicit Infinity never caps", () => {
  const db = openDb(":memory:");
  const { key } = createKey(db, { kind: "pass", unlimited: true, session: null });

  // Default limit (no 4th arg) still caps at ACTIVATION_LIMIT (3).
  assert.equal(touchActivation(db, key, "d1").ok, true);
  assert.equal(touchActivation(db, key, "d2").ok, true);
  assert.equal(touchActivation(db, key, "d3").ok, true);
  assert.equal(touchActivation(db, key, "d4").limit, true);

  // A fresh unlimited key with Infinity accepts machine after machine.
  const admin = createKey(db, { kind: "pass", unlimited: true, session: null });
  for (let i = 0; i < 7; i++) {
    assert.equal(touchActivation(db, admin.key, `mac${i}`, Infinity).ok, true);
  }
  assert.equal(activationCount(db, admin.key), 7);
});

test("listKeys: returns every key, newest first, with activation counts", () => {
  const db = openDb(":memory:");
  const a = createKey(db, { kind: "themes", themes: ["nebula"], session: "cs_1" });
  const b = createKey(db, { kind: "pass", unlimited: true, session: null });
  touchActivation(db, b.key, "m1", Infinity);
  touchActivation(db, b.key, "m2", Infinity);

  const keys = listKeys(db);
  assert.equal(keys.length, 2);
  // Newest first: b was created after a.
  assert.equal(keys[0].key, b.key);
  assert.equal(keys[0].unlimited, true);
  assert.equal(keys[0].activationCount, 2);
  const rowA = keys.find((k) => k.key === a.key);
  assert.equal(rowA.activationCount, 0);
  assert.deepEqual(rowA.themes, ["nebula"]);
});

test("deleteKey: revokes the key and all its activations", () => {
  const db = openDb(":memory:");
  const { key } = createKey(db, { kind: "pass", unlimited: true, session: null });
  touchActivation(db, key, "m1", Infinity);
  touchActivation(db, key, "m2", Infinity);
  assert.equal(activationCount(db, key), 2);

  assert.equal(deleteKey(db, key), true);
  assert.equal(getKey(db, key), null);
  assert.equal(activationCount(db, key), 0); // activations gone too
  assert.equal(listKeys(db).length, 0);

  // Revoking a nonexistent key is a no-op that reports false.
  assert.equal(deleteKey(db, "BTV-0000-0000-0000-0000"), false);
});

// Stub Stripe client: emails keyed by session id; sessions absent from the
// table throw, like a real retrieve() on an unknown/foreign-mode session.
function stubStripe(emailBySession, calls = []) {
  return {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          calls.push(id);
          if (!(id in emailBySession)) throw new Error(`No such checkout.session: ${id}`);
          return { customer_details: { email: emailBySession[id] } };
        },
      },
    },
  };
}

test("resolveEmails: one fetch per distinct session; failures and manual keys stay out of the map", async () => {
  const calls = [];
  const stripe = stubStripe({ cs_1: "buyer@site.test", cs_2: null }, calls);
  const keys = [
    { key: "K1", stripeSession: "cs_1" },
    { key: "K2", stripeSession: "cs_1" }, // same session as K1 — deduped
    { key: "K3", stripeSession: null }, // manual/minted — never queried
    { key: "K4", stripeSession: "cs_2" }, // session exists but has no email
    { key: "K5", stripeSession: "cs_gone" }, // retrieve throws
  ];

  const emails = await resolveEmails(stripe, keys);
  assert.equal(emails.get("cs_1"), "buyer@site.test");
  assert.equal(emails.get("cs_2"), null); // looked up, no email
  assert.equal(emails.has("cs_gone"), false); // lookup failed
  assert.deepEqual(calls.sort(), ["cs_1", "cs_2", "cs_gone"]); // cs_1 once, null never
});

test("keysForEmail: matches case-insensitively, skips manual keys and failed lookups", async () => {
  const stripe = stubStripe({ cs_a: "Buyer@Site.test", cs_b: "other@site.test" });
  const keys = [
    { key: "KA", stripeSession: "cs_a" },
    { key: "KB", stripeSession: "cs_b" },
    { key: "KM", stripeSession: null },
    { key: "KX", stripeSession: "cs_gone" },
  ];
  const emails = await resolveEmails(stripe, keys);

  assert.deepEqual(
    keysForEmail(keys, emails, "  buyer@site.TEST ").map((k) => k.key),
    ["KA"],
  );
  assert.deepEqual(keysForEmail(keys, emails, "nobody@site.test"), []);
});
