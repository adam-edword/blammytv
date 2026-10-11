import { describe, expect, it } from "vitest";
import type { OpenAnswer } from "../../lib/tauri";
import { openErrorLine } from "./openError";

const got = (status: number, contentType: string | null = null): OpenAnswer => ({
  status,
  contentType,
  failure: null,
});
const down = (failure: NonNullable<OpenAnswer["failure"]>): OpenAnswer => ({
  status: null,
  contentType: null,
  failure,
});

describe("openErrorLine", () => {
  it("says a 403 is a link that expired, and what to do", () => {
    expect(openErrorLine(got(403))).toBe(
      "The link answered 403 (Forbidden). Debrid links expire; try another source.",
    );
  });

  it("names a 404 and a 410 as not found, with the code the link gave", () => {
    expect(openErrorLine(got(404))).toBe("The link answered 404 (Not found).");
    expect(openErrorLine(got(410))).toBe("The link answered 410 (Not found).");
  });

  it("gives any other client or server error its code and nothing else", () => {
    for (const code of [400, 401, 416, 429, 451, 500, 502, 503, 504, 599])
      expect(openErrorLine(got(code)), String(code)).toBe(
        `The link answered ${code}.`,
      );
  });

  it("calls a 200 with a web page a web page", () => {
    const page = "The link sent a web page, not a video.";
    expect(openErrorLine(got(200, "text/html"))).toBe(page);
    expect(openErrorLine(got(200, "TEXT/HTML; charset=utf-8"))).toBe(page);
    // The range we ask for makes a healthy file 206; a page can be one too.
    expect(openErrorLine(got(206, "text/html"))).toBe(page);
  });

  it("makes no claim for a link that answered like a video", () => {
    for (const type of [
      "video/mp4",
      "video/x-matroska",
      "application/octet-stream",
      "application/vnd.apple.mpegurl",
      "binary/octet-stream",
    ]) {
      expect(openErrorLine(got(200, type)), type).toBeNull();
      expect(openErrorLine(got(206, type)), type).toBeNull();
    }
  });

  it("makes no claim for a 2xx with no type, or a type it has no sentence for", () => {
    expect(openErrorLine(got(200))).toBeNull();
    expect(openErrorLine(got(200, "application/json"))).toBeNull();
    expect(openErrorLine(got(200, "text/plain"))).toBeNull();
    // Not a web page, only the start of the word.
    expect(openErrorLine(got(200, "text/htmlish"))).toBeNull();
  });

  it("makes no claim for a status that is neither", () => {
    for (const code of [100, 199, 300, 302, 304, 399, 600])
      expect(openErrorLine(got(code)), String(code)).toBeNull();
    expect(openErrorLine(got(Number.NaN))).toBeNull();
    expect(openErrorLine(got(403.5))).toBeNull();
    expect(openErrorLine({ status: null, contentType: null, failure: null })).toBeNull();
  });

  it("says the server did not answer, whichever way it did not", () => {
    for (const kind of ["timeout", "refused", "dns", "network"] as const)
      expect(openErrorLine(down(kind)), kind).toBe("The server didn’t answer.");
  });

  it("never carries the address, or anything the server said, into the words", () => {
    // Nothing here is given the address; what it IS given is the server's own
    // type, and that is compared, never shown.
    const key = "secret-key-8f3a21";
    for (const a of [
      got(200, `text/html; x=https://host/${key}`),
      got(200, `https://host/${key}`),
      got(403, `https://host/${key}`),
      got(500, `text/html; token=${key}`),
      down("dns"),
    ])
      expect(openErrorLine(a) ?? "", JSON.stringify(a)).not.toContain(key);
  });
});
