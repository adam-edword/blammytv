import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri modules stand in for the shell: `listen` hands back the handler
// so a test can send the popout-closed event, and `invoke` just answers.
const handlers = new Map<string, () => void>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: () => void) => {
    handlers.set(name, cb);
    return Promise.resolve(() => {});
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import { isPlaying } from "./playingNow";
import { tauriPopoutOpen, tauriPopoutStop } from "./tauri";

/** A document with only these selectors (or ids) in it. */
function dom(...present: string[]) {
  vi.stubGlobal("document", {
    querySelector: (sel: string) => (present.includes(sel) ? {} : null),
    getElementById: (id: string) => (present.includes("#" + id) ? {} : null),
  });
}

describe("isPlaying", () => {
  beforeEach(async () => {
    dom();
    // Whatever an earlier test left open.
    await tauriPopoutStop();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is false with nothing playing", () => {
    expect(isPlaying()).toBe(false);
  });

  it("counts each stage in the DOM", () => {
    dom(".vod-stage");
    expect(isPlaying()).toBe(true);
    dom("#inv-chrome");
    expect(isPlaying()).toBe(true);
    dom(".mvtab .mvtile:not(.mvtile--empty)");
    expect(isPlaying()).toBe(true);
  });

  it("counts a live pop-out with no player in the DOM", async () => {
    await tauriPopoutOpen("http://x.example/live.ts", true);
    expect(isPlaying()).toBe(true);
  });

  it("stops counting it when the popout closes, either way", async () => {
    await tauriPopoutOpen("http://x.example/live.ts", true);
    handlers.get("popout-closed")?.();
    expect(isPlaying()).toBe(false);

    await tauriPopoutOpen("http://x.example/live.ts", true);
    expect(isPlaying()).toBe(true);
    await tauriPopoutStop();
    expect(isPlaying()).toBe(false);
  });

  it("leaves a VOD pop-out to the stage, which stays mounted for it", async () => {
    await tauriPopoutOpen("http://x.example/film.mkv", false);
    expect(isPlaying()).toBe(false);
    dom(".vod-stage");
    expect(isPlaying()).toBe(true);
  });
});
