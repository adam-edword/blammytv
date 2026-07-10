import { beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybackPrefs,
  matchTrack,
  rememberPlayback,
} from "./playbackPrefs";

const track = (id: number, lang: string, label = "") => ({
  id,
  lang,
  label,
  selected: false,
});

describe("matchTrack", () => {
  it("matches exact and normalized language codes", () => {
    const tracks = [track(1, "jpn"), track(2, "eng"), track(3, "spa")];
    expect(matchTrack(tracks, "eng")?.id).toBe(2);
    expect(matchTrack(tracks, "en")?.id).toBe(2); // en ↔ eng
    expect(matchTrack(tracks, "en-US")?.id).toBe(2); // region stripped
    expect(matchTrack(tracks, "ja")?.id).toBe(1); // alias jpn ↔ ja
    expect(matchTrack(tracks, "es")?.id).toBe(3);
    expect(matchTrack(tracks, "de")).toBeUndefined();
  });

  it("falls back to label when lang is empty", () => {
    const tracks = [track(1, "", "English"), track(2, "", "Japanese")];
    expect(matchTrack(tracks, "english")?.id).toBe(1);
    expect(matchTrack(tracks, "eng")).toBeUndefined(); // labels aren't codes
  });

  it("never matches on an empty want", () => {
    expect(matchTrack([track(1, "eng")], "")).toBeUndefined();
  });
});

describe("prefs store", () => {
  beforeEach(() => localStorage.clear());

  it("merges patches and round-trips", () => {
    rememberPlayback({ subLang: "eng" });
    rememberPlayback({ speed: 1.5 });
    expect(loadPlaybackPrefs()).toEqual({ subLang: "eng", speed: 1.5 });
    rememberPlayback({ subLang: "off" });
    expect(loadPlaybackPrefs()).toEqual({ subLang: "off", speed: 1.5 });
  });
});
