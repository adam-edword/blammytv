import { describe, expect, it } from "vitest";
import { formatDuration, formatSize, plainError, reasonLine, startFailure } from "./format";

describe("formatDuration", () => {
  it("is m:ss under an hour and h:mm:ss from one", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7_000)).toBe("0:07");
    expect(formatDuration(754_000)).toBe("12:34");
    expect(formatDuration(3_599_000)).toBe("59:59");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  it("rounds down to the second, and is never negative", () => {
    expect(formatDuration(1_999)).toBe("0:01");
    expect(formatDuration(-5_000)).toBe("0:00");
  });
});

describe("formatSize", () => {
  it("picks the unit, with a decimal only where it helps", () => {
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(512 * 1024)).toBe("512 KB");
    expect(formatSize(4.2 * 1024 ** 2)).toBe("4.2 MB");
    expect(formatSize(48.4 * 1024 ** 2)).toBe("48 MB");
    expect(formatSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("does not show 1024 KB for a megabyte short by a hair", () => {
    expect(formatSize(1024 ** 2 - 1)).toBe("1024 KB");
    expect(formatSize(1024 ** 2)).toBe("1.0 MB");
  });
});

describe("reasonLine", () => {
  it("says native's fragment as a sentence", () => {
    expect(reasonLine("stream lost")).toBe("Stream lost.");
    expect(reasonLine("disk full.")).toBe("Disk full.");
    expect(reasonLine("  ")).toBe("");
  });
});

describe("startFailure", () => {
  it("puts the reason after the colon, as the app says every fragment", () => {
    expect(startFailure("no data from the stream for 20 seconds")).toBe(
      "Couldn’t record: no data from the stream for 20 seconds.",
    );
  });

  it("says how to fix a folder or a full disk, which are the person's to fix", () => {
    expect(startFailure("not enough free disk space (recording needs 2 GB)")).toContain(
      "Pick another folder in Settings → Playback.",
    );
    expect(startFailure("could not make the folder: PermissionDenied")).toContain("Settings → Playback");
    expect(startFailure("the stream ended at once")).not.toContain("Settings");
  });
});

describe("plainError", () => {
  it("is the words in a string or an Error, not 'Error: …'", () => {
    expect(plainError("stream lost")).toBe("stream lost");
    expect(plainError(new Error("no link"))).toBe("no link");
  });
});
