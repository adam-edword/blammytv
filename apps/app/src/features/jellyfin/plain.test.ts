import { describe, expect, it } from "vitest";
import { sendsPlain } from "./plain";

describe("sendsPlain", () => {
  it.each([
    ["192.168.1.20:8096", true],
    ["192.168.1.20", true],
    ["jellyfin.lan:8096", true],
    ["http://nas.local:8096", true],
    ["http://jellyfin.example.com", true],
    ["[fd00::2]:8096", true],
    ["jellyfin.example.com", false],
    ["https://jellyfin.example.com", false],
    ["https://192.168.1.20:8920", false],
    ["localhost:8096", false],
    ["127.0.0.1", false],
    ["http://127.0.0.1:8096", false],
    ["[::1]:8096", false],
    ["", false],
    ["   ", false],
    ["http://", false],
  ])("%s", (address, plain) => {
    expect(sendsPlain(address)).toBe(plain);
  });

  it("says nothing about an address that is not a server", () => {
    expect(sendsPlain("ftp://nas")).toBe(false);
    expect(sendsPlain(undefined)).toBe(false);
  });
});
