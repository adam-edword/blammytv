import { describe, expect, it } from "vitest";
import { USER_AGENT_MAX, agentHeaders, cleanUserAgent, userAgentOk } from "./userAgent";

describe("userAgentOk", () => {
  it("takes nothing, and an agent", () => {
    for (const ok of ["", "   ", "VLC/3.0.20 LibVLC/3.0.20", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "  padded  "])
      expect(userAgentOk(ok), JSON.stringify(ok)).toBe(true);
  });

  it("refuses a control character, a line break, and anything past ASCII", () => {
    for (const bad of ["a\nb", "a\r\nX-Evil: 1", "tab\there", "nul\u0000x", "del\u007fx", "caf\u00e9", "a\u2028b", "emoji \u{1f600}"])
      expect(userAgentOk(bad), JSON.stringify(bad)).toBe(false);
  });

  it("trims the way a save does: a stray line separator at the ends is not part of it", () => {
    expect(userAgentOk("\u2028x\u2029")).toBe(true);
    expect(cleanUserAgent("\u2028x\u2029")).toBe("x");
  });

  it("refuses one that is too long, and takes one that is exactly as long as may be", () => {
    expect(userAgentOk("a".repeat(USER_AGENT_MAX))).toBe(true);
    expect(userAgentOk("a".repeat(USER_AGENT_MAX + 1))).toBe(false);
    // The spaces around it do not count against it.
    expect(userAgentOk(` ${"a".repeat(USER_AGENT_MAX)} `)).toBe(true);
  });
});

describe("cleanUserAgent", () => {
  it("is the agent, trimmed", () => {
    expect(cleanUserAgent("  VLC/3.0.20  ")).toBe("VLC/3.0.20");
  });

  it("is none for nothing, for a blank, and for what is not text", () => {
    for (const none of [undefined, null, "", "   ", 7, {}, [], true])
      expect(cleanUserAgent(none), JSON.stringify(none)).toBeUndefined();
  });

  it("is none for an agent no header can hold, so a bad save puts nothing on a request", () => {
    for (const bad of ["a\r\nX-Evil: 1", "caf\u00e9", "a".repeat(USER_AGENT_MAX + 1)])
      expect(cleanUserAgent(bad), JSON.stringify(bad)).toBeUndefined();
  });
});

describe("agentHeaders", () => {
  it("is a User-Agent header for an agent", () => {
    expect(agentHeaders("VLC/3.0.20")).toEqual({ "User-Agent": "VLC/3.0.20" });
  });

  it("is undefined, not an empty object, for none: the request is the one it always was", () => {
    expect(agentHeaders(undefined)).toBeUndefined();
    expect(agentHeaders("")).toBeUndefined();
  });
});
