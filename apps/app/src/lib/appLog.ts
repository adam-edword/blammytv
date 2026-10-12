import { scrub } from "./scrub";

/**
 * The page's warnings and errors, in the log file (plan 025, P4b).
 *
 * A release build keeps no record of anything: the webview's console dies with
 * the window, and support was a screenshot. So `console.warn`, `console.error`,
 * an uncaught error and an unhandled rejection are also sent to native
 * (`app_log`, written under the target "frontend" beside native's own lines),
 * and Copy Diagnostics reads them back with the rest.
 *
 * NOT `console.info` or `console.log`: the tune diagnostics fire per tune, and
 * would fill the file in an evening.
 *
 * The console gets everything exactly as it did, first, with the same
 * arguments. What is forwarded is a copy:
 *
 *  - SCRUBBED (lib/scrub.ts) before anything else, so a URL is its origin and
 *    a token is `<redacted>` in the file whatever the page logged;
 *  - ONE LINE, cut at LINE_MAX. An object is its key names and not its values:
 *    a value is where a password would be, and walking a 95 MB guide to print
 *    it would stall the page;
 *  - COALESCED. The same line again within COALESCE_MS is counted, and goes
 *    once, with the count, when the second is up. A loop that logs the same
 *    failure thirty times a second is one line;
 *  - CAPPED at PER_MINUTE lines a minute. Past it lines are dropped and the
 *    next minute begins with a line saying how many, so a loop of different
 *    lines can't fill the file either;
 *  - FIRE AND FORGET. A rejection is swallowed, which is what an older native
 *    with no `app_log` does, and nothing here ever writes to the console: a
 *    failure that logged would be forwarded, and fail, and log.
 *
 * The frontend ships apart from the native build (two tiers), so both ends of
 * this are live: a new page on an old native sends and is refused, quietly.
 */

export type AppLogLevel = "warn" | "error";
type Send = (level: AppLogLevel, line: string) => unknown;

/** The longest a forwarded line is, in characters. */
export const LINE_MAX = 800;
/** How long an identical line is waited for before it goes with its count. */
export const COALESCE_MS = 1000;
/** The most lines forwarded in a minute. */
export const PER_MINUTE = 50;
const MINUTE = 60_000;
/** The most of one argument that is looked at. */
const ARG_MAX = 1000;
/** How many key names of an object are listed. */
const KEYS_MAX = 6;
/** The most distinct lines held at once, each waiting out its window. Past it a
 * line is dropped and counted, so a loop of different lines holds no more. */
const WAITING_MAX = 100;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** One console argument as text, safely: never a value of an object, never a
 * walk of anything big. */
export function describeArg(x: unknown): string {
  if (typeof x === "string") return cut(x, ARG_MAX);
  if (x instanceof Error) return cut(`${x.name}: ${x.message}`, ARG_MAX);
  if (x === null || typeof x !== "object") return cut(String(x), ARG_MAX);
  if (Array.isArray(x)) return `Array(${x.length})`;
  // A rejection from native, or a DOMException: something with a message.
  const message = (x as { message?: unknown }).message;
  if (typeof message === "string") return cut(message, ARG_MAX);
  try {
    const keys = Object.keys(x);
    return `{${keys.slice(0, KEYS_MAX).join(", ")}${keys.length > KEYS_MAX ? ", …" : ""}}`;
  } catch {
    return "[object]";
  }
}

/** What `console.warn(...args)` says, as one line. */
export function lineOf(args: readonly unknown[]): string {
  return args.map(describeArg).join(" ");
}

export interface ForwarderOptions {
  coalesceMs?: number;
  perMinute?: number;
  /** A monotonic clock in milliseconds. */
  now?: () => number;
}

export interface Forwarder {
  /** Take a line to be sent. Scrubs it first. */
  forward(level: AppLogLevel, line: string): void;
  /** Send what is waiting for its count now. For the page closing. */
  flush(): void;
}

