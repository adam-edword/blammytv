import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, dispatchEvent: () => true });

const status = vi.hoisted(() => vi.fn());
const canSource = vi.hoisted(() => vi.fn());
vi.mock("./client", async (orig) => ({
  ...(await orig<typeof import("./client")>()),
  aiojfStatus: status,
  aiojfCanSource: canSource,
}));

import { readSignIn } from "./account";
import { forgetAiojf, loadAiojf } from "./store";

const BASE = "https://aio.example.com/jellyfin";
const on = { supported: true, connected: true, userName: "Adam", userId: "u1", base: BASE };

beforeEach(() => {
  mem.clear();
  status.mockReset();
  canSource.mockReset();
  canSource.mockResolvedValue(true);
});

describe("readSignIn", () => {
  it("answers the status, and records the sign-in when the build can open sources", async () => {
    status.mockResolvedValue(on);
    expect(await readSignIn()).toEqual(on);
    expect(loadAiojf().signedIn).toEqual({ base: BASE, userName: "Adam" });
  });

  it("does not record it for a build that cannot, which stays on its manifest", async () => {
    status.mockResolvedValue(on);
    canSource.mockResolvedValue(false);
    await readSignIn();
    expect(loadAiojf().signedIn).toBeUndefined();
  });

  it("does not ask whether the build can when nothing is connected", async () => {
    status.mockResolvedValue({ supported: true, connected: false });
    await readSignIn();
    expect(canSource).not.toHaveBeenCalled();
  });

  it("a sign-out that lands while the status is on its way wins over its stale answer", async () => {
    let answer: (v: unknown) => void = () => {};
    status.mockReturnValue(new Promise((r) => (answer = r)));
    const reading = readSignIn();
    forgetAiojf();
    answer(on);
    await reading;
    expect(loadAiojf().signedIn).toBeUndefined();
  });
});
