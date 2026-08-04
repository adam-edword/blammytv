import { describe, expect, it } from "vitest";
import { splitName } from "./playerName";

describe("splitName", () => {
  it("puts the surname on the big line", () => {
    expect(splitName("Alex Michelsen")).toEqual({
      first: "Alex",
      last: "Michelsen",
    });
  });

  it("keeps every given name together, however many there are", () => {
    // "Victoria Jimenez Kasintseva" is a real entrant on the board this was
    // built against. Splitting on the FIRST space would caption her card
    // "Jimenez Kasintseva" as the given name.
    expect(splitName("Jan-Lennard Struff")).toEqual({
      first: "Jan-Lennard",
      last: "Struff",
    });
    expect(splitName("Victoria Jimenez Kasintseva")).toEqual({
      first: "Victoria Jimenez",
      last: "Kasintseva",
    });
  });

  it("leaves a DOUBLES PAIR whole", () => {
    // Not a person. Taking the last word would caption the card with half
    // a team, and doubles is 37 of 175 matches on a real board.
    expect(splitName("Bopanna/Ebden")).toEqual({ last: "Bopanna/Ebden" });
  });

  it("leaves a single word alone rather than inventing a given name", () => {
    expect(splitName("Monfils")).toEqual({ last: "Monfils" });
    expect(splitName("")).toEqual({ last: "" });
  });
});
