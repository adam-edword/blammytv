import { z } from "zod";

/**
 * Device pairing.
 *
 * The share code is the ONE allowed on-device text input (first-launch
 * pairing/auth — not config, so it doesn't break the dumb-terminal rule).
 * Format: 6 characters, A–Z and 2–9, deliberately excluding easily-confused
 * glyphs (0/O, 1/I) so it's boomer-proof to type from a TV screen.
 */

export const SHARE_CODE_LENGTH = 6;
export const SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const ShareCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-HJ-NP-Z2-9]{6}$/,
    "share code is 6 characters (letters and numbers, no O/0 or I/1)",
  );
export type ShareCode = z.infer<typeof ShareCodeSchema>;

/** Normalize raw user input toward a candidate share code (for live input UX). */
export function normalizeShareCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, "")
    .slice(0, SHARE_CODE_LENGTH);
}

export function isCompleteShareCode(raw: string): boolean {
  return ShareCodeSchema.safeParse(raw).success;
}
