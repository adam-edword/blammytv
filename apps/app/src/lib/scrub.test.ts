import { describe, expect, it } from "vitest";
import { hasTokenRun, scrub } from "./scrub";

// Every secret in here is an obvious fake. A real credential does not belong in
// a test fixture that is committed.
const TOKEN = "t0k3n".repeat(8); // 40 characters
const HEX = "0123456789abcdef".repeat(2); // 32, an MD5's length
const B64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo="; // 36, padded

describe("scrub: a URL is its origin", () => {
  it("cuts an Xtream stream URL, whose credentials are in the path", () => {
    expect(scrub("http://host:8080/live/user/pass/1.ts")).toBe("http://host:8080/…");
  });

  it("cuts an AIOStreams manifest, a debrid link and a query string", () => {
    expect(scrub("fetch https://aio.example/eyJzZWNyZXQifQ/manifest.json failed")).toBe("fetch https://aio.example/… failed");
    expect(scrub("link https://cdn.debrid.example/d/FAKEKEY/file.mkv?token=abc")).toBe("link https://cdn.debrid.example/…");
    expect(scrub("https://api.example/get.php?username=u&password=p")).not.toMatch(/username|password/);
  });

  it("drops a user name and password written before the host", () => {
    const out = scrub("http://user:secret@host:8080/x");
    expect(out).toBe("http://host:8080/…");
    expect(out).not.toMatch(/user|secret/);
  });

  it("takes every URL in a line, and a password that holds ) or '", () => {
    expect(scrub("a http://one.example/p1 b https://two.example/p2")).toBe("a http://one.example/… b https://two.example/…");
    expect(scrub("failed (http://h.example/live/u/pa)ss/1.ts)")).not.toContain("ss/1");
  });
});

describe("scrub: a MAC address is masked", () => {
  it("masks it with colons or dashes, in either case", () => {
    expect(scrub("portal mac 00:1A:79:AB:CD:EF ok")).toBe("portal mac xx:xx:xx:xx:xx:xx ok");
    expect(scrub("mac=00-1a-79-ab-cd-ef")).toBe("mac=xx:xx:xx:xx:xx:xx");
  });

  it("masks every one in a line", () => {
    expect(scrub("00:1A:79:AB:CD:EF then 00:1A:79:00:00:01")).toBe("xx:xx:xx:xx:xx:xx then xx:xx:xx:xx:xx:xx");
  });

  it("leaves what is not one: a time, an address with five pairs, a mix of separators", () => {
    expect(scrub("at 10:15:30 on 127.0.0.1:8080")).toBe("at 10:15:30 on 127.0.0.1:8080");
    expect(scrub("00:1A:79:AB:CD")).toBe("00:1A:79:AB:CD");
    expect(scrub("00:1A-79:AB-CD:EF")).toBe("00:1A-79:AB-CD:EF");
  });
});

describe("scrub: a Windows user folder loses the name", () => {
  it("keeps the folder and what is under it", () => {
    expect(scrub("C:\\Users\\adam\\AppData\\Local\\com.blammytv.app\\logs")).toBe(
      "C:\\Users\\…\\AppData\\Local\\com.blammytv.app\\logs",
    );
  });

  it("takes a name with a space in it, a lower-case drive and forward slashes", () => {
    expect(scrub("d:\\users\\John Smith\\Videos\\x.mkv")).toBe("d:\\users\\…\\Videos\\x.mkv");
    expect(scrub("C:/Users/adam/Videos")).toBe("C:/Users/…/Videos");
  });

  it("takes a name at the end of the text", () => {
    expect(scrub("C:\\Users\\adam")).toBe("C:\\Users\\…");
  });

  it("leaves other folders alone", () => {
    expect(scrub("C:\\Program Files\\BlammyTV\\resources")).toBe("C:\\Program Files\\BlammyTV\\resources");
    expect(scrub("the Users folder")).toBe("the Users folder");
  });
});

