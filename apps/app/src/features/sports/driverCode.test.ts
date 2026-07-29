import { describe, expect, it } from "vitest";
import { driverCode } from "./driverCode";

describe("driverCode", () => {
  it("takes the first three of the surname, which is how F1 assigns most", () => {
    expect(driverCode("Lando Norris")).toBe("NOR");
    expect(driverCode("Max Verstappen")).toBe("VER");
    expect(driverCode("Oscar Piastri")).toBe("PIA");
    expect(driverCode("Charles Leclerc")).toBe("LEC");
    expect(driverCode("Lewis Hamilton")).toBe("HAM");
  });

  it("drops accents rather than shouting them", () => {
    // Otherwise Hülkenberg reads HÜL, which is not a caption anyone uses.
    expect(driverCode("Nico Hülkenberg")).toBe("HUL");
    expect(driverCode("Sergio Pérez")).toBe("PER");
  });

  it("copes with one name and with extra ones", () => {
    expect(driverCode("Zhou")).toBe("ZHO");
    // The LAST word is the surname, so a middle name cannot displace it.
    expect(driverCode("Kimi Andrea Antonelli")).toBe("ANT");
  });
});
