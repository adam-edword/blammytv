// The bundled binaries' pins (plan 018, N5): which of this repo's deps-*
// releases holds the ffmpeg and libmpv the app ships, and each archive's
// SHA-256. scripts/deps.json is the record, written by mirror-deps.mjs in
// the "Mirror bundled binaries" workflow; fetch-ffmpeg.mjs and
// fetch-libmpv.mjs download from that release and refuse anything that
// doesn't match it.
//
// WHY A COPY HERE. Both come from shinchiro/mpv-winbuild-cmake, which keeps
// only its last ~30 builds (its tags ran 2026-06-02 to 2026-09-26), so a pin
// to its own downloads would stop working a few months on. And "latest"
// meant CI could test one ffmpeg while a release shipped another, with
// nothing checking either was the file expected.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PINS = join(dirname(fileURLToPath(import.meta.url)), "deps.json");

/** The pins, or null when scripts/deps.json is missing. */
export function loadPins() {
  return existsSync(PINS) ? JSON.parse(readFileSync(PINS, "utf8")) : null;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export async function download(url) {
  const r = await fetch(url, { headers: { "user-agent": "blammytv-build" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * The pinned archive for `which` ("ffmpeg" or "libmpv"), verified, as
 * { name, buf }. `fail` is called, and never returns, when nothing is
 * pinned, or on a download that fails or doesn't match its hash. There is
 * no unpinned path.
 * BLAMMYTV_DEPS_BASE points the download elsewhere, for testing the check.
 */
export async function fetchPinned(which, fail) {
  const pins = loadPins();
  const pin = pins?.[which];
  if (!pin)
    fail(
      `no ${which} pinned in scripts/deps.json: run the "Mirror bundled binaries" workflow`,
    );
  const base =
    process.env.BLAMMYTV_DEPS_BASE ??
    `https://github.com/${pins.repo}/releases/download/${pins.release}`;
  const url = `${base}/${pin.asset}`;
  let buf;
  try {
    buf = await download(url);
  } catch (e) {
    fail(`download: ${e.message}`);
  }
  const got = sha256(buf);
  if (got !== pin.sha256) {
    fail(
      `${pin.asset} is not the file pinned in scripts/deps.json:\n` +
        `  pinned  ${pin.sha256}\n  got     ${got}\nNot using it.`,
    );
  }
  console.log(`pinned: ${pin.asset} from ${pins.release}, SHA-256 checked`);
  return { name: pin.asset, buf };
}
