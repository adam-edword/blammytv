import test from "node:test";
import assert from "node:assert/strict";
import { generateKey, KEY_ALPHABET } from "../src/keygen.js";

test("generateKey: matches BTV-XXXX-XXXX-XXXX-XXXX using the Crockford32 alphabet", () => {
  const key = generateKey();
  const group = `[${KEY_ALPHABET}]{4}`;
  const pattern = new RegExp(`^BTV-${group}-${group}-${group}-${group}$`);
  assert.match(key, pattern);
});

test("generateKey: never emits visually ambiguous letters (I, L, O, U)", () => {
  for (let i = 0; i < 500; i++) {
    const key = generateKey();
    assert.equal(/[ILOU]/.test(key), false, `key ${key} contained an excluded letter`);
  }
});

test("generateKey: is uniform enough to be collision-free across many samples", () => {
  const n = 5000;
  const keys = new Set();
  for (let i = 0; i < n; i++) keys.add(generateKey());
  assert.equal(keys.size, n);
});
