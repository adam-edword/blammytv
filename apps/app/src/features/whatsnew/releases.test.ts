import { describe, expect, it } from "vitest";
import { NEWEST, RELEASES, type Rich } from "./releases";

const text = (r: Rich) => r.map((p) => (typeof p === "string" ? p : p.b)).join("");

describe("RELEASES", () => {
  it("lists releases newest first, each a major.minor once", () => {
    const keys = RELEASES.map((r) => {
      expect(r.version, r.version).toMatch(/^\d+\.\d+$/);
      const [a, b] = r.version.split(".").map(Number);
      return a * 1000 + b;
    });
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort((x, y) => y - x));
  });

  it("gives every release sections with a title and bullets", () => {
    for (const r of RELEASES) {
      expect(r.sections.length, r.version).toBeGreaterThan(0);
      for (const s of r.sections) {
        expect(s.title.trim(), r.version).not.toBe("");
        expect(s.bullets.length, `${r.version} ${s.title}`).toBeGreaterThan(0);
        for (const b of s.bullets) expect(text(b).trim(), `${r.version} ${s.title}`).not.toBe("");
      }
    }
  });

  it("gives the launch screen to the newest release alone: two headliners and four more", () => {
    expect(NEWEST).toBe(RELEASES[0]);
    expect(NEWEST.spotlight?.headliners).toHaveLength(2);
    expect(NEWEST.spotlight?.also).toHaveLength(4);
    expect(NEWEST.spotlight?.sub.trim()).not.toBe("");
    for (const r of RELEASES.slice(1)) expect(r.spotlight, r.version).toBeUndefined();
  });

  it("holds the house style: no em dashes anywhere in the copy", () => {
    const all = RELEASES.flatMap((r) => [
      r.date ?? "",
      r.spotlight?.sub ?? "",
      ...(r.spotlight?.headliners.flatMap((h) => [h.title, h.text]) ?? []),
      ...(r.spotlight?.also.flatMap((a) => [a.title, a.text]) ?? []),
      ...r.sections.flatMap((s) => [s.title, ...s.bullets.map(text)]),
    ]);
    for (const line of all) expect(line).not.toContain("—");
  });
});
