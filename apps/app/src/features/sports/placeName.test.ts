import { describe, expect, it } from "vitest";
import { shortPlace } from "./placeName";

describe("shortPlace", () => {
  it("leaves the fifteen countries that already fit alone", () => {
    // Every F1 country of eight characters or fewer. HUNGARY is the widest
    // of them and clears the narrowest column by 7px.
    for (const name of [
      "USA",
      "Italy",
      "Japan",
      "Spain",
      "Qatar",
      "China",
      "Brazil",
      "Mexico",
      "Monaco",
      "Canada",
      "Austria",
      "Bahrain",
      "Belgium",
      "Britain",
      "Hungary",
    ])
      expect(shortPlace(name)).toBe(name);
  });

  it("codes the six that do not", () => {
    expect(shortPlace("Australia")).toBe("AUS");
    expect(shortPlace("Singapore")).toBe("SGP");
    expect(shortPlace("Azerbaijan")).toBe("AZE");
    expect(shortPlace("Netherlands")).toBe("NED");
    expect(shortPlace("Saudi Arabia")).toBe("KSA");
    expect(shortPlace("United Arab Emirates")).toBe("UAE");
  });

  it("uses the IOC's codes, not ISO's", () => {
    // A timing screen says NED and KSA. ISO would say NL and SA, which is
    // not what anyone has seen on a broadcast.
    expect(shortPlace("Netherlands")).not.toBe("NL");
    expect(shortPlace("Saudi Arabia")).not.toBe("SA");
  });

  it("guesses at three letters for a country we have not met", () => {
    // How the IOC built most of its own codes, and right more often than
    // not. The card keeps the full name on its tooltip regardless.
    expect(shortPlace("Liechtenstein")).toBe("LIE");
    expect(shortPlace("Kazakhstan")).toBe("KAZ");
  });

  it("does not code a name that is exactly at the limit", () => {
    // Eight is the last length that fits, so it stays.
    expect(shortPlace("Portugal")).toBe("Portugal");
    expect("Portugal".length).toBe(8);
  });

  it("copes with nothing at all", () => {
    // A racing league with no circuit sends no country; five of the six do.
    expect(shortPlace("")).toBe("");
    expect(shortPlace("   ")).toBe("");
  });
});

describe("shortPlace on a wider card", () => {
  it("keeps the whole name when the column can hold it", () => {
    // The wide race card's country column is 252.9px against the small
    // card's 137, and every country F1 visits fits it: NETHERLANDS needs
    // 111.8px there. Coding it to NED is right in one column and wrong in
    // the other, so the budget is the caller's.
    expect(shortPlace("Netherlands", 20)).toBe("Netherlands");
    expect(shortPlace("Azerbaijan", 20)).toBe("Azerbaijan");
    expect(shortPlace("United Arab Emirates", 20)).toBe(
      "United Arab Emirates",
    );
  });

  it("still codes past the budget it is given", () => {
    expect(shortPlace("Netherlands", 8)).toBe("NED");
    expect(shortPlace("United Arab Emirates", 10)).toBe("UAE");
  });

  it("defaults to the small card's eight when asked for nothing", () => {
    expect(shortPlace("Netherlands")).toBe("NED");
  });
});
