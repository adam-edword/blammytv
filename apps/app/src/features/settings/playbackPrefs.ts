import { load, save } from "../../lib/storage";
import type { TrackEntry } from "../live/overlayApi";
import { loadAudioLang, loadSubLang } from "./languagePrefs";

/**
 * VOD playback continuity: the user's last EXPLICIT track/speed choices,
 * re-applied when the next episode loads (reset_per_file clears them; every
 * stream is a new instance, so choices die with the file otherwise — the
 * "subs vanish every Up Next roll" complaint). Captured only from real
 * clicks in the player menus, matched by LANGUAGE (track ids are
 * per-file and meaningless across episodes). Live TV never touches this.
 */

export interface PlaybackPrefs {
  /** Preferred audio language (mpv lang code as seen on a track). */
  audioLang?: string;
  /** Preferred subtitle language, or "off" for explicitly no subs. */
  subLang?: string;
  /** Last chosen playback rate. */
  speed?: number;
  /** Output level, 0-1. Unlike the fields above this is device-level, not
   * VOD-only: it rides EVERY playback (live included). Volume lived only
   * in component state, so the popout round-trip — which unmounts the
   * chrome — restored 100% and pushed it to mpv. */
  volume?: number;
  /** Muted, same scope as volume. */
  muted?: boolean;
}

const KEY = "playbackPrefs";
const VERSION = 1;

/** Per-show overrides. Track and speed choices are ABOUT the show (an
 * anime wants Japanese audio and English subs; a Western show wants
 * neither), so remembering one global answer means those two fight over it
 * forever. Volume and mute are deliberately NOT here: those are about the
 * room you are in, not the thing you are watching. */
const SHOW_KEY = "playbackPrefsByShow";
/** Bounded so a heavy user's store cannot grow without limit. Eviction is
 * least-recently-set, which for this data is also least-recently-watched. */
const SHOW_CAP = 120;
type ShowPrefs = Pick<PlaybackPrefs, "audioLang" | "subLang" | "speed">;
interface ShowStore {
  /** Most-recent first; the eviction order. */
  order: string[];
  byId: Record<string, ShowPrefs>;
}
const SHOW_FIELDS = ["audioLang", "subLang", "speed"] as const;

function loadShowStore(): ShowStore {
  return load<ShowStore>(SHOW_KEY, VERSION, { order: [], byId: {} });
}

/**
 * The prefs to apply, resolved across three sources.
 *
 *   per-show memory  >  the language SETTING  >  the learned global
 *
 * The learned global is the bottom layer: `rememberPlayback` writes it on
 * every explicit click, so it is whatever you last picked anywhere. That is
 * a reasonable fallback and a bad way to state an intention, which is why
 * `languagePrefs` sits above it. A language you chose in Settings should not
 * be undone by one click on one show, and before that setting existed there
 * was no screen that would have told you it had been.
 *
 * A per-show choice still beats both: it is the most specific thing you have
 * ever said about this thing you are watching.
 *
 * With no setting stored the middle layer contributes nothing and this is
 * exactly the old two-layer behaviour, so nobody's existing player changes.
 */
export function loadPlaybackPrefs(showId?: string): PlaybackPrefs {
  const global = load<PlaybackPrefs>(KEY, VERSION, {});
  const chosen: PlaybackPrefs = {};
  const audio = loadAudioLang();
  const sub = loadSubLang();
  if (audio) chosen.audioLang = audio;
  if (sub) chosen.subLang = sub;
  const base = { ...global, ...chosen };
  if (!showId) return base;
  const per = loadShowStore().byId[showId];
  return per ? { ...base, ...per } : base;
}

/**
 * Record an explicit choice. Always updates the global answer (so it
 * carries to shows with no history), and additionally pins the track and
 * speed fields to `showId` when one is given.
 */