describe("scrub: a long run of hex or base64 is redacted", () => {
  it("redacts 32 or more, and keeps 31", () => {
    expect(scrub(`token ${TOKEN} end`)).toBe("token <redacted> end");
    expect(scrub(`md5 ${HEX}`)).toBe("md5 <redacted>");
    expect(scrub(`x ${"a1".repeat(15)}1`)).toBe(`x ${"a1".repeat(15)}1`); // 31
    expect(scrub(`x ${"a1".repeat(16)}`)).toBe("x <redacted>"); // 32
  });

  it("redacts base64, with its + / and padding, and base64url, with its - _", () => {
    expect(scrub(`k ${B64}`)).toBe("k <redacted>");
    expect(scrub(`k ${"Ab+/".repeat(10)}==`)).toBe("k <redacted>");
    expect(scrub(`k ${"Ab-_".repeat(10)}`)).toBe("k <redacted>");
  });

  it("redacts a token with a slash through it as one, not as two halves under the limit", () => {
    const halves = `${"A1b2C3d4E5".repeat(2)}/${"F6g7H8i9J0".repeat(2)}`; // 20 + / + 20
    expect(scrub(`key ${halves}`)).toBe("key <redacted>");
  });

  it("redacts a UUID and a JWT's parts", () => {
    expect(scrub("id 123e4567-e89b-12d3-a456-426614174000")).toBe("id <redacted>");
    const jwt = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiJmYWtlIiwibmFtZSI6IkZha2UgVXNlciJ9", "ZmFrZXNpZ25hdHVyZWZha2VzaWduYXR1cmVmYWtl"].join(".");
    expect(scrub(jwt)).toBe("<redacted>.<redacted>.<redacted>");
  });

  it("is not set off by a line of dashes or a long ruler", () => {
    expect(scrub("-".repeat(40))).toBe("-".repeat(40));
    expect(scrub("=".repeat(40))).toBe("=".repeat(40));
    expect(scrub("_".repeat(40))).toBe("_".repeat(40));
  });
});

describe("scrub: all of them together", () => {
  it("cleans a line that is every kind of secret at once", () => {
    const line =
      `[ERROR] GET http://host:8080/live/user/pass/1.ts failed for mac 00:1A:79:AB:CD:EF ` +
      `in C:\\Users\\adam\\AppData\\Local\\x with key ${TOKEN} (https://cdn.example/d/${TOKEN}/f.mkv)`;
    const out = scrub(line);
    expect(out).toBe(
      "[ERROR] GET http://host:8080/… failed for mac xx:xx:xx:xx:xx:xx " +
        "in C:\\Users\\…\\AppData\\Local\\x with key <redacted> (https://cdn.example/…)",
    );
    for (const gone of ["user/pass", "1.ts", "00:1A", "adam", TOKEN]) expect(out, gone).not.toContain(gone);
  });

  it("is the same the second time", () => {
    for (const line of [
      "http://host:8080/live/user/pass/1.ts",
      "00:1A:79:AB:CD:EF",
      "C:\\Users\\adam\\x",
      `key ${TOKEN}`,
      `all of it ${TOKEN} http://u:p@h:1/a/b 00-1a-79-ab-cd-ef C:/Users/adam/y`,
    ]) {
      const once = scrub(line);
      expect(scrub(once), line).toBe(once);
    }
  });

  it("leaves an ordinary log line, its versions, times and addresses, as it was", () => {
    for (const line of [
      "[2026-10-12][10:15:30][app_lib::mvproxy][INFO] [mvproxy] listening on 127.0.0.1:49152",
      "[mpv] mpv 0.41.0-dev-g8aca7b0d5 Copyright (c) 2000-2025 mpv/MPlayer/mplayer2 projects",
      "FFmpeg for multi-view: N-127271-gba987fe24d",
      "Webview: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "BlammyTV diagnostics, 2026-10-12T10:15:30.000Z",
      "[vulkan] none on this PC, using ours: beside the exe",
    ]) {
      expect(scrub(line), line).toBe(line);
    }
  });

  it("takes the empty string and a multi-line text line by line", () => {
    expect(scrub("")).toBe("");
    expect(scrub(`one\nhttp://h:1/a/b\n${TOKEN}\ntwo`)).toBe("one\nhttp://h:1/…\n<redacted>\ntwo");
  });
});

describe("hasTokenRun: rule 4 as a question", () => {
  it("is true for a run of 32 or more with 16 letters or digits in it, in any of the sets", () => {
    for (const run of [TOKEN, HEX, B64, "a/b+c_d-".repeat(5) + "efgh", "Zm9v".repeat(8)]) expect(hasTokenRun(run), run).toBe(true);
    expect(hasTokenRun(`prefix ${TOKEN} suffix`)).toBe(true);
  });

  it("is false below 32, and for a ruler of dashes", () => {
    for (const text of ["", "t0k3n".repeat(6) + "a", "-".repeat(40), "=".repeat(40), "-_".repeat(20), "a-b-c-d-e-f-g-h-i-j-k-l-m-n-o", "1E5baAaEse26fej7uHcjOgEE2t2.jpg"])
      expect(hasTokenRun(text), text).toBe(false);
  });

  it("counts the slash as part of a run, so a whole path is one: ask it of a piece at a time", () => {
    expect(hasTokenRun("/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2")).toBe(true);
    for (const piece of ["t", "p", "w500", "1E5baAaEse26fej7uHcjOgEE2t2"]) expect(hasTokenRun(piece), piece).toBe(false);
  });

  it("agrees with scrub's own redaction, so what the export calls a key is what the log does", () => {
    for (const text of [TOKEN, HEX, B64, "-".repeat(40), "short", "t0k3n".repeat(6), `a ${TOKEN} b`])
      expect(hasTokenRun(text), text).toBe(scrub(text).includes("<redacted>"));
  });
});
