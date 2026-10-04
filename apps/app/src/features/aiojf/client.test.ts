import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

import { aiojfPoll, aiojfRequest, aiojfStatus } from "./client";

beforeEach(() => {
  invoke.mockReset();
});

describe("aiojfStatus", () => {
  it("reads what the native side says", async () => {
    invoke.mockResolvedValue({ connected: true, userName: "Adam", userId: "u1", base: "https://x/jellyfin" });
    expect(await aiojfStatus()).toEqual({
      supported: true,
      connected: true,
      userName: "Adam",
      userId: "u1",
      base: "https://x/jellyfin",
    });
  });

  it("takes a build with no such command as not connected and unsupported", async () => {
    invoke.mockRejectedValue("Command aiojf_status not found");
    expect(await aiojfStatus()).toEqual({ supported: false, connected: false });
  });

  it("takes a stub that answers nothing the same way", async () => {
    invoke.mockResolvedValue(undefined);
    expect(await aiojfStatus()).toEqual({ supported: false, connected: false });
  });

  it("takes any other failure as supported and not connected", async () => {
    invoke.mockRejectedValue("the vault is locked");
    expect(await aiojfStatus()).toEqual({ supported: true, connected: false });
  });
});

describe("aiojfPoll", () => {
  it("passes the four answers and reads anything else as an error", async () => {
    for (const a of ["approved", "pending", "expired", "error"]) {
      invoke.mockResolvedValue(a);
      expect(await aiojfPoll()).toBe(a);
    }
    invoke.mockResolvedValue("teapot");
    expect(await aiojfPoll()).toBe("error");
  });
});

describe("aiojfRequest", () => {
  it("names the path and sends its query and body as data", async () => {
    invoke.mockResolvedValue({ status: 204, body: "" });
    await aiojfRequest("POST", "/Sessions/Playing", undefined, { ItemId: "a1" });
    expect(invoke).toHaveBeenCalledWith("aiojf_request", {
      method: "POST",
      path: "/Sessions/Playing",
      query: null,
      body: { ItemId: "a1" },
    });
  });
});
