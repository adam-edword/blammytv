import { describe, expect, it } from "vitest";
import { startNote } from "./useSignIn";

describe("startNote", () => {
  it.each([
    ["denied: wrong user name or password", /Wrong user name or password/],
    ["unsupported-build: this BlammyTV needs its update", /latest BlammyTV/],
    ["unsupported: that is an AIOStreams server", /AIOStreams address/],
    ["unsupported: Jellyfin 10.8.13 is too old", /tested on Jellyfin 12\.x/],
    ["unsupported: Quick Connect is turned off", /password/],
    ["unsupported: not a Jellyfin server", /not a Jellyfin server/],
    ["not a server address", /server address/],
    ["an address cannot carry a user name", /Leave the user name/],
  ])("%s", (why, want) => {
    expect(startNote(new Error(why))).toMatch(want);
  });

  it("shows where a redirecting address goes, from native's own words", () => {
    const note = startNote(
      new Error("redirected: That address sends you to https://jf.example.com. Use that address instead."),
    );
    expect(note).toBe("That address sends you to https://jf.example.com. Use that address instead.");
  });

  it("never says Jellyfin 10.9", () => {
    expect(startNote(new Error("unsupported: This Jellyfin server is too old for BlammyTV"))).not.toMatch(/10\.9/);
  });

  it("cuts a URL in an unknown failure down to its origin", () => {
    const note = startNote(new Error("connect error to https://jf.example.com/System/Info?ApiKey=abc123"));
    expect(note).not.toMatch(/ApiKey|abc123|System/);
    expect(note.startsWith("Jellyfin didn't answer")).toBe(true);
  });
});
