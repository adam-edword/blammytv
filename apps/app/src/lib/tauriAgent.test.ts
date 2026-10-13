import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A playlist's User-Agent on its way to native (plan 025, P5): it rides the
 * four playback commands, and only when there is one. A playlist without
 * sends the payload it always sent, and a native build from before the
 * argument, which leaves it out of its parameters, plays as it did.
 */

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));

const { tauriInvOpen, tauriMvProxyOpen, tauriMvProxyOpenHls, tauriPopoutOpen } = await import("./tauri");

const AGENT = "TestApp/9.1 (Provider Check)";
const RECT = { x: 1, y: 2, w: 300, h: 200, radius: 0 };
const lastArgs = () => invoke.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("inv_open", () => {
  it("carries the agent as userAgent", async () => {
    await tauriInvOpen("http://h/1.ts", RECT, undefined, true, AGENT);
    expect(invoke.mock.calls.at(-1)?.[0]).toBe("inv_open");
    expect(lastArgs()).toEqual({ url: "http://h/1.ts", x: 1, y: 2, w: 300, h: 200, start: null, live: true, userAgent: AGENT });
  });

  it("is the payload it always was without one", async () => {
    await tauriInvOpen("http://h/1.ts", RECT, 90, true);
    expect(lastArgs()).toEqual({ url: "http://h/1.ts", x: 1, y: 2, w: 300, h: 200, start: 90, live: true });
    expect("userAgent" in lastArgs()).toBe(false);
    await tauriInvOpen("http://h/1.ts", RECT, undefined, true, "");
    expect("userAgent" in lastArgs()).toBe(false);
  });
});

describe("popout_open", () => {
  it("carries the agent beside the size and the corner", async () => {
    await tauriPopoutOpen("http://h/1.ts", true, "guide", AGENT);
    expect(invoke.mock.calls.at(-1)?.[0]).toBe("popout_open");
    expect(lastArgs()).toMatchObject({ url: "http://h/1.ts", live: true, userAgent: AGENT });
  });

  it("leaves it out without one", async () => {
    await tauriPopoutOpen("http://h/1.ts", true, "guide");
    expect("userAgent" in lastArgs()).toBe(false);
    await tauriPopoutOpen("http://h/1.ts", false);
    expect("userAgent" in lastArgs()).toBe(false);
  });
});

describe("the multi-view proxy", () => {
  it("mv_proxy_open carries the agent, and HEVC conversion still rides with it", async () => {
    await tauriMvProxyOpen("http://h/1.ts", true, AGENT);
    expect(invoke.mock.calls.at(-1)?.[0]).toBe("mv_proxy_open");
    expect(lastArgs()).toEqual({ url: "http://h/1.ts", convertHevc: true, userAgent: AGENT });
  });

  it("mv_proxy_open is the payload it always was without one", async () => {
    await tauriMvProxyOpen("http://h/1.ts", true);
    expect(lastArgs()).toEqual({ url: "http://h/1.ts", convertHevc: true });
    await tauriMvProxyOpen("http://h/1.ts");
    expect(lastArgs()).toEqual({ url: "http://h/1.ts", convertHevc: false });
  });

  it("mv_proxy_open_hls carries it too, and is as it was without", async () => {
    await tauriMvProxyOpenHls("http://h/a.m3u8", AGENT);
    expect(invoke.mock.calls.at(-1)?.[0]).toBe("mv_proxy_open_hls");
    expect(lastArgs()).toEqual({ url: "http://h/a.m3u8", userAgent: AGENT });
    await tauriMvProxyOpenHls("http://h/a.m3u8");
    expect(lastArgs()).toEqual({ url: "http://h/a.m3u8" });
  });
});
