import { describe, expect, it } from "vitest";
import { isFillerTitle, parseXmltvTime } from "./xmltv";

// The DOM walk itself runs on the WebView's DOMParser (absent under node),
// so unit tests cover the pure pieces; the full parse is exercised
// end-to-end in the browser.

describe("parseXmltvTime", () => {
  it("parses explicit offsets", () => {
    expect(parseXmltvTime("20260614200000 +0000")).toBe(
      Date.parse("2026-06-14T20:00:00Z"),
    );
    expect(parseXmltvTime("20260614200000 -0500")).toBe(
      Date.parse("2026-06-14T20:00:00-05:00"),
    );
    // No space before the offset — some panels omit it.
    expect(parseXmltvTime("20260614200000+0130")).toBe(
      Date.parse("2026-06-14T20:00:00+01:30"),
    );
  });

  it("defaults to UTC without an offset", () => {
    expect(parseXmltvTime("20260101000000")).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  it("rejects garbage", () => {
    expect(parseXmltvTime(undefined)).toBeNull();
    expect(parseXmltvTime("")).toBeNull();
    expect(parseXmltvTime("June 14th")).toBeNull();
    expect(parseXmltvTime("2026-06-14")).toBeNull();
  });
});

describe("isFillerTitle", () => {
  it("drops the classic placeholders", () => {
    for (const t of [
      "",
      "To Be Announced",
      "TBA",
      "No Information",
      "no info",
      "N/A",
      "Programme",
      "program.",
    ])
      expect(isFillerTitle(t), t).toBe(true);
  });

  it("keeps real titles", () => {
    for (const t of [
      "News at Ten",
      "TBA: The Documentary",
      "Programme of the Year Awards",
    ])
      expect(isFillerTitle(t), t).toBe(false);
  });
});
