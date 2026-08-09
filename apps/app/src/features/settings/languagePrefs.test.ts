import { beforeEach, describe, expect, it, vi } from "vitest";

// Same node-env seam as playbackPrefs.test.ts: vitest runs without a DOM, so
// localStorage and the CustomEvent dispatch both need standing in for.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
});
vi.stubGlobal("CustomEvent", class {} as unknown as typeof CustomEvent);

const {
  AUTO,
  LANGUAGES,
  SUBS_OFF,
  loadAudioLang,
  loadSubLang,
  saveAudioLang,
  saveSubLang,
} = await import("./languagePrefs");
const { loadPlaybackPrefs, rememberPlayback } = await import("./playbackPrefs");

beforeEach(() => store.clear());

describe("languagePrefs", () => {
  it("is unset by default, so nothing is imposed on a fresh install", () => {
    expect(loadAudioLang()).toBe(AUTO);
    expect(loadSubLang()).toBe(AUTO);
  });

  it("round-trips a language", () => {
    saveAudioLang("ja");
    saveSubLang("en");
    expect(loadAudioLang()).toBe("ja");
    expect(loadSubLang()).toBe("en");
  });

  it("keeps 'off' for subtitles, which is not the same as no preference", () => {
    saveSubLang(SUBS_OFF);
    expect(loadSubLang()).toBe(SUBS_OFF);
    // Audio has no such state: silence is not a language.
    saveAudioLang(SUBS_OFF);
    expect(loadAudioLang()).toBe(AUTO);
  });

  it("treats an unrecognised code as unset rather than storing a dud", () => {
    // A code matchTrack could never match must not sit in the setting
    // looking configured while doing nothing.
    saveAudioLang("klingon");
    expect(loadAudioLang()).toBe(AUTO);
  });

  it("offers only codes it can normalise", () => {
    for (const l of LANGUAGES) {
      expect(l.code).toMatch(/^[a-z]{2}$/);
      expect(l.label.length).toBeGreaterThan(0);
    }
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });
});

describe("precedence: per-show > setting > learned global", () => {
  it("applies the setting when nothing has been learned", () => {
    saveAudioLang("ja");
    expect(loadPlaybackPrefs().audioLang).toBe("ja");
  });

  it("beats the learned global, which is the whole point", () => {
    // The old behaviour: one click on one show rewrote the global answer for
    // every show. A value typed into Settings has to survive that.
    rememberPlayback({ audioLang: "en" });
    expect(loadPlaybackPrefs().audioLang).toBe("en");
    saveAudioLang("ja");
    expect(loadPlaybackPrefs().audioLang).toBe("ja");
    rememberPlayback({ audioLang: "fr" });
    expect(loadPlaybackPrefs().audioLang).toBe("ja");
  });

  it("still loses to an explicit per-show choice", () => {
    saveAudioLang("en");
    rememberPlayback({ audioLang: "ja" }, "show-1");
    expect(loadPlaybackPrefs("show-1").audioLang).toBe("ja");
    // ...and only for that show.
    expect(loadPlaybackPrefs("show-2").audioLang).toBe("en");
  });

  it("leaves the old two-layer behaviour untouched when unset", () => {
    rememberPlayback({ audioLang: "de" });
    expect(loadPlaybackPrefs().audioLang).toBe("de");
    rememberPlayback({ audioLang: "it" }, "show-9");
    expect(loadPlaybackPrefs("show-9").audioLang).toBe("it");
    expect(loadPlaybackPrefs().audioLang).toBe("it");
  });

  it("carries subtitles-off through as a real preference", () => {
    saveSubLang(SUBS_OFF);
    expect(loadPlaybackPrefs().subLang).toBe(SUBS_OFF);
  });

  it("does not touch speed, volume or mute", () => {
    saveAudioLang("ja");
    rememberPlayback({ speed: 1.5, volume: 0.4, muted: true });
    const p = loadPlaybackPrefs();
    expect(p.speed).toBe(1.5);
    expect(p.volume).toBe(0.4);
    expect(p.muted).toBe(true);
  });
});