export function rememberPlayback(
  patch: Partial<PlaybackPrefs>,
  showId?: string,
): void {
  // THE RAW GLOBAL, not the resolved prefs. This said loadPlaybackPrefs(),
  // which was an identity merge until that function started folding the
  // language SETTING in underneath. After that, every playback wrote the
  // setting into the learned store: TheaterOverlay fires a volume/mute
  // remember on every mount, so setting "Japanese" and playing anything at
  // all baked "ja" into the global. Clearing the picker back to No
  // preference then changed nothing, because the learned layer underneath it
  // now said "ja" too, and no screen would ever have explained why. It also
  // destroyed whatever the global had genuinely learned before.
  //
  // The layers are resolved at READ time. Nothing may write one into another.
  save(KEY, VERSION, { ...load<PlaybackPrefs>(KEY, VERSION, {}), ...patch });
  if (!showId) return;
  // Only the show-scoped fields, and only the ones actually present: a
  // volume change must not write an empty record for every show.
  const scoped: ShowPrefs = {};
  for (const f of SHOW_FIELDS)
    if (patch[f] !== undefined) (scoped as Record<string, unknown>)[f] = patch[f];
  if (Object.keys(scoped).length === 0) return;
  const store = loadShowStore();
  store.byId[showId] = { ...store.byId[showId], ...scoped };
  store.order = [showId, ...store.order.filter((id) => id !== showId)];
  for (const evicted of store.order.slice(SHOW_CAP)) delete store.byId[evicted];
  store.order = store.order.slice(0, SHOW_CAP);
  save(SHOW_KEY, VERSION, store);
}

/** Language NAMES as providers write them, mapped to the same codes. A
 * remux often ships tracks with an empty `lang` and only a human label
 * ("English SDH", "Japanese (FLAC 2.0)"), so a pick on one file was stored
 * as a name and could never match the next file's `eng`. Normalizing both
 * sides to one key is what makes a remembered choice survive an episode
 * boundary on those files. */
const NAMES: Record<string, string> = {
  english: "en",
  japanese: "ja",
  spanish: "es",
  castilian: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  brazilian: "pt",
  russian: "ru",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  cantonese: "zh",
  dutch: "nl",
  polish: "pl",
  turkish: "tr",
  arabic: "ar",
  hindi: "hi",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  czech: "cs",
  greek: "el",
  hebrew: "he",
  thai: "th",
  vietnamese: "vi",
  indonesian: "id",
  ukrainian: "uk",
  romanian: "ro",
  hungarian: "hu",
};

/** ISO 639-2 to ISO 639-1, both forms of a language that has two (the
 * bibliographic `ger`, the terminology `deu`), for every language Settings
 * offers (languagePrefs.ts LANGUAGES). A track in a Matroska or MP4 file
 * carries the three-letter code. The old cut to its first two letters
 * turned `pol` into `po` and `rum` into `ru`, which is Russian, so eight of
 * Settings' languages never matched a coded track and Romanian matched the
 * wrong one. A three-letter code that is not here still gets that cut. */
const ISO2: Record<string, string> = {
  eng: "en",
  spa: "es",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  ita: "it",
  por: "pt",
  jpn: "ja",
  kor: "ko",
  chi: "zh",
  zho: "zh",
  hin: "hi",
  ara: "ar",
  rus: "ru",
  dut: "nl",
  nld: "nl",
  pol: "pl",
  tur: "tr",
  swe: "sv",
  nor: "no",
  nob: "no",
  nno: "no",
  dan: "da",
  fin: "fi",
  cze: "cs",
  ces: "cs",
  gre: "el",
  ell: "el",
  heb: "he",
  tha: "th",
  vie: "vi",
  ind: "id",
  ukr: "uk",
  rum: "ro",
  ron: "ro",
  hun: "hu",
};

/** ISO-ish language normalization: "eng", "en", "en-US", and "English SDH"
 * all agree. Conservative: an empty or unrecognized value never matches
 * anything, so a wrong guess can't hijack a track the user didn't pick. */
function langKey(s: string): string {
  // Labels carry decoration the language never does: "English (AC3 5.1)",
  // "Japanese [Dub]", "Spanish - Latin America". Take the leading word and
  // let the tables below decide whether it means anything.
  const head = s
    .trim()
    .toLowerCase()
    .replace(/[([].*$/, "")
    .split(/[-_,/|]/)[0]
    .trim()
    .split(/\s+/)[0];
  if (!head) return "";
  if (NAMES[head]) return NAMES[head];
  if (ISO2[head]) return ISO2[head];
  // Only code-shaped leftovers are keys. A stray word ("commentary",
  // "forced") must NOT become a matchable key, or it would collide with
  // the same word on an unrelated track.
  return head.length === 2 || head.length === 3
    ? head.length === 3
      ? head.slice(0, 2)
      : head
    : "";
}

/** The track matching a remembered language, if any. Lang field first,
 * label as fallback (some files only label tracks "English"). */
export function matchTrack(
  tracks: TrackEntry[],
  want: string,
): TrackEntry | undefined {
  const w = langKey(want);
  if (!w) return undefined;
  return (
    tracks.find((t) => t.lang && langKey(t.lang) === w) ??
    tracks.find((t) => langKey(t.label) === w)
  );
}
