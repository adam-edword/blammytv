import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPlaybackPrefs,
  matchTrack,
  rememberPlayback,
} from "./playbackPrefs";

// Same node-env seam as watching.test.ts — vitest runs without a DOM.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

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
    // This used to assert "labels aren't codes" and expect undefined. That
    // WAS the bug: a pick on a label-only file stored a name, and the next
    // episode's coded tracks could never match it, so the choice silently
    // died at every episode boundary. Names and codes now share one key.
    expect(matchTrack(tracks, "eng")?.id).toBe(1);
  });

  it("never matches on an empty want", () => {
    expect(matchTrack([track(1, "eng")], "")).toBeUndefined();
  });
});

describe("prefs store", () => {
  beforeEach(() => store.clear());

  it("merges patches and round-trips", () => {
    rememberPlayback({ subLang: "eng" });
    rememberPlayback({ speed: 1.5 });
    expect(loadPlaybackPrefs()).toEqual({ subLang: "eng", speed: 1.5 });
    rememberPlayback({ subLang: "off" });
    expect(loadPlaybackPrefs()).toEqual({ subLang: "off", speed: 1.5 });
  });
});

describe("volume/mute prefs", () => {
  beforeEach(() => store.clear());

  it("round-trips volume and mute alongside the VOD fields", () => {
    rememberPlayback({ subLang: "eng" });
    rememberPlayback({ volume: 0.15, muted: true });
    const p = loadPlaybackPrefs();
    expect(p.volume).toBe(0.15);
    expect(p.muted).toBe(true);
    expect(p.subLang).toBe("eng"); // merge, not replace
  });

  it("reads absent volume as undefined so the caller can default to 1", () => {
    expect(loadPlaybackPrefs().volume).toBeUndefined();
    // volume 0 must survive as 0 — a `?? 1` default only fires on absence,
    // so a muted-by-slider user doesn't get reset to full on remount.
    rememberPlayback({ volume: 0 });
    expect(loadPlaybackPrefs().volume ?? 1).toBe(0);
  });
});

describe("matchTrack across label-only tracks", () => {
  // The real-world case this exists for: a remux labels its tracks in
  // English words and carries no lang code, so a pick on episode 1 was
  // stored as a NAME and could never match episode 2's "eng".
  it("matches a remembered language NAME against a coded track", () => {
    const tracks = [track(1, "jpn"), track(2, "eng")];
    expect(matchTrack(tracks, "English")?.id).toBe(2);
    expect(matchTrack(tracks, "Japanese")?.id).toBe(1);
  });

  it("matches a remembered CODE against a label-only track", () => {
    const tracks = [track(1, "", "Japanese"), track(2, "", "English SDH")];
    expect(matchTrack(tracks, "eng")?.id).toBe(2);
    expect(matchTrack(tracks, "ja")?.id).toBe(1);
  });

  it("sees through the decoration providers hang off labels", () => {
    const tracks = [
      track(1, "", "English (AC3 5.1)"),
      track(2, "", "Spanish - Latin America"),
      track(3, "", "Portuguese [Brazil]"),
    ];
    expect(matchTrack(tracks, "en")?.id).toBe(1);
    expect(matchTrack(tracks, "spa")?.id).toBe(2);
    expect(matchTrack(tracks, "pt")?.id).toBe(3);
  });

  it("never matches on a non-language word", () => {
    // "Commentary" must not become a key, or two unrelated tracks both
    // labelled that way would match each other across files.
    const tracks = [track(1, "", "Commentary"), track(2, "", "Forced")];
    expect(matchTrack(tracks, "Commentary")).toBeUndefined();
    expect(matchTrack(tracks, "Forced")).toBeUndefined();
    expect(matchTrack(tracks, "")).toBeUndefined();
  });

  it("clears rather than keeping a stale preference", () => {
    // What the player writes when a picked track names no language: an
    // empty value that matches nothing, instead of leaving the previous
    // file's choice armed to override the user.
    rememberPlayback({ subLang: "eng" });
    rememberPlayback({ subLang: "" });
    expect(loadPlaybackPrefs().subLang).toBe("");
    expect(matchTrack([track(1, "eng")], "")).toBeUndefined();
  });
});
