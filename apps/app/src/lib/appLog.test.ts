import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COALESCE_MS,
  LINE_MAX,
  PER_MINUTE,
  createForwarder,
  describeArg,
  installAppLog,
  lineOf,
  type AppLogEnv,
  type AppLogLevel,
} from "./appLog";

// Obvious fakes only.
const TOKEN = "t0k3n".repeat(8); // 40 characters

/** Every line sent, in order. */
let sent: Array<[AppLogLevel, string]>;
const send = (level: AppLogLevel, line: string) => {
  sent.push([level, line]);
  return Promise.resolve();
};
const lines = () => sent.map((s) => s[1]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  sent = [];
});
afterEach(() => {
  vi.useRealTimers();
});

/** A forwarder on the fake clock. */
const forwarder = (opts: { coalesceMs?: number; perMinute?: number } = {}) =>
  createForwarder(send, { now: () => Date.now(), ...opts });
const wait = (ms: number) => vi.advanceTimersByTime(ms);

describe("describeArg and lineOf", () => {
  it("writes a string as it is, and a primitive as its text", () => {
    expect(describeArg("hello")).toBe("hello");
    expect(describeArg(42)).toBe("42");
    expect(describeArg(null)).toBe("null");
    expect(describeArg(undefined)).toBe("undefined");
    expect(describeArg(false)).toBe("false");
  });

  it("writes an Error as its name and message, with no stack", () => {
    const e = new TypeError("boom");
    expect(describeArg(e)).toBe("TypeError: boom");
  });

  it("writes an object as its key names, never its values", () => {
    expect(describeArg({ user: "u", password: "FAKEPASSWORD" })).toBe("{user, password}");
    expect(describeArg({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })).toBe("{a, b, c, d, e, f, …}");
    expect(describeArg({})).toBe("{}");
  });

  it("writes a list as its length, without looking inside it", () => {
    expect(describeArg(new Array(100000).fill({ big: true }))).toBe("Array(100000)");
  });

  it("writes something with a message (a native rejection, a DOMException) as the message", () => {
    expect(describeArg({ message: "the device is gone", code: 7 })).toBe("the device is gone");
  });

  it("does not stumble on an object that throws when asked its keys", () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("no"); } });
    expect(describeArg(hostile)).toBe("[object]");
  });

  it("cuts a very long argument", () => {
    expect(describeArg("x".repeat(5000)).length).toBeLessThan(1100);
  });

  it("joins the arguments of a console call with spaces", () => {
    expect(lineOf(["[live] failed:", new Error("nope"), 3, { k: 1 }])).toBe("[live] failed: Error: nope 3 {k}");
    expect(lineOf([])).toBe("");
  });
});

describe("the forwarder", () => {
  it("sends a line once, after its window, with its level", () => {
    const f = forwarder();
    f.forward("error", "x went wrong");
    expect(sent).toEqual([]);
    wait(COALESCE_MS);
    expect(sent).toEqual([["error", "x went wrong"]]);
    wait(10 * COALESCE_MS);
    expect(sent).toHaveLength(1);
  });

  it("scrubs a line before it is anything else", () => {
    const f = forwarder();
    f.forward("warn", `fetch http://host:8080/live/user/pass/1.ts failed, key ${TOKEN}, mac 00:1A:79:AB:CD:EF`);
    wait(COALESCE_MS);
    expect(lines()).toEqual(["fetch http://host:8080/… failed, key <redacted>, mac xx:xx:xx:xx:xx:xx"]);
  });

  it("sends twenty identical lines as one, with the count", () => {
    const f = forwarder();
    for (let i = 0; i < 20; i++) f.forward("error", "x");
    wait(COALESCE_MS);
    expect(sent).toEqual([["error", "x (repeated 20 times)"]]);
  });

  it("counts lines that differ only in what the scrubber takes out as the same line", () => {
    const f = forwarder();
    for (let i = 0; i < 5; i++) f.forward("warn", `failed http://host:8080/live/u${i}/p${i}/${i}.ts`);
    wait(COALESCE_MS);
    expect(lines()).toEqual(["failed http://host:8080/… (repeated 5 times)"]);
  });

  it("keeps different lines apart, and the same words at another level", () => {
    const f = forwarder();
    f.forward("error", "a");
    f.forward("warn", "a");
    f.forward("error", "b");
    f.forward("error", "a");
    wait(COALESCE_MS);
    expect(sent).toEqual([
      ["error", "a (repeated 2 times)"],
      ["warn", "a"],
      ["error", "b"],
    ]);
  });

  it("sends a line again, fresh, when it comes after its window has closed", () => {
    const f = forwarder();
    f.forward("error", "x");
    wait(COALESCE_MS);
    f.forward("error", "x");
    f.forward("error", "x");
    wait(COALESCE_MS);
    expect(lines()).toEqual(["x", "x (repeated 2 times)"]);
  });

  it("takes a loop that never stops as one line a window, and not one that waits for the end", () => {
    const f = forwarder();
    for (let i = 0; i < 40; i++) {
      f.forward("error", "again");
      wait(COALESCE_MS / 4);
    }
    // Forty lines over ten windows' worth of time: a few lines, each counted.
    expect(sent.length).toBeGreaterThanOrEqual(8);
    expect(sent.length).toBeLessThanOrEqual(11);
    expect(sent[0][1]).toMatch(/^again \(repeated \d+ times\)$/);
  });

  it("makes a line one line and cuts a long one", () => {
    const f = forwarder();
    f.forward("error", "a\nb\r\n\tc   d");
    // Words, as a long message is: an unbroken run this long is a token, and
    // is redacted before it is cut.
    const long = "ab ".repeat(LINE_MAX);
    f.forward("error", long);
    f.forward("error", "   ");
    wait(COALESCE_MS);
    expect(lines()[0]).toBe("a b c d");
    expect(lines()[1]).toBe(`${long.trim().slice(0, LINE_MAX)}…`);
    expect(lines()[1]).toHaveLength(LINE_MAX + 1);
    expect(lines()).toHaveLength(2);
  });

  it("flush sends what is waiting now, for the page closing", () => {
    const f = forwarder();
    f.forward("error", "last words");
    f.forward("error", "last words");
    f.flush();
    expect(lines()).toEqual(["last words (repeated 2 times)"]);
    wait(10 * COALESCE_MS);
    expect(sent).toHaveLength(1);
  });

  it("swallows a send that rejects, and one that throws", async () => {
    const unhandled: unknown[] = [];
    const on = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", on);
    const rejecting = createForwarder(() => Promise.reject(new Error("Command app_log not found")), { now: () => Date.now() });
    rejecting.forward("error", "one");
    const throwing = createForwarder(() => { throw new Error("no native"); }, { now: () => Date.now() });
    throwing.forward("error", "two");
    expect(() => wait(COALESCE_MS)).not.toThrow();
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", on);
    expect(unhandled).toEqual([]);
  });
});

