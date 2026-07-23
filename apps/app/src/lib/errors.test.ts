import { describe, expect, it } from "vitest";
import { scrubbedMessage } from "./errors";

/** The credential-leak chokepoint: every user-facing/logged error passes
 * through here. These pin the invariants the app leans on. */
describe("scrubbedMessage", () => {
  it("scrubs a URL down to its origin", () => {
    expect(
      scrubbedMessage(
        new Error(
          "request failed for url (http://panel.example:8080/player_api.php?username=u&password=p)",
        ),
      ),
    ).toBe("request failed for url (http://panel.example:8080/…)");
  });

  it("strips path credentials (the AIOStreams manifest config)", () => {
    const out = scrubbedMessage(
      new Error("boom https://aio.example/eyJzZWNyZXQifQ/manifest.json"),
    );
    expect(out).toBe("boom https://aio.example/…");
    expect(out).not.toContain("eyJ");
  });

  it("scrubs every URL when a message carries several", () => {
    const out = scrubbedMessage(
      new Error(
        "tried https://a.example/user/pass then https://b.example/user2/pass2",
      ),
    );
    expect(out).toBe("tried https://a.example/… then https://b.example/…");
  });

  it("falls back to a bare https://… when the URL cannot be parsed", () => {
    // A colon-mangled authority throws in new URL().
    expect(scrubbedMessage(new Error("bad http://:9/x?u=1"))).toBe(
      "bad https://…",
    );
  });

  it("stringifies non-Error input before scrubbing", () => {
    expect(scrubbedMessage("plain https://c.example/secret failure")).toBe(
      "plain https://c.example/… failure",
    );
    expect(scrubbedMessage(42)).toBe("42");
  });
});
