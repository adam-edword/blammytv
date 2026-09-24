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

  it("keeps nothing past the origin when the password holds ) or '", () => {
    // encodeURIComponent leaves '()!* alone, so these reach the URL as-is,
    // and the old pattern stopped at the first one and leaked the rest.
    const paren = scrubbedMessage(
      new Error(
        "error sending request for url (http://h.example/get.php?username=a&password=se)cret&type=m3u)",
      ),
    );
    expect(paren).toBe("error sending request for url (http://h.example/…)");
    expect(paren).not.toContain("cret");
    const quote = scrubbedMessage(
      new Error("failed: 'http://h.example/live/u/pa'ss/1.ts'"),
    );
    expect(quote).toBe("failed: 'http://h.example/…'");
    expect(quote).not.toContain("ss/1");
  });

  it("drops a TMDB api_key with the rest of the query", () => {
    const out = scrubbedMessage(
      new Error(
        "error sending request for url (https://api.themoviedb.org/3/search/keyword?api_key=abc123secret&query=space)",
      ),
    );
    expect(out).toBe("error sending request for url (https://api.themoviedb.org/…)");
    expect(out).not.toContain("abc123secret");
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
