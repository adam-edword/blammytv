import { describe, expect, it } from "vitest";
import { aboutRows } from "./aboutRows";
import { LOG_LINES, composeDiagnostics, type DiagnosticsInput } from "./diagnostics";

// Obvious fakes only.
const TOKEN = "t0k3n".repeat(8); // 40 characters
const WHEN = new Date("2026-10-12T10:15:30.000Z");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const ABOUT = aboutRows({ native: "0.11.36", mpv: "0.41.0-dev-g8aca7b0d5", ffmpeg: "7.1.1", bundledFfmpeg: "N-127271-gba987fe24d", vulkan: "Windows' own" });

const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  app: "0.11.37",
  rows: ABOUT,
  userAgent: UA,
  log: ["[2026-10-12][10:00:00][app_lib::mvproxy][INFO] [mvproxy] listening on 127.0.0.1:49152", "[2026-10-12][10:00:05][frontend][WARN] [live] EPG failed"],
  when: WHEN,
  ...over,
});

describe("composeDiagnostics", () => {
  it("has the date, the app's version, each row native sent, the webview, and the log's lines", () => {
    const text = composeDiagnostics(input());
    expect(text.split("\n")).toEqual([
      "BlammyTV diagnostics, 2026-10-12T10:15:30.000Z",
      "",
      "App: 0.11.37",
      "Native build: 0.11.36",
      "mpv: 0.41.0-dev-g8aca7b0d5",
      "FFmpeg in the player: 7.1.1",
      "FFmpeg for multi-view: N-127271-gba987fe24d",
      "Vulkan loader: Windows' own",
      `Webview: ${UA}`,
      "",
      "Log, the last 2 lines:",
      "[2026-10-12][10:00:00][app_lib::mvproxy][INFO] [mvproxy] listening on 127.0.0.1:49152",
      "[2026-10-12][10:00:05][frontend][WARN] [live] EPG failed",
    ]);
  });

  it("scrubs the log's lines again: a URL, a token, a MAC, a user folder", () => {
    const text = composeDiagnostics(
      input({
        log: [
          `[ERROR] fetch http://host:8080/live/user/pass/1.ts failed`,
          `[WARN] key ${TOKEN}`,
          `[WARN] mac 00:1A:79:AB:CD:EF at C:\\Users\\adam\\AppData`,
        ],
      }),
    );
    expect(text).toContain("fetch http://host:8080/… failed");
    expect(text).toContain("key <redacted>");
    expect(text).toContain("mac xx:xx:xx:xx:xx:xx at C:\\Users\\…\\AppData");
    for (const gone of ["user/pass", "1.ts", TOKEN, "00:1A", "adam"]) expect(text, gone).not.toContain(gone);
  });

  it("scrubs the rest too: a row native should not have sent, and the user agent", () => {
    const text = composeDiagnostics(
      input({
        rows: [{ key: "mpv", label: "mpv", value: `see http://host:1/a/b` }],
        userAgent: `Mozilla/5.0 ${TOKEN}`,
        log: [],
      }),
    );
    expect(text).toContain("mpv: see http://host:1/…");
    expect(text).toContain("Webview: Mozilla/5.0 <redacted>");
    expect(text).not.toContain(TOKEN);
  });

  it("says the log wasn't available when there is none to give, and still has the rest", () => {
    const text = composeDiagnostics(input({ log: null }));
    expect(text).toContain("Log: the log wasn't available.");
    expect(text).toContain("App: 0.11.37");
    expect(text).toContain("Native build: 0.11.36");
    expect(text).toContain(`Webview: ${UA}`);
    expect(text).not.toContain("Log, the last");
  });

  it("works with nothing from native at all: the app's version and the webview", () => {
    const text = composeDiagnostics(input({ rows: [], log: null }));
    expect(text.split("\n")).toEqual([
      "BlammyTV diagnostics, 2026-10-12T10:15:30.000Z",
      "",
      "App: 0.11.37",
      `Webview: ${UA}`,
      "",
      "Log: the log wasn't available.",
    ]);
  });

  it("says an empty log is empty, which is not the same as not available", () => {
    const text = composeDiagnostics(input({ log: [] }));
    expect(text).toContain("Log: empty.");
    expect(text).not.toContain("wasn't available");
  });

  it("counts the lines it has, one of them in the singular", () => {
    expect(composeDiagnostics(input({ log: ["only"] }))).toContain("Log, the last 1 line:\nonly");
    const many = Array.from({ length: LOG_LINES }, (_, i) => `line ${i}`);
    expect(composeDiagnostics(input({ log: many }))).toContain(`Log, the last ${LOG_LINES} lines:\nline 0\n`);
  });

  it("asks for 200 lines", () => {
    expect(LOG_LINES).toBe(200);
  });

  it("names the webview unknown when it was not told", () => {
    expect(composeDiagnostics(input({ userAgent: "  " }))).toContain("Webview: unknown");
  });
});
