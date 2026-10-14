import { describe, expect, it } from "vitest";
import { startNote } from "./useSignIn";

describe("startNote", () => {
  it.each([
    ["denied: wrong user name or password", /Wrong user name or password/],
    ["unsupported-build: this BlammyTV needs its update", /latest BlammyTV/],
    ["unsupported: that is an AIOStreams server", /AIOStreams address/],
    ["unsupported: Jellyfin 10.8.13 is too old", /10\.9/],
    ["unsupported: Quick Connect is turned off", /password/],
    ["unsupported: not a Jellyfin server", /not a Jellyfin server/],
    ["not a server address", /server address/],
    ["an address cannot carry a user name", /Leave the user name/],
  ])("%s", (why, want) => {
    expect(startNote(new Error(why))).toMatch(want);
  });

  it("cuts a URL in an unknown failure down to its origin", () => {
    const note = startNote(new Error("connect error to https://jf.example.com/System/Info?ApiKey=abc123"));
    expect(note).not.toMatch(/ApiKey|abc123|System/);
    expect(note.startsWith("Jellyfin didn't answer")).toBe(true);
  });
});
