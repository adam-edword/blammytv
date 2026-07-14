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

// The db-layer behaviour behind scripts/admin.mjs (mint/list/revoke) and the
// unlimited-key activation bypass.

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
