import { describe, expect, it } from "vitest";
import { parseConnections } from "./xtream";

describe("parseConnections", () => {
  it("coerces the panel's string-typed counters", () => {
    expect(parseConnections({ active_cons: "2", max_connections: "5" })).toEqual(
      { active: 2, max: 5 },
    );
    expect(parseConnections({ active_cons: 0, max_connections: 1 })).toEqual({
      active: 0,
      max: 1,
    });
  });

  it("returns null when the panel reports no usable limit", () => {
    expect(parseConnections(undefined)).toBeNull();
    expect(parseConnections({})).toBeNull();
    expect(parseConnections({ active_cons: "2" })).toBeNull();
    expect(
      parseConnections({ active_cons: null, max_connections: "5" }),
    ).toBeNull();
    // Junk panels: "0" max while serving streams, or non-numeric strings.
    expect(
      parseConnections({ active_cons: "1", max_connections: "0" }),
    ).toBeNull();
    expect(
      parseConnections({ active_cons: "abc", max_connections: "5" }),
    ).toBeNull();
    expect(
      parseConnections({ active_cons: "-1", max_connections: "5" }),
    ).toBeNull();
  });
});
