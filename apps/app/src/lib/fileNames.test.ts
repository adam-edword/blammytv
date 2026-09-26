import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No two names in a folder that differ only by case.
 *
 * Windows ignores case in file names, and an import leaves the extension
 * off, so Vite tries `.ts` before `.tsx`. With `MvScores.tsx` next to
 * `mvScores.ts`, `import … from "./MvScores"` loaded the `.ts` file on
 * Windows, missed the component it wanted, and the whole app mounted
 * nothing: a black screen (v0.10.6). Linux, where CI and the harnesses run,
 * is case-sensitive and never saw it.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

function clashes(dir: string): string[] {
  const found: string[] = [];
  const byKey = new Map<string, Set<string>>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) found.push(...clashes(join(dir, e.name)));
    // What an import names: the file without its last extension.
    const name = e.isDirectory() ? e.name : e.name.replace(/\.[^.]+$/, "");
    const key = name.toLowerCase();
    byKey.set(key, (byKey.get(key) ?? new Set()).add(name));
  }
  for (const names of byKey.values())
    if (names.size > 1) found.push(`${dir}: ${[...names].join(" / ")}`);
  return found;
}

describe("file names", () => {
  it("never differ only by case within a folder", () => {
    expect(clashes(SRC)).toEqual([]);
  });
});
