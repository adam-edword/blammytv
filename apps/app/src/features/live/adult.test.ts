import { describe, expect, it } from "vitest";
import { isAdultCategory, isAdultStream, nameLooksAdult } from "./adult";

describe("nameLooksAdult", () => {
  it("catches the unambiguous markers, word-bounded", () => {
    for (const name of [
      "XXX",
      "XXX | VIP",
      "Adult",
      "ADULTS ONLY",
      "For Adults",
      "18+",
      "Movies 18+",
      "Porn",
      "PORNO HD",
      "Erotic",
      "Erotica Nights",
    ]) {
      expect(nameLooksAdult(name), name).toBe(true);
    }
  });

  it("leaves innocent names alone (conservative by design)", () => {
    for (const name of [
      "Adult Swim", // the classic false positive
      "XXXL Sports", // no word boundary after xxx
      "U18 Football", // 18 without the +
      "News",
      "Documentaries",
      "Kids",
    ]) {
      expect(nameLooksAdult(name), name).toBe(false);
    }
  });
});

describe("isAdultCategory", () => {
  it("trusts the panel flag even with an innocent name", () => {
    expect(isAdultCategory({ id: "1", name: "VIP Extra", adult: true })).toBe(
      true,
    );
  });

  it("falls back to the name when the panel doesn't flag", () => {
    expect(isAdultCategory({ id: "1", name: "XXX VIP", adult: false })).toBe(
      true,
    );
    expect(isAdultCategory({ id: "1", name: "Sports", adult: false })).toBe(
      false,
    );
  });
});

describe("isAdultStream", () => {
  it("coerces the panel's string-typed flag", () => {
    expect(isAdultStream({ stream_id: 1, is_adult: 1 })).toBe(true);
    expect(isAdultStream({ stream_id: 1, is_adult: "1" })).toBe(true);
    expect(isAdultStream({ stream_id: 1, is_adult: 0 })).toBe(false);
    expect(isAdultStream({ stream_id: 1, is_adult: "0" })).toBe(false);
    expect(isAdultStream({ stream_id: 1 })).toBe(false);
    expect(isAdultStream({ stream_id: 1, is_adult: null })).toBe(false);
  });
});
