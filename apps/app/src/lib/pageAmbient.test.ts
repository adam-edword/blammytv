import { describe, expect, it } from "vitest";
import { ambientFrom } from "./pageAmbient";

/** A 6 x 6 sample, each cell the colour `at(x, y)` gives. */
function sample(at: (x: number, y: number) => [number, number, number]): number[] {
  const px: number[] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) px.push(...at(x, y), 255);
  return px;
}

describe("ambientFrom", () => {
  it("gives four lights, each the average of its own part of the picture", () => {
    // Left half red, right half blue.
    const out = ambientFrom(sample((x) => (x < 3 ? [200, 0, 0] : [0, 0, 100])));
    const lights = out.split("), radial-gradient(");
    expect(lights).toHaveLength(4);
    expect(lights[0]).toContain("rgb(200 0 0 / 0.26)");
    expect(lights[1]).toContain("rgb(0 0 100 / 0.14)");
    expect(lights[2]).toContain("rgb(200 0 0 / 0.18)");
    expect(lights[3]).toContain("rgb(0 0 100 / 0.1)");
  });

  it("keeps the canvas's positions", () => {
    const out = ambientFrom(sample(() => [10, 20, 30]));
    expect(out).toContain("at 20% 6%");
    expect(out).toContain("at 80% 92%");
  });
});
