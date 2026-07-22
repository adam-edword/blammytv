import { randomInt } from "node:crypto";

/**
 * BTV-XXXX-XXXX-XXXX-XXXX keys: 20 chars from a Crockford-base32 alphabet
 * (no 0/O/1/I — nothing a human can misread copying it off a TV screen or
 * typing it back in). crypto-random per character via node:crypto's
 * randomInt, which is uniform (no modulo bias) unlike Math.random().
 *
 * Uniqueness is NOT this module's job — db.js's PK constraint + retry loop
 * owns that. This just produces one candidate.
 */
// Crockford base32: digits 0-9 plus A-Z with I, L, O, U dropped (32 symbols).
// Since O and I never appear, 0 vs O and 1 vs I are never both on the table
// at once — that's the whole "no ambiguity" property, not a second filter.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const GROUPS = 4;
const GROUP_LEN = 4;

export function generateKey() {
  let chars = "";
  for (let i = 0; i < GROUPS * GROUP_LEN; i++) {
    chars += ALPHABET[randomInt(ALPHABET.length)];
  }
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(chars.slice(g * GROUP_LEN, g * GROUP_LEN + GROUP_LEN));
  }
  return `BTV-${groups.join("-")}`;
}

export const KEY_ALPHABET = ALPHABET;
