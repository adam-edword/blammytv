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
