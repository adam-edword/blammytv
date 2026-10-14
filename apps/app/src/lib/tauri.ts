import { invoke as rawInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notePoll } from "./playerPerf";
import { noteCall } from "./freezeProbe";
// The one place lib reads a setting: the pop-out's size and corner are read
// where every host's pop out passes through, so none can forget to send them.
import { popoutPlace } from "../features/settings/playerPrefs";

/** Every native call from here, timed for freezeProbe. */
function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  return noteCall(cmd, rawInvoke<T>(cmd, args));
}

/** The User-Agent a playlist asks for (Settings → Sources → Advanced), as the
 * argument native takes: there only when there is one. A playlist without
 * sends the call it always sent, and a native build from before it, which does
 * not know the argument, leaves it out of its parameters and plays as it did.
 * Never logged with a URL, here or there. */
const agentArg = (userAgent?: string): { userAgent?: string } => (userAgent ? { userAgent } : {});

/** True when running inside the Tauri shell (vs. a plain browser tab). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Open an https URL in the SYSTEM browser. The webview blocks target=_blank
 * navigation by design, so anchors to checkout links etc. must route through
 * the open_external command (lib.rs) — plain window.open in the browser dev
 * build. Fire-and-forget; failures only log. */
export function openExternal(url: string): void {
  if (isTauri()) {
    invoke("open_external", { url }).catch((err) =>
      console.error("openExternal failed", err),
    );
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * The native player (Windows, inv.rs). mpv renders into a child HWND at a
 * rect we supply, parked below the transparent webview. Rust never scales,
 * so every rect is in PHYSICAL DEVICE PIXELS — callers multiply CSS px by
 * devicePixelRatio themselves (radius included; it only feeds the rAF
 * change-detection key in InvertedPlayer — the DOM hole rounds itself from
 * RADIUS_CSS, and the native rect is always square).
 */
export interface CompRect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

/** Metadata shown by the player chrome over the video (TheaterOverlay). */
export interface TheaterMeta {
  channelName: string;
  logo?: string;
  /** VOD: the title's wide art, blurred into the loading screen behind the
   * logo (VodLoading). */
  backdrop?: string;
  title?: string;
  description?: string;
  /** CONTENT TYPE: true = live TV, false = VOD. The overlay derives its
   * whole chrome from `live === false` (star vs VOD buttons, live bar vs
   * scrubber, watchdog profile) — never derive this from EPG coverage. */
  live?: boolean;
  sourceName?: string;
  /** VOD episode identity, structured — the overlay's granular meta
   * toggles (S-number / E-number / episode title) compose their own line
   * from these instead of a pre-baked label. Absent for movies. */
  vod?: { season?: number; episode?: number; title?: string; hasNext?: boolean };
  /** Exact skip intervals from AniSkip (seconds; op/ed/mixed-op/mixed-ed/
   * recap) or AIOStreams' markers (those, and preview). When present they
   * take precedence over chapter heuristics for the Skip chip and the
   * automatic skip. Arrives async, pushed via a meta update mid-play. */
  skips?: Array<{ type: string; start: number; end: number }>;
  /** Airing programme's start label + progress (0–100) for the LIVE bar.
   * Frozen at open time (meta is pushed once), refreshed on channel change. */
  startLabel?: string;
  progressPct?: number;
  /** Whether the channel is starred — seeds the overlay's favorite button.
   * Read at open time; the overlay tracks its own state after a toggle. */
  favorite?: boolean;
}

/** Pop the stream out into mpv's own floating window (PiP). Rust tears the
 * in-app player down first (one provider connection at a time) and captures
 * the position so the popout resumes there, then plays in a separate mpv
 * instance the in-app teardown can't kill. */
/** Whether the popout is playing live TV, which holds one of the line's
 * connections. Multi-view stops such a popout when it opens (plan 017, F10),
 * so the grid can have that connection; a VOD popout never touches the
 * line and is left playing. */
let livePopout = false;
let watchingPopout = false;
/** Which screen opened the popout, when it said. Kept after it closes, so
 * a screen hearing popout-closed can ask whether the stream was its own. */
let popoutOwner: string | null = null;
export const popoutOpenedBy = (): string | null => popoutOwner;
/** Whether a live popout is up right now (see `livePopout`). Read-only, for
 * playingNow: popping a channel out unmounts the in-app player, so nothing
 * in the DOM says it is still playing. */
export const isLivePopout = (): boolean => livePopout;

export function tauriPopoutOpen(
  url: string,
  live: boolean,
  owner?: string,
  /** The playlist's own User-Agent, when it has one (live/stream.ts
   * `streamUserAgent`). mpv asks the provider with it. */
  userAgent?: string,
): Promise<void> {
  livePopout = live;
  popoutOwner = owner ?? null;
  if (!watchingPopout) {
    watchingPopout = true;
    void listen("popout-closed", () => {
      livePopout = false;
    }).catch(() => {});
  }
  // `live` because no mpv property answers it: an IPTV provider was measured
  // reporting `duration = 24.745` on a live feed (really the length of the
  // buffered window), and the popout used to read that as VOD and hand mpv a
  // resume point.
  //
  // REQUIRED, not optional. It was optional, and SportsTheater was the host
  // that did not pass it: every popped-out game took the native duration
  // fallback, which is the very heuristic measured to be false on live, and
  // so handed mpv a `start` seek on a live stream. The Rust still accepts
  // None for a frontend too old to say; nothing in THIS frontend may use
  // that path, and a required parameter is what enforces it.
  //
  // `size` and `corner` are Settings → Playback → Pop-out, read here so every
  // host sends them. A native build from before v0.11.29 ignores both and
  // opens at half the screen, centred, as it did.
  return invoke("popout_open", { url, live, ...popoutPlace(), ...agentArg(userAgent) });
}
/** Current popout playback position (seconds; 0 when none) — polled while
 * popped so a reclaim resumes at the right spot (old-app pattern). */
export function tauriPopoutPos(): Promise<number> {
  return invoke("popout_pos");
}
/** Close the popout window programmatically (the "Bring It Back" button).
 * Silent — no popout-closed event; the caller drives the reclaim. */
export function tauriPopoutStop(): Promise<void> {
  livePopout = false;
  return invoke("popout_stop");
}
/** Stop the popout if it is playing live TV (see `livePopout`). */
export function stopLivePopout(): void {
  if (livePopout) void tauriPopoutStop().catch(() => {});
}

/* ---- The player (inv.rs): video child at the bottom of the z-order,
 * chrome is ordinary React in the main webview, driving mpv through the
 * commands below. Rects PHYSICAL px. ---- */

export function tauriInvOpen(
  url: string,
  rect: CompRect,
  /** VOD resume point in seconds. mpv applies it as the file opens, so
   * nothing is fetched or decoded from 0:00 first. Omit for live. */
  start?: number,
  /** A live channel, which opens with subtitles off (mpv.rs
   * reset_per_file). Omit for VOD. */
  live?: boolean,
  /** The playlist's own User-Agent, when it has one. mpv asks the provider
   * with it for this file, and the next file without one goes back to mpv's
   * own (mpv.rs `play_wid`). */
  userAgent?: string,
): Promise<void> {
  return invoke("inv_open", {
    url,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    start: start && start > 0 ? start : null,
    live: live ?? null,
    ...agentArg(userAgent),
  });
}
export function tauriInvSetRect(rect: CompRect): Promise<void> {
  return invoke("inv_set_rect", { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
}
export function tauriInvStop(): Promise<void> {
  return invoke("inv_stop");
}

/** Raw mpv property snapshot, for the tune diagnostic. Every value is a
 * string ("<none>" when mpv has no answer, which is itself the signal for
 * several of the questions this exists to settle). Called only on rare
 * paths, never on the 500ms status poll. */
export function tauriMpvDiag(): Promise<Record<string, string>> {
  return invoke<string>("mpv_diag").then(
    (s) => JSON.parse(s) as Record<string, string>,
  );
}

/** Multi-view: a loopback URL that serves `url` with a CORS header (the
 * native stream proxy, mvproxy.rs). The URL it returns carries a random
 * token, not the provider's credentials. Rejects on a native build that
 * predates the proxy, which the caller treats as "play it directly".
 * `convertHevc`: this webview can't play HEVC, so the proxy converts an
 * HEVC stream to H.264 (mvconvert.rs). A native build from before that
 * ignores it and the tile says it needs the main player, as it did.
 * `userAgent`: the playlist's own, which the proxy sends upstream, for the
 * stream and for what the conversion is fed from. */
export function tauriMvProxyOpen(url: string, convertHevc = false, userAgent?: string): Promise<string> {
  return invoke<string>("mv_proxy_open", { url, convertHevc, ...agentArg(userAgent) });
}
/** Multi-view opened on a webview that can't play HEVC: have the native side
 * ask what its ffmpeg can do now, so the first HEVC tile doesn't wait for
 * it (mvconvert.rs). Rejects on a native build from before it. */
export function tauriMvConvertWarm(): Promise<void> {
  return invoke("mv_convert_warm");
}
/** An HLS stream for a multi-view tile: a loopback URL for its playlist,
 * whose URIs (variants, segments, keys) all point back at the proxy, so
 * hls.js gets the CORS header on every one (mvproxy.rs). Rejects on a
 * native build from before v0.10.67; the tile then plays it directly. */
export function tauriMvProxyOpenHls(url: string, userAgent?: string): Promise<string> {
  return invoke<string>("mv_proxy_open_hls", { url, ...agentArg(userAgent) });
}
/** Forget a URL `tauriMvProxyOpen` or `tauriMvProxyOpenHls` returned. */
export function tauriMvProxyClose(local: string): Promise<void> {
  return invoke("mv_proxy_close", { local });
}

/** Where multi-view's sound goes (mvaudio.rs): a loopback URL to POST
 * interleaved f32 stereo to, and the rate to render it at. */
export interface MvAudioSink {
  url: string;
  rate: number;
}
/** What the sound output is doing, for the console line when multi-view is
 * left: milliseconds buffered, and how often it ran dry or ran over. */
export interface MvAudioStats {
  open: boolean;
  rate: number;
  bufferedMs: number;
  underruns: number;
  overruns: number;
  droppedMs: number;
  chunks: number;
}
/** Open the native sound output (the default device, played from this
 * process so Discord's per-app capture hears it) and its listener. Rejects
 * with a plain message when there is no device, and on a native build from
 * before it: the caller then leaves the sound in the webview. */
export function tauriMvAudioOpen(): Promise<MvAudioSink> {
  return invoke<MvAudioSink>("mv_audio_open");
}
/** Stop the sound output and free the device. Nothing open is fine. */
export function tauriMvAudioClose(): Promise<void> {
  return invoke("mv_audio_close");
}
export function tauriMvAudioStats(): Promise<MvAudioStats> {
  return invoke<MvAudioStats>("mv_audio_stats");
}

/** Tell the native side this frontend booted far enough to run code.
 *
 * Only meaningful for a STAGED frontend (plan 008): the native side arms a
 * sentinel before serving one, and a sentinel still present at the next
 * startup means that bundle never got this far, so it is quarantined and
 * rolled back. Serving the embedded frontend, this is a no-op.
 *
 * The update mechanism ships inside the thing being updated, so this call
 * is the only evidence the native side gets that a bundle is not bricked.
 * Do not move it behind a route, a data load, or anything that can fail. */
export function tauriFrontendReady(): Promise<void> {
  return invoke("frontend_ready");
}

/** Hot channel (plan 008): check for a newer FRONTEND bundle and stage it.
 *
 * Takes no arguments on purpose. The manifest URL, the verifying key and
 * the native version all come from the binary's own config on the Rust
 * side: the frontend is the thing being replaced, so it gets no say in
 * what replaces it. Resolves with the staged version, or "" for nothing to
 * do (including the common case of a bundle built against different Rust,
 * which falls through to the native installer channel). */
export function tauriFrontendCheck(): Promise<string> {
  return invoke<string>("frontend_check");
}

/** What the hot channel is serving and what is waiting for next launch.
 * `pendingNotes` is the pending bundle's release notes, display text for
 * Settings → App ("" for none). It is absent from a native build from before
 * v0.11.36, which reads as none. */
export function tauriFrontendStatus(): Promise<{
  serving: string;
  pending: string;
  pendingNotes?: string;
}> {
  return invoke("frontend_status");
}

/** Apply a staged frontend by restarting. Never resolves on success: the
 * process is replaced. Only call with nothing playing. */
export function tauriFrontendApply(): Promise<void> {
  return invoke("frontend_apply");
}

export function tauriMpvPause(paused: boolean): Promise<void> {
  return invoke("mpv_pause", { paused });
}
export function tauriMpvMute(muted: boolean): Promise<void> {
  return invoke("mpv_mute", { muted });
}
export function tauriMpvVolume(vol: number): Promise<void> {
  return invoke("mpv_volume", { vol: Math.round(vol) });
}
export function tauriMpvSeek(delta: number): Promise<void> {
  return invoke("mpv_seek", { delta });
}
/** Absolute seek (seconds) — the VOD scrubber. */
export function tauriMpvSeekAbs(pos: number): Promise<void> {
  return invoke("mpv_seek_abs", { pos });
}
/** Playback speed multiplier — the VOD speed menu. */
export function tauriMpvSetSpeed(speed: number): Promise<void> {
  return invoke("mpv_set_speed", { speed });
}
export function tauriMpvGoLive(): Promise<void> {
  return invoke("mpv_go_live");
}
/** Settings → Playback's Audio Channels (mpv's word for it: "auto-safe",
 * "stereo", "5.1", "7.1") and Subtitle Size (mpv's `sub-scale`), to native,
 * which holds them for every player it makes and gives them to the ones
 * running (mpv.rs set_prefs). Rejects on a native build from before v0.11.29,
 * which has no such command: the caller takes that quietly. */
export function tauriMpvPrefs(audioChannels: string, subScale: number): Promise<void> {
  return invoke("mpv_prefs", { audioChannels, subScale });
}
/** Move the subtitle delay by `delta` seconds and get the delay it has now,
 * to a tenth. Per file: native writes it where mpv puts it back when the
 * file stops. Rejects on a build from before v0.11.29. */
export function tauriMpvSubDelay(delta: number): Promise<number> {
  return invoke("mpv_sub_delay", { delta });
}
/** The subtitle delay back to 0. Resolves with it. */
export function tauriMpvSubDelayReset(): Promise<number> {
  return invoke("mpv_sub_delay_reset");
}
export function tauriMpvTrack(kind: "audio" | "sub", id: string): Promise<void> {
  return invoke("mpv_track", { kind, id });
}
/** GPU frost on the whole picture (inverted path, modal open): DOM blur
 * can't sample the native video, so mpv blurs itself via a user shader. */
export function tauriMpvBlur(on: boolean): Promise<void> {
  return invoke("mpv_blur", { on });
}
/** Region frost: GPU-blur ONLY the video rectangle under a modal card —
 * live glass. Load/clear the shader once with `tauriMpvFrost` (resolves
 * FALSE when the running mpv can't do it — PARAM shaders need gpu-next —
 * so callers can downgrade the card to solid); move the rect with
 * `tauriMpvFrostRect` (pure uniform update, UI-rate safe). */
export function tauriMpvFrost(on: boolean): Promise<boolean> {
  return invoke("mpv_frost", { on });
}
export function tauriMpvFrostRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  return invoke("mpv_frost_rect", { x0, y0, x1, y1 });
}

/** One poll of the inverted player's status (replaces the overlay bridge's
 * loading/time/tracks pushes). `presenting` = mpv has put up a frame. */
export interface MpvStatus {
  pos: number | null;
  dur: number | null;
  presenting: boolean;
  /** Mid-play death: the stream reached EOF or mpv fell back to idle. */
  ended: boolean;
  /** mpv paused ITSELF to refill the cache (a seek outside it). Not
   * `loading` — see mpv_status. Optional: absent on older Rust builds. */
  buffering?: boolean;
  /** False only when mpv says the source cannot seek. Optional for the same
   * reason; absent reads as seekable. */
  seekable?: boolean;
  /** Buffered-but-unplayed seconds (`demuxer-cache-duration`). Grows by
   * exactly how far behind live you seek, and does NOT grow when mpv refuses
   * the seek, which is what makes it the live-edge correction. */
  cacheDur?: number | null;
  /** Live only: the seekable window's bounds, in the same timebase as `pos`.
   * mpv's `demuxer-cache-state.seekable-ranges`, outer bounds. Absent on VOD
   * (not read there) and on older Rust builds. */
  dvrStart?: number | null;
  dvrEnd?: number | null;
  /** Milliseconds since native last asked mpv for a file (mpv.rs play_wid,
   * reload_live), null when nothing is loaded. What tells an idle that
   * follows a load from the stale idle of the file before it: see ending.ts.
   * Optional: absent on a native build from before v0.11.33, which reads as
   * unknown. */
  sinceLoadMs?: number | null;
  audio: Array<{ id: number; label: string; lang: string; selected: boolean }>;
  subs: Array<{ id: number; label: string; lang: string; selected: boolean }>;
  /** File chapter markers (absent on pre-chapter Rust builds). */
  chapters?: Array<{ title: string; start: number }>;
}
/** What the address of the file that never opened answers (mpv_open_error):
 * the HTTP status and content type, or the kind of failure. Never the address
 * itself, which is a debrid link and holds the account's key. */
export interface OpenAnswer {
  status: number | null;
  /** `type/subtype` as the server sent it, lower case. */
  contentType: string | null;
  failure: "timeout" | "refused" | "dns" | "network" | null;
  /** The request carried the Jellyfin sign-in, as the player's did, so a 401
   * or 403 is the server refusing that sign-in. Absent when false (native
   * leaves it out), and from a build before the Jellyfin source. */
  signedInToJellyfin?: boolean;
}
/** One request for the first byte of the file the player last opened, to say
 * why it would not. Takes no address: native asks about the one it handed mpv.
 * Rejects when nothing is loaded, and on a native build from before v0.11.33,
 * which has no such command: the caller takes that quietly. */
export function tauriMpvOpenError(): Promise<OpenAnswer> {
  return invoke("mpv_open_error");
}
export async function tauriMpvStatus(): Promise<MpvStatus> {
  // Timed for the perf probe (playerPerf.ts): one Date.now() pair per 500ms
  // poll, so the JS-side round trip can be compared against the native
  // segment timings — the gap between them is IPC and scheduling.
  const t0 = Date.now();
  try {
    return JSON.parse(await invoke<string>("mpv_status")) as MpvStatus;
  } finally {
    notePoll(Date.now() - t0);
  }
}


/** Playback telemetry for the "stats for nerds" overlay. Every field is
 * best-effort — mpv omits any property a given stream/decoder doesn't expose,
 * so all are optional. Bitrates are bits/sec; `cache` is seconds; `videoW`/
 * `videoH` are the decoded picture size, `width`/`height` the output size. */
export interface MpvStats {
  videoCodec?: string;
  videoW?: number;
  videoH?: number;
  fps?: number;
  videoBitrate?: number;
  audioCodec?: string;
  audioBitrate?: number;
  /** The source's channel count (audio-params/channel-count). */
  audioChannels?: number;
  /** The layout written to the device, readable: "stereo", "5.1". */
  audioOut?: string;
  hwdec?: string;
  dropped?: number;
  cache?: number;
  width?: number;
  height?: number;
}
export async function tauriMpvStats(): Promise<MpvStats> {
  return JSON.parse(await invoke<string>("mpv_stats")) as MpvStats;
}

/** OS-window fullscreen (hides the title bar so the player fills the monitor). */
export function tauriSetFullscreen(on: boolean): Promise<void> {
  return noteCall("set_fullscreen", getCurrentWindow().setFullscreen(on));
}

/** Is the WINDOW fullscreen right now?
 *
 * The window is the truth and a component's own flag is not: F11 is handled
 * at app level and the window-state plugin restores fullscreen across
 * launches, so a screen that only remembers what it was told can be
 * fullscreen without knowing it. Ask before acting on it. */
export function tauriIsFullscreen(): Promise<boolean> {
  return noteCall("is_fullscreen", getCurrentWindow().isFullscreen());
}

/** The floating PiP window was closed by the user (✕ / taskbar / q) — the app
 * should bring the stream back into the in-app player. The payload is the
 * popout's final position in seconds (VOD resume); undefined when the
 * quitting mpv core couldn't report one. */
export function onPopoutClosed(cb: (pos?: number) => void): () => void {
  const un = listen<unknown>("popout-closed", (e) =>
    cb(typeof e.payload === "number" && e.payload > 0 ? e.payload : undefined),
  );
  return () => void un.then((f) => f());
}

/** Ask GitHub Releases (via tauri-plugin-updater) whether a newer signed
 * build exists. Resolves with its version string, or null when current. */
export function tauriCheckUpdate(): Promise<string | null> {
  return invoke("check_update");
}

/** An update that is waiting, with the words its release put on it. `notes`
 * is display text from an unsigned file: show it as text, never as HTML. "" for
 * none. */
export interface UpdateInfo {
  version: string;
  notes: string;
}

/** `tauriCheckUpdate` with the release's notes (Settings → App → Updates).
 *
 * Asks `check_update_info`. A native build from before v0.11.36 has no such
 * command and the call rejects, and so does a check that failed for real: the
 * answer then is `check_update`'s, notes-less, and a real failure rejects from
 * that one as it always did. An answer that isn't null or a version is taken
 * as the same "this native can't say" and asks the old command too. The
 * frontend ships apart from the native build, so both ends of this are live.
 *
 * `check_update` itself is unchanged: the header's chip uses it. */
export async function tauriCheckUpdateInfo(): Promise<UpdateInfo | null> {
  const got = await invoke<unknown>("check_update_info").catch(() => undefined);
  if (got === null) return null;
  if (got && typeof got === "object") {
    const { version, notes } = got as { version?: unknown; notes?: unknown };
    if (typeof version === "string" && version)
      return { version, notes: typeof notes === "string" ? notes : "" };
  }
  const version = await tauriCheckUpdate();
  return version ? { version, notes: "" } : null;
}

/** What this install is made of, for Settings → App → About: every field a
 * version string and every one optional, left out when native could not tell.
 * Never a path or a URL. Rejects on a native build from before v0.11.36. */
export interface AboutVersions {
  native?: string;
  mpv?: string;
  ffmpeg?: string;
  bundledFfmpeg?: string;
  vulkan?: string;
}
export function tauriAboutVersions(): Promise<AboutVersions> {
  return invoke("about_versions");
}

/** A warning or an error line for the log file (lib/appLog.ts, which scrubs it
 * and decides which lines go). Straight to Tauri and not through `invoke`
 * above: freezeProbe times every call of that one, and these are not worth a
 * place in what it reports. Rejects on a native build from before the log,
 * which has no such command; the caller takes that quietly. */
export function tauriAppLog(level: "warn" | "error", line: string): Promise<void> {
  return rawInvoke("app_log", { level, line });
}

/** The last `lines` lines of the log file, oldest first (Settings → App → Copy
 * Diagnostics). Lines only, never a path. Rejects on a native build from before
 * the log, and on an answer that is not a list; the caller copies without it. */
export async function tauriLogTail(lines: number): Promise<string[]> {
  const got = await invoke<unknown>("log_tail", { lines });
  if (!Array.isArray(got)) throw new Error("log_tail answered with something that is not a list");
  return got.filter((l): l is string => typeof l === "string");
}

/** Save `json` (a settings file's text) through the save dialog, starting on
 * `suggested` as its name (Settings → App → Export Settings). Straight to Tauri
 * and not through `invoke` above, as `tauriAppLog` is: freezeProbe would report
 * the seconds a person spends in a dialog as a slow call. Resolves with the
 * file name the person saved it as, never the folder, or null when they closed
 * the dialog. Rejects when the write failed, when `json` is over native's cap
 * (`too-big`), and on a native build from before it ("Command … not found").
 * Native refuses an empty `json` before any dialog opens. */
export async function tauriSettingsExport(json: string, suggested: string): Promise<string | null> {
  const got = await rawInvoke<unknown>("settings_export", { json, suggested });
  return typeof got === "string" && got ? got : null;
}

/** The text of a settings file the person picks (Settings → App → Import
 * Settings), or null when they closed the dialog. Rejects `too-big` for a file
 * over native's cap, `not-text` for one that is not UTF-8, and on a native
 * build from before it. */
export async function tauriSettingsImport(): Promise<string | null> {
  const got = await rawInvoke<unknown>("settings_import");
  return typeof got === "string" ? got : null;
}

let settingsFiles: Promise<boolean> | null = null;

/**
 * Whether this native build can save and open a settings file. Asked once, by
 * saving nothing: native refuses an empty file before a dialog could open, so
 * a build that has `settings_export` rejects with its refusal and one that
 * lacks it says "Command … not found". The frontend ships apart from the
 * native build, so the two ends of Export and Import are both live; the
 * buttons wait for the next app update on an older one.
 */
export function tauriHasSettingsFiles(): Promise<boolean> {
  settingsFiles ??= rawInvoke<unknown>("settings_export", { json: "", suggested: "" }).then(
    () => true,
    (e) => !/not found|unknown command/i.test(e instanceof Error ? e.message : String(e)),
  );
  return settingsFiles;
}

/** Download + install the pending update, then relaunch into it. On
 * success the app restarts and this never resolves; a rejection means the
 * download/install failed and the caller may retry. */
export function tauriInstallUpdate(): Promise<void> {
  return invoke("install_update");
}
