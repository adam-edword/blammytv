import { beforeEach, describe, expect, it, vi } from "vitest";

// The native side: every call recorded, answered as a test says.
const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));

const { tauriAppLog, tauriCheckUpdateInfo, tauriLogTail } = await import("./tauri");

/** What each command answers; a command not in the map is "not found". */
function native(answers: Record<string, () => Promise<unknown>>) {
  invoke.mockImplementation((cmd) => (answers[cmd] ? answers[cmd]() : Promise.reject(`Command ${cmd} not found`)));
}
const asked = () => invoke.mock.calls.map((c) => c[0]);

// A block, not an arrow that returns the mock: vitest calls what a hook returns.
beforeEach(() => {
  invoke.mockReset();
});

describe("tauriCheckUpdateInfo", () => {
  it("is check_update_info's answer, notes and all, and asks nothing else", async () => {
    native({ check_update_info: () => Promise.resolve({ version: "0.11.36", notes: "# New\nA fix" }) });
    expect(await tauriCheckUpdateInfo()).toEqual({ version: "0.11.36", notes: "# New\nA fix" });
    expect(asked()).toEqual(["check_update_info"]);
  });

  it("is null when nothing is waiting, without asking the old command", async () => {
    native({ check_update_info: () => Promise.resolve(null) });
    expect(await tauriCheckUpdateInfo()).toBeNull();
    expect(asked()).toEqual(["check_update_info"]);
  });

  it("falls back to check_update, with no notes, on a native that has no such command", async () => {
    native({ check_update: () => Promise.resolve("0.11.37") });
    expect(await tauriCheckUpdateInfo()).toEqual({ version: "0.11.37", notes: "" });
    expect(asked()).toEqual(["check_update_info", "check_update"]);
  });

  it("falls back to nothing waiting the same way", async () => {
    native({ check_update: () => Promise.resolve(null) });
    expect(await tauriCheckUpdateInfo()).toBeNull();
  });

  it("lets the old command's own failure through, as it always came", async () => {
    native({ check_update: () => Promise.reject("no route to host") });
    await expect(tauriCheckUpdateInfo()).rejects.toBe("no route to host");
  });

  it("takes notes that aren't text as none, and an answer that isn't a version as 'this native can't say'", async () => {
    native({ check_update_info: () => Promise.resolve({ version: "0.11.36", notes: 7 }) });
    expect(await tauriCheckUpdateInfo()).toEqual({ version: "0.11.36", notes: "" });
    for (const odd of [undefined, 3, "0.11.36", {}, { version: "" }, { version: 5 }]) {
      invoke.mockReset();
      native({ check_update_info: () => Promise.resolve(odd), check_update: () => Promise.resolve("0.11.38") });
      expect(await tauriCheckUpdateInfo(), String(odd)).toEqual({ version: "0.11.38", notes: "" });
      expect(asked(), String(odd)).toEqual(["check_update_info", "check_update"]);
    }
  });
});

describe("tauriLogTail", () => {
  it("asks log_tail for that many lines and is its list", async () => {
    native({ log_tail: () => Promise.resolve(["one", "two"]) });
    expect(await tauriLogTail(200)).toEqual(["one", "two"]);
    expect(invoke).toHaveBeenCalledWith("log_tail", { lines: 200 });
  });

  it("keeps only the lines that are text", async () => {
    native({ log_tail: () => Promise.resolve(["one", 2, null, { a: 1 }, "three"]) });
    expect(await tauriLogTail(5)).toEqual(["one", "three"]);
  });

  it("rejects on a native that has no such command, for the caller to copy without it", async () => {
    native({});
    await expect(tauriLogTail(200)).rejects.toBe("Command log_tail not found");
  });

  it("rejects on an answer that is not a list", async () => {
    native({ log_tail: () => Promise.resolve("a path, say") });
    await expect(tauriLogTail(200)).rejects.toThrow(/not a list/);
    native({ log_tail: () => Promise.resolve(undefined) });
    await expect(tauriLogTail(200)).rejects.toThrow(/not a list/);
  });
});

describe("tauriAppLog", () => {
  it("sends the level and the line to app_log, and nothing else", async () => {
    native({ app_log: () => Promise.resolve(undefined) });
    await tauriAppLog("warn", "a line");
    expect(invoke).toHaveBeenCalledWith("app_log", { level: "warn", line: "a line" });
  });

  it("rejects on a native that has no such command, for the forwarder to swallow", async () => {
    native({});
    await expect(tauriAppLog("error", "x")).rejects.toBe("Command app_log not found");
  });
});