describe("the forwarder's cap", () => {
  it("sends the first PER_MINUTE lines of a minute and no more", () => {
    const f = forwarder();
    for (let i = 0; i < PER_MINUTE + 30; i++) f.forward("error", `line ${i}`);
    wait(COALESCE_MS);
    expect(lines()).toHaveLength(PER_MINUTE);
    expect(lines()[0]).toBe("line 0");
    expect(lines()[PER_MINUTE - 1]).toBe(`line ${PER_MINUTE - 1}`);
  });

  it("says how many it dropped, once, when the minute is up", () => {
    const f = forwarder();
    for (let i = 0; i < PER_MINUTE + 30; i++) f.forward("error", `line ${i}`);
    wait(COALESCE_MS);
    expect(lines()).toHaveLength(PER_MINUTE);
    wait(60_000);
    expect(lines()).toHaveLength(PER_MINUTE + 1);
    expect(sent[PER_MINUTE][0]).toBe("warn");
    expect(lines()[PER_MINUTE]).toMatch(/^30 more lines were not sent to the log \(the limit is 50 a minute\)$/);
    wait(10 * 60_000);
    expect(sent).toHaveLength(PER_MINUTE + 1);
  });

  it("starts the next minute's count afresh", () => {
    const f = forwarder();
    for (let i = 0; i < PER_MINUTE; i++) f.forward("error", `first ${i}`);
    wait(COALESCE_MS);
    expect(lines()).toHaveLength(PER_MINUTE);
    wait(60_000);
    f.forward("error", "second minute");
    wait(COALESCE_MS);
    expect(lines().at(-1)).toBe("second minute");
    expect(lines()).toHaveLength(PER_MINUTE + 1);
  });

  it("counts a line that stood for twenty as one against the cap", () => {
    const f = forwarder();
    for (let i = 0; i < 20; i++) f.forward("error", "same");
    for (let i = 0; i < PER_MINUTE - 1; i++) f.forward("error", `other ${i}`);
    wait(COALESCE_MS);
    expect(lines()).toHaveLength(PER_MINUTE);
    wait(60_000);
    expect(lines()).toHaveLength(PER_MINUTE);
  });

  it("holds no more than a bounded number of different lines at once", () => {
    const f = forwarder({ perMinute: 100000 });
    for (let i = 0; i < 5000; i++) f.forward("error", `distinct ${i}`);
    wait(COALESCE_MS);
    // The rest were dropped and counted, not held: nothing like 5000.
    expect(lines().length).toBeLessThanOrEqual(100);
    wait(60_000);
    expect(lines().at(-1)).toMatch(/^\d+ more lines were not sent/);
  });
});

