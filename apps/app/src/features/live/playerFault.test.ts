import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAYER_FAULT_LINE,
  currentPlayerFault,
  onPlayerFault,
  playerFaultWhy,
  setPlayerFault,
} from "./playerFault";

// What mpv.rs load_libmpv builds when no libmpv-2.dll will load.
const LIBMPV =
  "load libmpv-2.dll: LoadLibraryExW failed (also tried: " +
  "C:\\Users\\sam\\AppData\\Local\\BlammyTV\\libmpv-2.dll: LoadLibraryExW failed; " +
  "C:\\Users\\sam\\AppData\\Local\\BlammyTV\\resources\\libmpv-2.dll: LoadLibraryExW failed)";

describe("playerFaultWhy", () => {
  it("keeps libmpv's first clause and drops the paths it tried", () => {
    const why = playerFaultWhy(LIBMPV);
    expect(why).toBe("load libmpv-2.dll: LoadLibraryExW failed");
    expect(why).not.toMatch(/Users|AppData|also tried|\\/);
  });

  it("leaves a message with nothing to drop as it was", () => {
    expect(playerFaultWhy("mpv_create failed")).toBe("mpv_create failed");
    expect(playerFaultWhy("mpv_initialize failed")).toBe("mpv_initialize failed");
    expect(playerFaultWhy("player is bound to window 12, cannot re-target to 34")).toBe(
      "player is bound to window 12, cannot re-target to 34",
    );
  });

  it("keeps a parenthesis that is not the list of paths", () => {
    expect(playerFaultWhy("CreateWindowExW: Access is denied. (0x80070005)")).toBe(
      "CreateWindowExW: Access is denied. (0x80070005)",
    );
  });

  it("reads an Error, and an object with a message, as well as a string", () => {
    expect(playerFaultWhy(new Error(LIBMPV))).toBe("load libmpv-2.dll: LoadLibraryExW failed");
    expect(playerFaultWhy({ message: "mpv_create failed" })).toBe("mpv_create failed");
  });

  it("says nothing for what is not text", () => {
    for (const e of [undefined, null, 42, {}, { message: 7 }, ["x"]])
      expect(playerFaultWhy(e), JSON.stringify(e)).toBe("");
  });

  it("puts a line break or a run of spaces on one line", () => {
    expect(playerFaultWhy("  mpv_create \n\t failed  ")).toBe("mpv_create failed");
  });

  it("cuts a long reason short, with an ellipsis, within 120 characters", () => {
    const why = playerFaultWhy("x".repeat(500));
    expect(why.length).toBeLessThanOrEqual(120);
    expect(why.endsWith("\u2026")).toBe(true);
  });
});

describe("the report", () => {
  afterEach(() => setPlayerFault(null));

  it("is none until a failed open is reported, and none again once taken back", () => {
    expect(currentPlayerFault()).toBeNull();
    const fault = { why: "mpv_create failed", retry: () => {} };
    setPlayerFault(fault);
    expect(currentPlayerFault()).toBe(fault);
    setPlayerFault(null);
    expect(currentPlayerFault()).toBeNull();
  });

  it("tells everyone listening, once per change, until they stop", () => {
    const heard = vi.fn();
    const stop = onPlayerFault(heard);
    const fault = { why: "w", retry: () => {} };
    setPlayerFault(fault);
    setPlayerFault(fault); // the same report again is not a change
    setPlayerFault(null);
    setPlayerFault(null);
    expect(heard.mock.calls).toEqual([[fault], [null]]);
    stop();
    setPlayerFault(fault);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("carries the way to open the player again", () => {
    const retry = vi.fn();
    setPlayerFault({ why: "w", retry });
    currentPlayerFault()?.retry();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the card's first line", () => {
  it("is the player's, and never the stream's", () => {
    expect(PLAYER_FAULT_LINE).toBe("The player couldn\u2019t start.");
    expect(PLAYER_FAULT_LINE).not.toMatch(/isn.t responding/i);
  });
});
