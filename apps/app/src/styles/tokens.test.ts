import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `.on-picture` repeats four of the dark block's values (plan 022): a
 * subtree cannot reach back to a block the root no longer matches, so the
 * picture scope restates them. This holds the copies equal, so a change to
 * the dark palette can't leave the hero's buttons on the old one.
 */
const CSS = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

/** The declarations of the first block whose selector list starts with `head`. */
function block(head: string): Map<string, string> {
  const at = CSS.indexOf(`\n${head}`);
  if (at < 0) throw new Error(`no block starting "${head}"`);
  const open = CSS.indexOf("{", at);
  const body = CSS.slice(open + 1, CSS.indexOf("}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

describe("tokens.css", () => {
  it("a picture's ink is the dark theme's ink", () => {
    const dark = block(":root {");
    const picture = block(".on-picture,");
    for (const name of ["--bg", "--text", "--text-muted", "--text-dim"]) {
      expect(picture.get(name), name).toBeDefined();
      expect(picture.get(name), name).toBe(dark.get(name));
    }
  });

  it("and its accent, when none was picked, is the dark theme's", () => {
    const dark = block(":root {");
    const picture = block(":root:not([data-accent]) .on-picture,");
    for (const name of ["--accent", "--accent-ink"]) {
      expect(picture.get(name), name).toBeDefined();
      expect(picture.get(name), name).toBe(dark.get(name));
    }
  });

  it("the title page's ground, until its art lands, is dark's card colour", () => {
    // The page wears .on-picture, which doesn't remap --surface (white in
    // light), so stream.css says dark's value itself.
    const dark = block(":root {");
    const stream = readFileSync(fileURLToPath(new URL("./stream.css", import.meta.url)), "utf8");
    const at = stream.indexOf("\n.vod-detail {");
    expect(at).toBeGreaterThan(-1);
    const ground = /background:\s*([^;]+);/.exec(stream.slice(at, stream.indexOf("}", at)))?.[1].trim();
    expect(ground).toBe(dark.get("--surface"));
  });
});
