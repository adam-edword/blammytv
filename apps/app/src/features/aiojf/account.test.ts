import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { AIO_CONN_CHANGED } from "../settings/aiostreams";
import { reconcile, readSignIn, signOutOfAio } from "./account";
import { AIOJF_SYNCED, forgetAiojf, loadAiojf, saveAiojf } from "./store";

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

// Stream and Discover are mounted before a sign-in lands or ends (under
// onboarding, behind Settings) and read the connection once per load, so every
// change to it has to be said (AIO_CONN_CHANGED).
describe("the connection's change, said", () => {
  let heard: string[] = [];
  const said = () => heard;
  let restore = () => {};
  beforeEach(() => {
    heard = [];
    const spy = vi.spyOn(window, "dispatchEvent").mockImplementation((e: Event) => (heard.push(e.type), true));
    restore = () => spy.mockRestore();
  });
  afterEach(() => restore());

  it("a sign-in recorded says it, and a read that finds it already recorded does not", async () => {
    status.mockResolvedValue(on);
    await readSignIn();
    expect(said()).toEqual([AIO_CONN_CHANGED]);
    await readSignIn();
    expect(said()).toEqual([AIO_CONN_CHANGED]);
  });

  it("a status that ends the recorded sign-in says it", async () => {
    saveAiojf({ signedIn: { base: BASE, userName: "Adam" } });
    status.mockResolvedValue({ supported: true, connected: false });
    await readSignIn();
    expect(said()).toEqual([AIO_CONN_CHANGED]);
  });

  it("a build that cannot open sources records nothing, so says nothing", async () => {
    status.mockResolvedValue(on);
    canSource.mockResolvedValue(false);
    await readSignIn();
    expect(said()).toEqual([]);
  });

  it("a sign-out says it when a sign-in was held, and the sync's change either way", async () => {
    saveAiojf({ signedIn: { base: BASE, userName: "Adam" } });
    await signOutOfAio();
    expect(said()).toEqual([AIOJF_SYNCED, AIO_CONN_CHANGED]);
    heard.length = 0;
    await signOutOfAio();
    expect(said()).toEqual([AIOJF_SYNCED]);
  });

  it("a 401 that ended the sign-in says it, once the native side agrees it is over", async () => {
    saveAiojf({ signedIn: { base: BASE, userName: "Adam" } });
    status.mockResolvedValue(on);
    await reconcile();
    expect(said()).toEqual([]);
    status.mockResolvedValue({ supported: true, connected: false });
    await reconcile();
    expect(said()).toEqual([AIOJF_SYNCED, AIO_CONN_CHANGED]);
    expect(loadAiojf().signedIn).toBeUndefined();
  });
});
