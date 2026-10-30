import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The recordings store, as one flag: whether a recording runs.
let recording = false;
let working = false;
vi.mock("../features/recordings/store", () => ({ runningNow: () => recording, workingNow: () => working }));
vi.mock("./tauri", () => ({ isLivePopout: () => false }));

import { finishFirst, isPlaying } from "./playingNow";

/** A document with only these selectors (or ids) in it. */
function dom(...present: string[]) {
  vi.stubGlobal("document", {
    querySelector: (sel: string) => (present.includes(sel) ? {} : null),
    getElementById: (id: string) => (present.includes("#" + id) ? {} : null),
  });
}

describe("a recording holds Install and Restart (plan 029)", () => {
  beforeEach(() => {
    recording = false;
    working = false;
    dom();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is not playing with nothing watched and nothing recording", () => {
    expect(isPlaying()).toBe(false);
    expect(finishFirst()).toBeNull();
  });

  it("is playing while a recording runs, with no player open", () => {
    recording = true;
    expect(isPlaying()).toBe(true);
  });

  it("says which: watching, recording, or both", () => {
    dom("#inv-chrome");
    expect(finishFirst()).toBe("Finish watching first.");
    dom();
    recording = true;
    expect(finishFirst()).toBe("Stop recording first.");
    dom("#inv-chrome");
    expect(finishFirst()).toBe("Finish watching and stop recording first.");
  });

  it("is playing while a finished one is being repackaged or shrunk, and says to wait", () => {
    working = true;
    expect(isPlaying()).toBe(true);
    expect(finishFirst()).toBe("Wait for recordings to finish first.");
    dom("#inv-chrome");
    expect(finishFirst()).toBe("Finish watching and wait for recordings to finish first.");
    recording = true;
    expect(finishFirst()).toBe("Finish watching, stop recording and wait for recordings to finish first.");
  });

  it("lets go when the job ends", () => {
    working = true;
    expect(isPlaying()).toBe(true);
    working = false;
    expect(isPlaying()).toBe(false);
    expect(finishFirst()).toBeNull();
  });

  it("lets go when the recording ends", () => {
    recording = true;
    expect(isPlaying()).toBe(true);
    recording = false;
    expect(isPlaying()).toBe(false);
  });
});