export function createForwarder(send: Send, opts: ForwarderOptions = {}): Forwarder {
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS;
  const perMinute = opts.perMinute ?? PER_MINUTE;
  const now = opts.now ?? (() => performance.now());

  /** A line waiting out its window: how many times it has come. */
  const waiting = new Map<string, { level: AppLogLevel; line: string; count: number; timer: ReturnType<typeof setTimeout> }>();
  let windowStart = -Infinity;
  let sent = 0;
  let dropped = 0;
  let summaryTimer: ReturnType<typeof setTimeout> | undefined;

  const deliver = (level: AppLogLevel, line: string) => {
    try {
      Promise.resolve(send(level, line)).catch(() => {});
    } catch {
      // A native that throws on the spot, or no native at all: nothing to say.
    }
  };

  /** The minute's first line opens a new count; and the lines dropped in the
   * last one are said, once, as the first line of this. */
  const openWindowIfDue = () => {
    const t = now();
    if (t - windowStart < MINUTE) return;
    windowStart = t;
    sent = 0;
  };

  const say = () => {
    summaryTimer = undefined;
    if (dropped === 0) return;
    const n = dropped;
    dropped = 0;
    openWindowIfDue();
    sent++;
    deliver("warn", `${n} more ${n === 1 ? "line was" : "lines were"} not sent to the log (the limit is ${perMinute} a minute)`);
  };

  const drop = () => {
    dropped++;
    // When this minute is up, whatever was dropped in it is said.
    if (summaryTimer === undefined) summaryTimer = setTimeout(say, Math.max(0, windowStart + MINUTE - now()));
  };

  const emit = (level: AppLogLevel, line: string) => {
    openWindowIfDue();
    if (sent >= perMinute) return drop();
    sent++;
    deliver(level, line);
  };

  const release = (key: string) => {
    const w = waiting.get(key);
    if (!w) return;
    waiting.delete(key);
    clearTimeout(w.timer);
    emit(w.level, w.count > 1 ? `${w.line} (repeated ${w.count} times)` : w.line);
  };

  return {
    forward(level, raw) {
      const line = cut(scrub(raw).replace(/\s+/g, " ").trim(), LINE_MAX);
      if (!line) return;
      const key = `${level}\0${line}`;
      const w = waiting.get(key);
      if (w) {
        w.count++;
        return;
      }
      if (waiting.size >= WAITING_MAX) {
        openWindowIfDue();
        return drop();
      }
      waiting.set(key, { level, line, count: 1, timer: setTimeout(() => release(key), coalesceMs) });
    },
    flush() {
      for (const key of [...waiting.keys()]) release(key);
    },
  };
}

/** What `installAppLog` needs of the page, so a test can hand it its own. */
export interface AppLogEnv {
  /** False in a plain browser: there is no log to send to, and nothing is touched. */
  isTauri: () => boolean;
  send: Send;
  console?: Pick<Console, "warn" | "error">;
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
  options?: ForwarderOptions;
}

/**
 * Start forwarding. Wraps `console.warn` and `console.error` (the original is
 * called first, with the same arguments and `this`) and listens for the
 * window's `error` and `unhandledrejection`, neither of which it stops or
 * marks as handled. Does nothing outside Tauri.
 *
 * Returns what undoes it, for a test; the app never takes it off.
 */
export function installAppLog(env: AppLogEnv): () => void {
  if (!env.isTauri()) return () => {};
  const con = env.console ?? console;
  const win = env.win ?? window;
  const forwarder = createForwarder(env.send, env.options);

  const wrapped: Array<["warn" | "error", Console["warn"]]> = [];
  for (const level of ["warn", "error"] as const) {
    const original = con[level];
    wrapped.push([level, original]);
    con[level] = (...args: unknown[]) => {
      original.apply(con, args);
      try {
        forwarder.forward(level, lineOf(args));
      } catch {
        // Whatever went wrong here must not reach the page that logged.
      }
    };
  }

  const onError = (e: Event) => {
    try {
      const err = e as Partial<ErrorEvent>;
      const where = err.lineno ? ` (line ${err.lineno}${err.colno ? `:${err.colno}` : ""})` : "";
      const what = err.error !== undefined && err.error !== null ? describeArg(err.error) : describeArg(err.message ?? "an error");
      forwarder.forward("error", `Uncaught: ${what}${where}`);
    } catch {
      // As above.
    }
  };
  const onRejection = (e: Event) => {
    try {
      forwarder.forward("error", `Unhandled rejection: ${describeArg((e as Partial<PromiseRejectionEvent>).reason)}`);
    } catch {
      // As above.
    }
  };
  // The page closing is the one time a line in its window would be lost.
  const onHide = () => forwarder.flush();
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  win.addEventListener("pagehide", onHide);

  return () => {
    for (const [level, original] of wrapped) con[level] = original;
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    win.removeEventListener("pagehide", onHide);
  };
}