/** A console and a window of their own, for installAppLog to wrap. */
function page() {
  const calls: Array<[string, unknown[]]> = [];
  const con = {
    warn: (...a: unknown[]) => void calls.push(["warn", a]),
    error: (...a: unknown[]) => void calls.push(["error", a]),
  };
  const win = new EventTarget();
  return { calls, con, win };
}
const env = (p: ReturnType<typeof page>, extra: Partial<AppLogEnv> = {}): AppLogEnv => ({
  isTauri: () => true,
  send,
  console: p.con as unknown as Console,
  win: p.win as unknown as Window,
  options: { now: () => Date.now() },
  ...extra,
});

describe("installAppLog", () => {
  it("does nothing outside Tauri: the console is the very function it was, and nothing listens", () => {
    const p = page();
    const warn = p.con.warn;
    const error = p.con.error;
    const off = installAppLog(env(p, { isTauri: () => false }));
    expect(p.con.warn).toBe(warn);
    expect(p.con.error).toBe(error);
    p.con.error("in a browser");
    p.win.dispatchEvent(new Event("error"));
    wait(COALESCE_MS);
    expect(sent).toEqual([]);
    expect(() => off()).not.toThrow();
  });

  it("gives the console every call, with the arguments as they came, and forwards a copy", () => {
    const p = page();
    installAppLog(env(p));
    const err = new Error("x");
    const obj = { a: 1 };
    p.con.error("[live] failed:", err, obj);
    p.con.warn("careful", 7);
    expect(p.calls).toEqual([
      ["error", ["[live] failed:", err, obj]],
      ["warn", ["careful", 7]],
    ]);
    // The very objects, not copies of them.
    expect(p.calls[0][1][1]).toBe(err);
    expect(p.calls[0][1][2]).toBe(obj);
    wait(COALESCE_MS);
    expect(sent).toEqual([
      ["error", "[live] failed: Error: x {a}"],
      ["warn", "careful 7"],
    ]);
  });

  it("gives the console its call before it forwards, and still if the forwarder were to throw", () => {
    const p = page();
    installAppLog(env(p, { send: () => { throw new Error("native is gone"); } }));
    expect(() => p.con.error("still logged")).not.toThrow();
    expect(() => wait(COALESCE_MS)).not.toThrow();
    expect(p.calls).toEqual([["error", ["still logged"]]]);
  });

  it("forwards twenty identical console.error calls as one line with a count", () => {
    const p = page();
    installAppLog(env(p));
    for (let i = 0; i < 20; i++) p.con.error("x");
    expect(p.calls).toHaveLength(20);
    wait(COALESCE_MS);
    expect(sent).toEqual([["error", "x (repeated 20 times)"]]);
  });

  it("forwards an uncaught error, with its line, and a rejection nobody caught", () => {
    const p = page();
    installAppLog(env(p));
    p.win.dispatchEvent(Object.assign(new Event("error"), { message: "Script error.", error: new RangeError("too far"), lineno: 12, colno: 7 }));
    p.win.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("nobody caught this") }));
    p.win.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "a plain string" }));
    wait(COALESCE_MS);
    expect(sent).toEqual([
      ["error", "Uncaught: RangeError: too far (line 12:7)"],
      ["error", "Unhandled rejection: Error: nobody caught this"],
      ["error", "Unhandled rejection: a plain string"],
    ]);
  });

  it("takes an error event with no error object from its message, and one with nothing at all", () => {
    const p = page();
    installAppLog(env(p));
    p.win.dispatchEvent(Object.assign(new Event("error"), { message: "Script error." }));
    p.win.dispatchEvent(new Event("error"));
    wait(COALESCE_MS);
    expect(lines()).toEqual(["Uncaught: Script error.", "Uncaught: an error"]);
  });

  it("does not stop an event or mark it handled", () => {
    const p = page();
    installAppLog(env(p));
    const e = Object.assign(new Event("error", { cancelable: true }), { message: "m" });
    p.win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("scrubs what the page logged: a URL, a token and a path", () => {
    const p = page();
    installAppLog(env(p));
    p.con.warn(`[live] EPG failed for "Mine": http://host:8080/xmltv.php?username=u&password=FAKE key=${TOKEN} C:\\Users\\adam\\x`);
    wait(COALESCE_MS);
    expect(lines()).toEqual(['[live] EPG failed for "Mine": http://host:8080/… key=<redacted> C:\\Users\\…\\x']);
  });

  it("sends what is waiting when the page is hidden", () => {
    const p = page();
    installAppLog(env(p));
    p.con.error("going down");
    p.win.dispatchEvent(new Event("pagehide"));
    expect(lines()).toEqual(["going down"]);
  });

  it("puts everything back when it is taken off", () => {
    const p = page();
    const warn = p.con.warn;
    const error = p.con.error;
    const off = installAppLog(env(p));
    expect(p.con.warn).not.toBe(warn);
    off();
    expect(p.con.warn).toBe(warn);
    expect(p.con.error).toBe(error);
    p.win.dispatchEvent(Object.assign(new Event("error"), { message: "after" }));
    wait(COALESCE_MS);
    expect(sent).toEqual([]);
  });
});
