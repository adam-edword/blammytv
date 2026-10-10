import { describe, expect, it } from "vitest";
import { clipsTitle, titleText } from "./titleFit";

describe("titleText", () => {
  it("lays a title out the way white-space: nowrap does", () => {
    expect(titleText("  Late   Movie \n")).toBe("Late Movie");
    expect(titleText("A\tB")).toBe("A B");
    expect(titleText("News")).toBe("News");
  });
});

describe("clipsTitle", () => {
  it("is the DOM's test, scrollWidth > clientWidth + 1, on whole pixels", () => {
    // Fits, and fills the room exactly.
    expect(clipsTitle(100, 200)).toBe(false);
    expect(clipsTitle(200, 200)).toBe(false);
    // One pixel over is inside the tolerance, two is a fade.
    expect(clipsTitle(201, 200)).toBe(false);
    expect(clipsTitle(202, 200)).toBe(true);
  });

  it("rounds both sides, as the browser snaps them", () => {
    expect(clipsTitle(200.4, 199.6)).toBe(false); // 200 vs 200
    expect(clipsTitle(201.4, 199.6)).toBe(false); // 201 vs 200 + 1
    expect(clipsTitle(201.6, 199.6)).toBe(true); // 202 vs 200 + 1
  });

  it("fades any real text in a cell with no room left", () => {
    expect(clipsTitle(40, 0)).toBe(true);
    expect(clipsTitle(40, -26)).toBe(true); // a 4px cell less 30px of chrome
    expect(clipsTitle(1, -26)).toBe(false);
  });
});
