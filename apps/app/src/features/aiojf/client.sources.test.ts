import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

// The memo of whether the build can open sources lives in the module: a fresh
// one for every case.
async function load() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  invoke.mockReset();
});

describe("aiojfSources", () => {
  it("names the title and whether to search again, and reads the answer", async () => {
    const { aiojfSources } = await load();
    invoke.mockResolvedValue({
      status: 200,
      sources: [{ Id: "s1", Path: "https://cdn.example.com/a.mkv", Type: "Default" }],
      errorCode: "NoCompatibleStream",
    });
    const r = await aiojfSources("a".repeat(32), true);
    expect(invoke).toHaveBeenCalledWith("aiojf_sources", { itemId: "a".repeat(32), refresh: true });
    expect(r).toEqual({
      status: 200,
      sources: [{ Id: "s1", Path: "https://cdn.example.com/a.mkv", Type: "Default" }],
      errorCode: "NoCompatibleStream",
    });
  });

  it("an answer with no sources or no error code is an empty list with none", async () => {
    const { aiojfSources } = await load();
    invoke.mockResolvedValue({ status: 404 });
    expect(await aiojfSources("a".repeat(32), false)).toEqual({ status: 404, sources: [] });
  });

  it("a build with no such command says it needs its update", async () => {
    const { aiojfSources, NO_SOURCES } = await load();
    invoke.mockRejectedValue("Command aiojf_sources not found");
    await expect(aiojfSources("a".repeat(32), false)).rejects.toThrow(NO_SOURCES);
  });

  it("so does a stub that answers nothing", async () => {
    const { aiojfSources, NO_SOURCES } = await load();
    invoke.mockResolvedValue(undefined);
    await expect(aiojfSources("a".repeat(32), false)).rejects.toThrow(NO_SOURCES);
  });

  it("any other refusal passes through as it came", async () => {
    const { aiojfSources } = await load();
    invoke.mockRejectedValue("refused: not an AIOStreams item id");
    await expect(aiojfSources("zz", false)).rejects.toBe("refused: not an AIOStreams item id");
  });
});

describe("aiojfCanSource", () => {
  it("is true for a build that refuses the id it is asked with, before any request", async () => {
    const { aiojfCanSource } = await load();
    invoke.mockRejectedValue("refused: not an AIOStreams item id");
    expect(await aiojfCanSource()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("aiojf_sources", { itemId: "", refresh: false });
  });

  it("is false for a build with no such command", async () => {
    const { aiojfCanSource } = await load();
    invoke.mockRejectedValue("Command aiojf_sources not found");
    expect(await aiojfCanSource()).toBe(false);
  });

  it("is false for a stub that answers nothing", async () => {
    const { aiojfCanSource } = await load();
    invoke.mockResolvedValue(undefined);
    expect(await aiojfCanSource()).toBe(false);
  });

  it("is true for a build that fails some other way, which has the command", async () => {
    const { aiojfCanSource } = await load();
    invoke.mockRejectedValue("the vault is locked");
    expect(await aiojfCanSource()).toBe(true);
  });

  it("asks once", async () => {
    const { aiojfCanSource } = await load();
    invoke.mockRejectedValue("refused: not an AIOStreams item id");
    await aiojfCanSource();
    await aiojfCanSource();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("is false outside the app, without asking", async () => {
    vi.stubGlobal("window", {});
    const { aiojfCanSource } = await load();
    expect(await aiojfCanSource()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });
});
