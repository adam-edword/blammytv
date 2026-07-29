import { describe, expect, it } from "vitest";
import { CIRCUIT_YEAR, art, circuit } from "./circuits";
import index from "./circuits/index.json";

/* Guards the harvest as much as the reader: the map and the files are
 * generated together and have to stay together. */
describe("the vendored circuits", () => {
  const ids = Object.keys(index.circuits);

  it("covers a full season", () => {
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(CIRCUIT_YEAR).toBeGreaterThanOrEqual(2026);
  });

  it("has art for every circuit it claims", () => {
    // The map naming a layout with no file behind it is the failure mode
    // a regeneration would introduce, and it is silent on screen.
    for (const id of ids) expect(art(id), id).toBeTruthy();
  });

  it("gives ONE stroked path, viewBoxed, in currentColor", () => {
    // All three matter and all three were learned the hard way. The
    // library's -outline styles are TWO paths, a wide stroke with a
    // narrower one inside, and both colours are literals — right on
    // exactly one background. The plain style is one path, and the harvest
    // rewrites its white to currentColor, which is what lets the card own
    // the colour and every theme pack get the right one for free.
    for (const id of ids) {
      const svg = art(id)!;
      // A viewBox and NOT a fixed width, which is the whole difference
      // between art that scales into a card and art that gets cropped at
      // 500 user units. The library ships width/height and no viewBox,
      // despite its README; the harvest swaps them.
      expect(svg, id).toContain('viewBox="0 0 500 500"');
      expect(svg, id).not.toContain('width="500"');
      expect(svg.match(/<path/g), id).toHaveLength(1);
      expect(svg, id).toContain("stroke:currentColor");
      expect(svg, id).not.toMatch(/stroke:#[0-9a-f]/i);
      expect(svg, id).toContain("fill:none");
    }
  });

  it("keeps the author's credit inside the file", () => {
    // CC-BY-4.0. The card inlines these, so the attribution has to travel
    // with the art rather than live only in a README.
    expect(art(ids[0])).toContain("julesr0y");
  });

  it("knows Hungary, which is the case the card was drawn against", () => {
    const hungaroring = circuit("613");
    expect(hungaroring?.name).toBe("Hungaroring");
    expect(hungaroring?.country).toBe("Hungary");
    expect(art("613")).toContain("<path");
  });

  it("answers undefined for a track it has no art for", () => {
    // The ordinary case for every racing league except F1.
    expect(art(undefined)).toBeUndefined();
    expect(art("99999")).toBeUndefined();
    expect(circuit("99999")).toBeUndefined();
  });
});
