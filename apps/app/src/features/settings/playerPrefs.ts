import { load, save } from "../../lib/storage";

/**
 * The player's settings (plan 025, P3b): Audio Channels, Subtitle Size, and
 * the pop-out's size and corner. Four choices, each stored on its own and read
 * back checked, so a stored value this build doesn't offer is the default.
 *
 * Audio Channels and Subtitle Size are mpv's, and native holds them: the sync
 * (playerPrefsSync.ts) sends them at launch and on every change. The pop-out's
 * two ride each `popout_open`, read at the moment it opens. None of them is
 * per film; the subtitle delay is, and it isn't here (the player's z and x).
 *
 * Saving notifies listeners, as Skipping does, so a screen showing one can
 * follow a change made elsewhere.
 */

/** One stored choice from a fixed list. */
function choice<K extends string>(key: string, event: string, keys: readonly K[], dflt: K) {
  const as = (x: unknown): K => keys.find((k) => k === x) ?? dflt;
  return {
    load: (): K => as(load<unknown>(key, 1, dflt)),
    save: (v: K): void => {
      save(key, 1, v);
      window.dispatchEvent(new CustomEvent(event, { detail: v }));
    },
    on: (cb: (v: K) => void): (() => void) => {
      const handler = (e: Event) => cb(as((e as CustomEvent<unknown>).detail));
      window.addEventListener(event, handler);
      return () => window.removeEventListener(event, handler);
    },
  };
}

// ---------------------------------------------------------------- audio

/** Automatic follows the device (mpv's auto-safe). */
export type AudioChannels = "auto" | "stereo" | "5.1" | "7.1";

/** The picker options, in the order Settings draws them. */
export const AUDIO_CHANNEL_TABS: Array<{ key: AudioChannels; label: string }> = [
  { key: "auto", label: "Automatic" },
  { key: "stereo", label: "Stereo" },
  { key: "5.1", label: "5.1" },
  { key: "7.1", label: "7.1" },
];

const AUDIO = choice<AudioChannels>(
  "audioChannels",
  "blammytv:audio-channels",
  AUDIO_CHANNEL_TABS.map((t) => t.key),
  "auto",
);
export const loadAudioChannels = AUDIO.load;
export const saveAudioChannels = AUDIO.save;
export const onAudioChannelsChange = AUDIO.on;

/**
 * What native is told. The layouts are mpv's own words, and Automatic is the
 * one that is a different word: its default, `auto-safe` (v0.11.21 stopped
 * forcing stereo). Native checks the word again (mpvprefs.rs).
 */
export function mpvAudioChannels(v: AudioChannels): string {
  return v === "auto" ? "auto-safe" : v;
}

// ------------------------------------------------------------- subtitles

export type SubtitleSize = "small" | "normal" | "large" | "larger";

/** The picker options, in the order Settings draws them. */
export const SUBTITLE_SIZE_TABS: Array<{ key: SubtitleSize; label: string }> = [
  { key: "small", label: "Small" },
  { key: "normal", label: "Normal" },
  { key: "large", label: "Large" },
  { key: "larger", label: "Larger" },
];

const SUB_SCALE: Record<SubtitleSize, number> = {
  small: 0.8,
  normal: 1,
  large: 1.25,
  larger: 1.5,
};

const SUBS = choice<SubtitleSize>(
  "subtitleSize",
  "blammytv:subtitle-size",
  SUBTITLE_SIZE_TABS.map((t) => t.key),
  "normal",
);
export const loadSubtitleSize = SUBS.load;
export const saveSubtitleSize = SUBS.save;
export const onSubtitleSizeChange = SUBS.on;

/** mpv's `sub-scale` for a size: 1 is a text subtitle at its own size. */
export function subScale(v: SubtitleSize): number {
  return SUB_SCALE[v];
}

// --------------------------------------------------------------- pop-out

export type PopoutSize = "small" | "medium" | "large";
export type PopoutCorner = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** The picker options. Large is half the screen, which is what it always was. */
export const POPOUT_SIZE_TABS: Array<{ key: PopoutSize; label: string }> = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
];

/** Where it opens: the middle, which is what it always did, then the corners
 * top to bottom. */
export const POPOUT_CORNERS: Array<{ key: PopoutCorner; label: string }> = [
  { key: "center", label: "Centre" },
  { key: "top-left", label: "Top left" },
  { key: "top-right", label: "Top right" },
  { key: "bottom-left", label: "Bottom left" },
  { key: "bottom-right", label: "Bottom right" },
];

const POP_SIZE = choice<PopoutSize>(
  "popoutSize",
  "blammytv:popout-size",
  POPOUT_SIZE_TABS.map((t) => t.key),
  "large",
);
export const loadPopoutSize = POP_SIZE.load;
export const savePopoutSize = POP_SIZE.save;
export const onPopoutSizeChange = POP_SIZE.on;

const POP_CORNER = choice<PopoutCorner>(
  "popoutCorner",
  "blammytv:popout-corner",
  POPOUT_CORNERS.map((t) => t.key),
  "center",
);
export const loadPopoutCorner = POP_CORNER.load;
export const savePopoutCorner = POP_CORNER.save;
export const onPopoutCornerChange = POP_CORNER.on;

/** What `popout_open` carries, read as it opens. */
export function popoutPlace(): { size: PopoutSize; corner: PopoutCorner } {
  return { size: loadPopoutSize(), corner: loadPopoutCorner() };
}
