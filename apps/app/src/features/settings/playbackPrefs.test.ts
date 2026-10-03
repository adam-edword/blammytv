import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "./languagePrefs";
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

describe("per-show prefs", () => {
  beforeEach(() => store.clear());

  it("keeps two shows from fighting over one answer", () => {
    // The case this exists for: an anime wants Japanese audio, a Western
    // show wants English, and one global answer means whichever you touched
    // last wins on both.
    rememberPlayback({ audioLang: "jpn", subLang: "eng" }, "tt-anime");
    rememberPlayback({ audioLang: "eng", subLang: "off" }, "tt-western");
    expect(loadPlaybackPrefs("tt-anime")).toMatchObject({
      audioLang: "jpn",
      subLang: "eng",
    });
    expect(loadPlaybackPrefs("tt-western")).toMatchObject({
      audioLang: "eng",
      subLang: "off",
    });
  });

  it("falls back to the global answer for a show never touched", () => {
    rememberPlayback({ subLang: "eng" }, "tt-known");
    // A brand new show inherits the usual answer rather than nothing.
    expect(loadPlaybackPrefs("tt-new").subLang).toBe("eng");
  });

  it("keeps volume and mute global, never per-show", () => {
    rememberPlayback({ volume: 0.2, muted: true }, "tt-a");
    // Device-level: the room you are in, not the thing you are watching.
    expect(loadPlaybackPrefs("tt-b").volume).toBe(0.2);
    expect(loadPlaybackPrefs().volume).toBe(0.2);
  });

  it("does not write a show record for a volume-only change", () => {
    rememberPlayback({ volume: 0.5 }, "tt-a");
    expect(store.get("blammytv.playbackPrefsByShow")).toBeUndefined();
  });

  it("evicts least-recently-set shows past the cap", () => {
    for (let i = 0; i < 130; i++)
      rememberPlayback({ subLang: `l${i}` }, `tt-${i}`);
    // The oldest are gone (falling back to global), the newest survive.
    expect(loadPlaybackPrefs("tt-129").subLang).toBe("l129");
    const raw = store.get("blammytv.playbackPrefsByShow")!;
    expect(Object.keys(JSON.parse(raw).data.byId).length).toBeLessThanOrEqual(120);
  });
});

describe("Settings' languages against the codes real tracks carry", () => {
  // ISO 639-2 as a Matroska or MP4 file writes it, both forms where a
  // language has two, for every language Settings offers. Cutting a
  // three-letter code to two letters missed pol, tur, swe, ind, cze, gre,
  // dut and rum, and matched rum to Russian.
  const CODES: Record<string, string[]> = {
    en: ["eng"],
    es: ["spa"],
    fr: ["fre", "fra"],
    de: ["ger", "deu"],
    it: ["ita"],
    pt: ["por"],
    ja: ["jpn"],
    ko: ["kor"],
    zh: ["chi", "zho"],
    hi: ["hin"],
    ar: ["ara"],
    ru: ["rus"],
    nl: ["dut", "nld"],
    pl: ["pol"],
    tr: ["tur"],
    sv: ["swe"],
    no: ["nor", "nob", "nno"],
    da: ["dan"],
    fi: ["fin"],
    cs: ["cze", "ces"],
    el: ["gre", "ell"],
    he: ["heb"],
    th: ["tha"],
    vi: ["vie"],
    id: ["ind"],
    uk: ["ukr"],
    ro: ["rum", "ron"],
    hu: ["hun"],
  };

  it("walks every language Settings offers, so a new one cannot go unchecked", () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
    for (const l of LANGUAGES) {
      // A language added to Settings with no codes here fails this, not
      // the walk below, which would otherwise skip it silently.
      expect(CODES[l.code], `${l.label} has codes in this test`).toBeDefined();
      for (const c of CODES[l.code]) {
        // The three-letter code on a track, wanted as the Settings code...
        expect(matchTrack([track(1, c)], l.code)?.id, `${l.label}: track '${c}'`).toBe(1);
        // ...and the Settings code on a track, wanted as the three-letter one
        // (a remembered pick is stored as whatever the track carried)...
        expect(matchTrack([track(1, l.code)], c)?.id, `${l.label}: wanted '${c}'`).toBe(1);
      }
      // ...and a label-only track, the way a remux names it.
      expect(matchTrack([track(1, "", l.label)], l.code)?.id, `${l.label}: label`).toBe(1);
    }
  });

  it("keeps each language off the others' tracks", () => {
    for (const a of LANGUAGES)
      for (const b of LANGUAGES) {
        if (a.code === b.code) continue;
        for (const c of CODES[b.code])
          expect(matchTrack([track(1, c)], a.code), `${a.label} vs '${c}'`).toBeUndefined();
      }
  });

  it("does not read Romanian (rum) as Russian", () => {
    expect(matchTrack([track(1, "rum")], "ru")).toBeUndefined();
    expect(matchTrack([track(1, "rus")], "ro")).toBeUndefined();
    expect(matchTrack([track(1, "rum")], "ro")?.id).toBe(1);
  });

  it("matches both forms of a language to each other", () => {
    expect(matchTrack([track(1, "ces")], "cze")?.id).toBe(1);
    expect(matchTrack([track(1, "nld")], "dut")?.id).toBe(1);
    expect(matchTrack([track(1, "deu")], "ger")?.id).toBe(1);
  });

  it("still gives a three-letter code that is not in the table its first two letters", () => {
    // Unchanged from before the table: not every code a file carries is one
    // Settings offers, and a remembered one keeps matching as it did.
    expect(matchTrack([track(1, "sco")], "sc")?.id).toBe(1);
    expect(matchTrack([track(1, "sc")], "sco")?.id).toBe(1);
  });

  it("still keeps stray words out", () => {
    expect(matchTrack([track(1, "", "Commentary")], "commentary")).toBeUndefined();
  });
});
