import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRecordingNotice,
  loadRecordingWarning,
  recordingWarningsOn,
  saveRecordingNotice,
  saveRecordingWarning,
  showRecordingWarningsAgain,
} from "./recordingWarning";

// Same node-env seam as playbackPrefs.test.ts.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

describe("the two recording reminders (plan 029, D3 and D5)", () => {
  beforeEach(() => store.clear());

  it("are both on until ticked off", () => {
    expect(loadRecordingWarning()).toBe(true);
    expect(loadRecordingNotice()).toBe(true);
    expect(recordingWarningsOn()).toBe(true);
  });

  it("turn off one at a time: ticking one leaves the other on", () => {
    saveRecordingNotice(false);
    expect(loadRecordingNotice()).toBe(false);
    expect(loadRecordingWarning()).toBe(true);
    expect(recordingWarningsOn()).toBe(false);
    saveRecordingNotice(true);
    saveRecordingWarning(false);
    expect(loadRecordingWarning()).toBe(false);
    expect(loadRecordingNotice()).toBe(true);
    expect(recordingWarningsOn()).toBe(false);
  });

  it("come back together from Settings, whichever was off", () => {
    saveRecordingWarning(false);
    saveRecordingNotice(false);
    showRecordingWarningsAgain();
    expect(recordingWarningsOn()).toBe(true);
    saveRecordingNotice(false);
    showRecordingWarningsAgain();
    expect(loadRecordingNotice()).toBe(true);
    expect(loadRecordingWarning()).toBe(true);
  });
});
