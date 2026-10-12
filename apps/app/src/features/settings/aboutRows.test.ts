import { describe, expect, it } from "vitest";
import { ABOUT_FIELDS, aboutRows } from "./aboutRows";

describe("aboutRows", () => {
  it("is a row for each thing native told, in the order they are drawn", () => {
    const rows = aboutRows({
      vulkan: "Windows' own",
      bundledFfmpeg: "N-127271-gba987fe24d",
      ffmpeg: "7.1.1",
      mpv: "0.41.0-dev-g8aca7b0d5",
      native: "0.11.36",
    });
    expect(rows.map((r) => r.key)).toEqual(ABOUT_FIELDS.map((f) => f.key));
    expect(rows.map((r) => r.value)).toEqual([
      "0.11.36",
      "0.41.0-dev-g8aca7b0d5",
      "7.1.1",
      "N-127271-gba987fe24d",
      "Windows' own",
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "Native build",
      "mpv",
      "FFmpeg in the player",
      "FFmpeg for multi-view",
      "Vulkan loader",
    ]);
  });

  it("leaves out a field native left out", () => {
    expect(aboutRows({ native: "0.11.36", vulkan: "BlammyTV's" }).map((r) => r.key)).toEqual(["native", "vulkan"]);
    expect(aboutRows({})).toEqual([]);
  });

  it("is no rows for an answer that isn't one (an older native, a stub)", () => {
    for (const none of [undefined, null, "", "0.11.36", 7, true, []]) {
      expect(aboutRows(none), String(none)).toEqual([]);
    }
  });

  it("takes a string and nothing else for a value", () => {
    const rows = aboutRows({ native: 7, mpv: { v: 1 }, ffmpeg: null, bundledFfmpeg: "", vulkan: "   " });
    expect(rows).toEqual([]);
  });

  it("draws a value as text, trimmed, and not one that is a paragraph", () => {
    expect(aboutRows({ mpv: "  0.41.0 \n" })[0].value).toBe("0.41.0");
    expect(aboutRows({ mpv: "<b>0.41" })[0].value).toBe("<b>0.41");
    expect(aboutRows({ mpv: "x".repeat(81) })).toEqual([]);
    expect(aboutRows({ mpv: "x".repeat(80) })).toHaveLength(1);
  });

  it("does not draw what looks like a path or an address, even when it is sent", () => {
    for (const bad of ["C:\\Users\\someone\\AppData\\mpv", "/home/someone/.config/mpv", "https://example.test/v", "a/b"])
      expect(aboutRows({ mpv: bad, native: "0.11.36" }).map((r) => r.key), bad).toEqual(["native"]);
    // A dot, a dash, a plus and an apostrophe are a version's and a loader's.
    expect(aboutRows({ mpv: "0.41.0-dev+g1", vulkan: "Windows' own" })).toHaveLength(2);
  });

  it("ignores a field it has not heard of", () => {
    expect(aboutRows({ path: "C:\\Users\\someone", native: "0.11.36" }).map((r) => r.key)).toEqual(["native"]);
  });
});
