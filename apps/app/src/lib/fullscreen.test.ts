import { describe, expect, it } from "vitest";
import { sizesAgree } from "./fullscreen";

describe("sizesAgree", () => {
  it("agrees on the same size", () => {
    expect(sizesAgree([1600, 900], [1600, 900])).toBe(true);
  });

  it("agrees within 2 physical px, each way, on each axis", () => {
    expect(sizesAgree([1600, 900], [1602, 900])).toBe(true);
    expect(sizesAgree([1600, 900], [1598, 900])).toBe(true);
    expect(sizesAgree([1600, 900], [1600, 902])).toBe(true);
    expect(sizesAgree([1600, 900], [1600, 898])).toBe(true);
    expect(sizesAgree([1600, 900], [1602, 898])).toBe(true);
  });

  it("disagrees at 3px off, on either axis", () => {
    expect(sizesAgree([1600, 900], [1603, 900])).toBe(false);
    expect(sizesAgree([1600, 900], [1597, 900])).toBe(false);
    expect(sizesAgree([1600, 900], [1600, 903])).toBe(false);
    expect(sizesAgree([1600, 900], [1600, 897])).toBe(false);
  });

  it("disagrees when one axis is right and the other is far off", () => {
    expect(sizesAgree([1600, 900], [1600, 1440])).toBe(false);
    expect(sizesAgree([1600, 900], [2560, 900])).toBe(false);
  });

  it("disagrees on the friend's case: the window went fullscreen, the page did not", () => {
    expect(sizesAgree([1600, 900], [2560, 1440])).toBe(false);
  });
});
