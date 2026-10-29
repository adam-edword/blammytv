mod about;
mod aiojf;
mod frontend;
mod jf;
mod logtail;
mod mal;
mod mpv;
mod mpvagent;
mod mpvcache;
mod mpvheader;
mod mpvopen;
mod mpvprefs;
mod mpvsubs;
mod mpvurl;
mod mpvvulkan;
mod mvaudio;
mod mvconvert;
mod mvproxy;
mod rec;
mod settingsfile;
mod trakt;
mod vlc;

#[cfg(windows)]
mod credman;
#[cfg(windows)]
mod inv;
#[cfg(windows)]
mod mvaudio_out;
#[cfg(windows)]
mod single;

use std::sync::OnceLock;

// App handle, so native code (the popout monitor thread) can notify the UI.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Notify the React app of a native-player event (today: `popout-closed`
/// from mpv.rs's popout monitor), so it can restore the in-app player.
pub fn emit_ui(event: &str) {
    if let Some(app) = APP.get() {
        use tauri::Emitter;
        let _ = app.emit(event, ());
    }
}

/// Like emit_ui but carrying a number (popout-closed's final position).
pub fn emit_ui_pos(event: &str, pos: f64) {
    if let Some(app) = APP.get() {
        use tauri::Emitter;
        let _ = app.emit(event, pos);
    }
}

/// Like emit_ui but carrying a record (vlc-progress's `{ pos, len, state }`).
pub fn emit_ui_json<S: serde::Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP.get() {
        use tauri::Emitter;
        let _ = app.emit(event, payload);
    }
}

// Current popout playback position (seconds) — used to reclaim it in-app.
#[tauri::command]
fn popout_pos() -> f64 {
    #[cfg(windows)]
    {
        mpv::popout_pos()
    }
    #[cfg(not(windows))]
    {
        0.0
    }
}

/// Pop a film or an episode out to VLC (plan 032). Ok once VLC has started;
/// the error is "vlc not installed" when there is none, or a short word on what
/// was refused, never the URL. From then on `vlc-progress` carries `{ pos, len,
/// state }` every few seconds, ending with state "gone". One VLC is followed at
/// a time: a second open stops following the first and leaves its window alone.
#[tauri::command]
async fn vlc_open(
    url: String,
    title: String,
    user_agent: Option<String>,
    start: Option<f64>,
) -> Result<(), String> {
    let started = vlc::launch(url, title, user_agent, start)?;
    tauri::async_runtime::spawn(vlc::follow(started, |p| {
        emit_ui_json("vlc-progress", p.clone())
    }));
    Ok(())
}

// Close the popout window (used by the "Bring it back" button).
#[tauri::command]
fn popout_stop() {
    #[cfg(windows)]
    {
        mpv::stop_popout();
    }
}

// Pop out: capture the position, tear the in-app player down (one provider
// connection at a time — starting the popout while the in-app stream still
// plays would hold two), then play in mpv's own floating window (PiP with
// mpv's OSC). The React side also unmounts the player driver; its inv_stop
// then lands on an already-closed player, which is a safe no-op.
#[tauri::command]
fn popout_open(
    window: tauri::WebviewWindow,
    url: String,
    // Whether this is a LIVE stream, per the app's own meta. Passed in
    // because no mpv property answers it reliably — see mpv_status's note on
    // a provider reporting a duration for a live feed. None means an older
    // frontend that did not say, and falls back to the duration heuristic.
    live: Option<bool>,
    // Settings → Playback → Pop-out: how much of the screen it takes
    // ("small", "medium", "large") and which corner it opens in ("center",
    // "top-left" and the rest). Both Option, as `live` is: a frontend from
    // before the setting sends neither and gets half the screen, centred, and
    // anything unknown is the same. The strings are mpvprefs'.
    size: Option<String>,
    corner: Option<String>,
    // The playlist's own User-Agent for this stream, if it has one (Settings →
    // Sources → Advanced). Option, so a frontend from before it sends none and
    // plays as it did; one this build does not understand is refused (mpvagent).
    user_agent: Option<String>,
) -> Result<(), String> {
    // Native says what mpv may open, not only the frontend (audit X1).
    mpvurl::http_only(&url)?;
    let agent = mpvagent::clean(user_agent)?;
    let hand;
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                // Read everything the popout needs BEFORE teardown: position,
                // volume, mute. See mpv::Handoff.
                let h = mpv::Handoff::capture(live);
                inv::close();
                let _ = tx.send(h);
            })
            .map_err(|e| e.to_string())?;
        hand = rx.recv().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        hand = mpv::Handoff::default();
        let _ = (&window, live);
    }
    // Own mpv instance so the in-app teardown (fired by the React unmount)
    // can't terminate it.
    mpv::play_popout(
        &url,
        hand,
        size.as_deref(),
        corner.as_deref(),
        agent.as_deref(),
        live,
    )
}

// ---- Inverted-layer player (THE architecture; see inv.rs). Rects are PHYSICAL px. ----

// Flat on purpose: these names ARE the IPC payload, and the frontend ships
// apart from this binary (two-tier updates), so bundling them into a struct
// would break every build on the other side of a mismatch.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn inv_open(
    window: tauri::WebviewWindow,
    url: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    // VOD resume point in seconds, applied by mpv as it opens the file.
    start: Option<f64>,
    // A live channel, per the app's own meta (popout_open's flag). Live
    // opens with subtitles off. None means an older frontend that did not
    // say, which keeps mpv's own choice.
    live: Option<bool>,
    // The playlist's own User-Agent for this stream, if it has one. None is
    // mpv's own, and the player puts that back for a stream after another's.
    user_agent: Option<String>,
) -> Result<(), String> {
    // Native says what mpv may open, not only the frontend (audit X1).
    mpvurl::http_only(&url)?;
    let agent = mpvagent::clean(user_agent)?;
    open_in_player(window, url, x, y, w, h, start, live, agent)
}

/// Load `url` in the in-app player, at the rect the page gave. Past the
/// checks: `inv_open` makes them for a stream, and `rec_play` is for a file
/// out of the recordings index. Nothing else calls this.
#[allow(clippy::too_many_arguments)]
fn open_in_player(
    window: tauri::WebviewWindow,
    url: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    start: Option<f64>,
    live: Option<bool>,
    agent: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(inv::open(
                    hwnd,
                    x,
                    y,
                    w,
                    h,
                    &url,
                    start,
                    live,
                    agent.as_deref(),
                ));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, x, y, w, h, start, live, agent);
        Ok(())
    }
}

#[tauri::command]
fn inv_set_rect(window: tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        window
            .run_on_main_thread(move || inv::set_rect(x, y, w, h))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, x, y, w, h);
        Ok(())
    }
}

#[tauri::command]
fn inv_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                inv::close();
                let _ = tx.send(());
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(())
    }
}

// ---- Direct mpv control for the inverted player's in-tree chrome (the
// overlay webview's postMessage bridge doesn't exist on this path — these
// are its verbs as plain commands). mpv calls are mutex-guarded and safe
// off the UI thread. ----

#[tauri::command]
fn mpv_pause(paused: bool) {
    mpv::set_pause(paused);
}

#[tauri::command]
fn mpv_mute(muted: bool) {
    mpv::set_mute(muted);
}

#[tauri::command]
fn mpv_volume(vol: i64) {
    mpv::set_volume(vol);
}

#[tauri::command]
fn mpv_seek(delta: f64) {
    mpv::seek(delta);
}

/// Absolute seek in seconds — the VOD scrubber's verb.
#[tauri::command]
fn mpv_seek_abs(pos: f64) {
    mpv::seek_abs(pos);
}

/// Playback speed multiplier — the VOD speed menu.
#[tauri::command]
fn mpv_set_speed(speed: f64) {
    mpv::set_speed(speed);
}

#[tauri::command]
fn mpv_go_live() {
    mpv::reload_live();
}

/// Settings → Playback's Audio Channels and Subtitle Size, for the in-app
/// player and the pop-out, now and for every one made after (mpv.rs
/// `set_prefs`). Its own command, not `mpv_set`: that one is a tuning probe
/// with an allowlist (plan 016 N5), and what a setting may ask is checked in
/// mpvprefs. Both are Option, so a call may carry one; a value that is not
/// one of Settings' refuses the whole call and changes nothing.
///
/// New in v0.11.29, and the frontend ships apart from this binary: an older
/// build has no such command, and the frontend takes the rejection quietly.
/// Changing `audio_channels` on a playing stream restarts its audio output,
/// a short gap, as mpv does for the option anywhere.
#[tauri::command]
fn mpv_prefs(audio_channels: Option<String>, sub_scale: Option<f64>) -> Result<(), String> {
    let audio = audio_channels
        .as_deref()
        .map(|v| mpvprefs::audio_channels(v).ok_or("not an audio layout the app offers"))
        .transpose()?;
    let scale = sub_scale
        .map(|v| mpvprefs::sub_scale(v).ok_or("not a subtitle size"))
        .transpose()?;
    mpv::set_prefs(audio, scale);
    Ok(())
}

/// Move the subtitle delay by `delta` seconds (the player's z and x keys) and
/// return what it is now, to a tenth. Per file: see mpv.rs `sub_delay`.
/// Nothing in this binary reads or keeps the delay.
#[tauri::command]
fn mpv_sub_delay(delta: f64) -> f64 {
    mpv::sub_delay(delta)
}

/// The subtitle delay back to 0, which `mpv_sub_delay` cannot always say: it
/// moves by one step at most and the delay can be further out than that.
#[tauri::command]
fn mpv_sub_delay_reset() -> f64 {
    mpv::sub_delay_reset()
}

#[tauri::command]
fn mpv_track(kind: String, id: String) {
    mpv::set_track(&kind, &id);
}

/// DIAGNOSTIC: set one mpv property and hand back what it reads as after.
///
/// Exists so an option can be A/B'd against a real stream on a real machine
/// without a Rust rebuild. Every tuning suggestion for this player is a
/// PREDICTION until someone tries it on their own connection and hardware,
/// and the rebuild between each attempt is what stops that happening: the
/// numbers that matter (time to first frame, whether a seek refetches, what
/// a live TS stream does with a bigger cache) cannot be got from a
/// developer's container at all.
///
/// This is `mpv_set_property_string`, NOT the command interface. It cannot
/// load a file, run a script or spawn anything; it can only assign to a
/// named property, which is the same surface `mpv_track` and `mpv_set_speed`
/// already use with fixed keys. The read-back is the point: mpv silently
/// ignores an unknown or unwritable property, so returning the value it
/// actually holds is the difference between "I set it" and "it took".
#[tauri::command]
fn mpv_set(key: String, value: String) -> String {
    if !(cfg!(debug_assertions) || tunable(&key)) {
        return "<refused: not a tuning option in a release build>".into();
    }
    mpv::set_prop_pub(&key, &value);
    mpv::get_prop_pub(&key).unwrap_or_else(|| "<unset>".into())
}

/// What `mpv_set` may touch in a release build (plan 016 N5, finding F15).
///
/// It is a tuning probe (`mpvSet()` in the console), so a release build
/// keeps the families tuning is about: the cache and demuxer, the network,
/// decoding, frame timing and the renderer. Not a property that names a
/// file or a directory, loads a script or a shader, or writes a log or a
/// recording: mpv has several (`log-file`, `stream-record`, `cache-dir`,
/// `scripts`), and a page that could reach this command would otherwise
/// reach them. A dev build (debug) keeps the whole of mpv, as before.
fn tunable(key: &str) -> bool {
    const FAMILIES: &[&str] = &[
        "cache",
        "demuxer",
        "network-timeout",
        "stream-buffer-size",
        "hwdec",
        "vd-lavc",
        "video-sync",
        "interpolation",
        "framedrop",
        "hr-seek",
        "audio-buffer",
        "untimed",
        "video-latency-hacks",
        "gpu-",
        "d3d11",
        "tone-mapping",
        "target-",
        "hdr-",
        "deband",
        "scale",
        "dscale",
        "cscale",
    ];
    const NEVER: &[&str] = &[
        "dir",
        "file",
        "path",
        "script",
        "conf",
        "include",
        "log",
        "record",
        "dump",
        "screenshot",
        "shader",
        // libav passthroughs: `demuxer-lavf-o`, `vd-lavc-o` and their kin
        // take arbitrary FFmpeg options (a protocol whitelist, a proxy),
        // and `demuxer-lavf-format` forces a demuxer.
        "lavf-format",
        // A colour lookup table read from a file (`target-lut`).
        "lut",
    ];
    FAMILIES.iter().any(|f| key.starts_with(f))
        && !key.ends_with("-o")
        && !NEVER.iter().any(|n| key.contains(n))
}

/// DIAGNOSTIC: read one mpv property. The other half of `mpv_set`, and
/// useful alone for asking what a default actually is on this machine
/// rather than what the manual says it is.
#[tauri::command]
fn mpv_get(key: String) -> String {
    mpv::get_prop_pub(&key).unwrap_or_else(|| "<unset>".into())
}

/// GPU frost for the whole picture while a modal covers the inverted
/// player: DOM backdrop-filter can NEVER sample the native video (separate
/// window), so we blur at the source — mpv runs a downsample+gaussian user
/// shader while the modal is open. The shader ships in the binary and is
/// written to a temp file on first use (mpv wants a path).
const FROST_SHADER: &str = include_str!("frost.glsl");

#[tauri::command]
fn mpv_blur(on: bool) -> Result<(), String> {
    if !on {
        mpv::set_glsl_shaders("");
        return Ok(());
    }
    let path = std::env::temp_dir().join("blammytv-frost.glsl");
    std::fs::write(&path, FROST_SHADER).map_err(|e| e.to_string())?;
    mpv::set_glsl_shaders(path.to_string_lossy().as_ref());
    Ok(())
}

/// Region frost: blur ONLY the rectangle under a modal card, every frame,
/// on the GPU — live glass over a still-playing picture. The rect lives in
/// //!PARAM uniforms (video-normalized 0..1), so the shader loads ONCE and
/// geometry changes are just `glsl-shader-opts` property sets — no file
/// rewrites, no chain reloads, no hiccups. Defaults are a degenerate rect
/// (x0>x1) = frost disabled until the frontend pushes a real one.
/// Requires gpu-next for PARAM (default vo on Adam's mpv 0.41-dev).
const FROST_REGION_SHADER: &str = r#"//!PARAM frost_x0
//!TYPE float
//!MINIMUM 0.0
//!MAXIMUM 1.0
1.0

//!PARAM frost_y0
//!TYPE float
//!MINIMUM 0.0
//!MAXIMUM 1.0
1.0

//!PARAM frost_x1
//!TYPE float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM frost_y1
//!TYPE float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!HOOK MAIN
//!BIND HOOKED
//!SAVE FROST
//!WIDTH HOOKED.w 8 /
//!HEIGHT HOOKED.h 8 /
//!DESC frost region: low-res base
vec4 hook() {
    return HOOKED_texOff(vec2(0.0));
}

//!HOOK MAIN
//!BIND HOOKED
//!BIND FROST
//!DESC frost region: composite
vec4 hook() {
    vec2 uv = HOOKED_pos;
    if (uv.x < frost_x0 || uv.x > frost_x1 || uv.y < frost_y0 || uv.y > frost_y1)
        return HOOKED_texOff(vec2(0.0));
    vec2 px = FROST_pt;
    vec4 c = vec4(0.0);
    float wsum = 0.0;
    for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
            float w = 1.0 / (1.0 + float(i * i + j * j));
            c += FROST_tex(uv + vec2(float(i), float(j)) * px) * w;
            wsum += w;
        }
    }
    return c / wsum;
}
"#;

// Returns whether frost is actually available: //!PARAM shaders need the
// gpu-next vo. On anything else (older bundled mpv, overridden vo) we
// leave the picture untouched and the frontend downgrades the settings
// card to a solid background instead of unreadable glass.
#[tauri::command]
fn mpv_frost(on: bool) -> Result<bool, String> {
    if !on {
        mpv::set_glsl_shaders("");
        return Ok(true);
    }
    let vo = mpv::get_property("current-vo").unwrap_or_default();
    log::info!("[mpv] frost requested, vo={vo}");
    if vo != "gpu-next" {
        return Ok(false);
    }
    let path = std::env::temp_dir().join("blammytv-frost-region.glsl");
    std::fs::write(&path, FROST_REGION_SHADER).map_err(|e| e.to_string())?;
    mpv::set_glsl_shaders(path.to_string_lossy().as_ref());
    Ok(true)
}

// Move the frost rect (video-normalized). Pure uniform update — safe to
// call at UI rates (resize drags, tab-switch reflows).
#[tauri::command]
fn mpv_frost_rect(x0: f64, y0: f64, x1: f64, y1: f64) {
    mpv::set_shader_opts(&format!(
        "frost_x0={x0:.4},frost_y0={y0:.4},frost_x1={x1:.4},frost_y1={y1:.4}"
    ));
}

/// Player status snapshot for the inverted chrome's poll (replaced the old
/// overlay webview's loader/time/tracks push threads): position/duration,
/// whether mpv is
/// actually presenting (core-idle == "no" ⇒ first frame has landed), and the
/// audio/sub track lists.
/// RAW property snapshot for diagnosing tune failures. Deliberately separate
/// from mpv_status: that runs every 500ms and each property is an FFI call, so
/// this is only ever invoked on the rare paths (first presented frame, and the
/// watchdog's escalation) where the answer is worth the cost.
///
/// It exists to settle four questions the code cannot answer by inspection:
///   - is `path` still set when a stream dies? `reload_live()` early-returns
///     without it, which would make the live watchdog's "reconnecting" pass
///     and the dead card's Retry silent no-ops.
///   - does a death arrive as `idle-active` or `eof-reached`? (Same question,
///     other side: idle means the file unloaded and `path` is gone.)
///   - do real sources report `duration`? The completion-vs-death guard leans
///     on the clock existing.
///   - do `aid`/`sid`/`speed` survive a same-url reload? Nothing re-applies
///     them, and `speed` has no reconcile channel at all.
/// `current-vo` rides along for the frost question (it reads as unset before
/// the first frame, which permanently downgrades the Settings glass).
#[tauri::command]
fn mpv_diag() -> String {
    let p = |k: &str| mpv::get_property(k).unwrap_or_else(|| "<none>".into());
    serde_json::json!({
        // NOT the path itself. It is the live stream URL, which carries
        // the user's credentials in it (Xtream puts them in the path,
        // Stalker a play token), and this whole object is console.info'd on
        // every successful tune, which is exactly what ends up pasted into
        // a bug report. The only question asked of it is whether reload_live
        // has anything to reload.
        "has-path": p("path") != "<none>",
        "core-idle": p("core-idle"),
        "idle-active": p("idle-active"),
        "eof-reached": p("eof-reached"),
        "pause": p("pause"),
        "time-pos": p("time-pos"),
        "duration": p("duration"),
        "speed": p("speed"),
        "aid": p("aid"),
        "sid": p("sid"),
        "current-vo": p("current-vo"),
        // PER-FILE, which `current-vo` is not: `force-window=yes` means the
        // VO is up from launch and stays up between files, so it can only
        // ever say "the app has a window". `dwidth` is unavailable until the
        // VO has been configured for THIS video, so it is the one that
        // answers "has the decoder and output finished coming up".
        "dwidth": p("dwidth"),
        // What hwdec ACTUALLY resolved to, which is not what was asked for:
        // `auto-safe` is a request and mpv answers "no" when it declines. The
        // difference is the whole of "why is this stream pegging a core".
        "hwdec-current": p("hwdec-current"),
        "file-format": p("file-format"),
        "demuxer-cache-time": p("demuxer-cache-time"),
        "track-list/count": p("track-list/count"),
    })
    .to_string()
}

#[tauri::command]
fn mpv_status() -> String {
    // Timed in three segments (plan 011): the five scalars the poll actually
    // needs every tick, then the track list, then the chapter list — the two
    // that are STATIC for a loaded file and re-read twice a second anyway.
    // Splitting it here is the whole point: a single total can't tell us
    // whether caching the static halves is worth doing.
    let t_start = std::time::Instant::now();
    let pos = mpv::get_property("time-pos").and_then(|s| s.parse::<f64>().ok());
    let dur = mpv::get_property("duration").and_then(|s| s.parse::<f64>().ok());
    let presenting = mpv::get_property("core-idle").as_deref() == Some("no");
    // Mid-play death signal: a live stream that dies makes mpv reach EOF and
    // fall back to idle (no file loaded). Either means the picture is gone
    // even though we WERE presenting — the frontend watchdog re-arms on it.
    let ended = mpv::get_property("eof-reached").as_deref() == Some("yes")
        || mpv::get_property("idle-active").as_deref() == Some("yes");
    // BUFFERING, which is not the same thing as loading and must never be
    // fed into it. After a seek outside the demuxer cache mpv pauses itself
    // to refill (`--cache-pause`, on by default). core-idle goes "yes", but
    // the poll only consults `presenting` while it already believes it is
    // loading, and `ended` needs eof or idle — neither fires. So the picture
    // froze on the last decoded frame with no spinner and no explanation,
    // for however long the range request took, which on debrid is seconds.
    // Kept a SEPARATE signal on purpose: routed into `loading` it would arm
    // the tune watchdog on every buffering seek and burn VOD auto-failover.
    let buffering = mpv::get_property("paused-for-cache").as_deref() == Some("yes");
    // Can this source seek AT ALL. An HTTP origin with no range support
    // makes mpv refuse silently, so the scrubber was a control you could
    // drag that did nothing, forever, with no way to find out. Absent (no
    // file loaded yet) reads as seekable: the honest default while tuning is
    // to offer the control, not to grey it out and un-grey it a second later.
    let seekable = mpv::get_property("seekable").as_deref() != Some("no");
    // HOW FAR BEHIND LIVE, indirectly and reliably.
    //
    // This equals `demuxer-cache-time - time-pos`, i.e. buffered-but-unplayed
    // seconds. At the live edge it sits at whatever the provider pushes ahead
    // and stays there, because playback and demuxing advance together. Seek
    // back ten seconds and it grows by ten. Measured on a real channel:
    // 16.544 at the edge, 28.992 after seeking back, against a cache-time
    // that advanced 5.792 and a time-pos that went back 6.656. 5.792 + 6.656
    // = 12.448, and 28.992 - 16.544 = 12.448 exactly.
    //
    // The point is what happens when mpv REFUSES a seek: it does not grow.
    // The live-edge indicator used to dead-reckon at 0.8%/sec of requested
    // seek and never ask mpv anything, so pressing Back 10s at the start of
    // the buffer walked the bar somewhere the stream could not go and left
    // it there until Jump to live. mpv's own seekable-start/-end would be
    // the direct answer but do not resolve as slash paths on the shipped
    // libmpv (verified), and this needs no left edge to be correct.
    let cache_dur = mpv::get_property("demuxer-cache-duration").and_then(|s| s.parse::<f64>().ok());
    // THE DVR WINDOW, from mpv's own answer rather than inferred.
    //
    // NOT gated on `duration` being absent. That gate was here to spare VOD
    // the one non-scalar read in this poll, and it was built on the
    // assumption that a live stream has no duration. Measured on a real IPTV
    // channel, that assumption is false: the provider reports
    // `duration = 24.745` on a live feed, which is not a duration at all but
    // the length of the currently buffered window (`cache-end` read 24.726 in
    // the same breath). So the gate never fired, the window was never sent,
    // and the live rail silently fell back to an estimate.
    //
    // There is no property here that reliably separates live from VOD. The
    // app's own `meta.live` is the only trustworthy answer and it lives in
    // the frontend, so the split is made there. This just reports what mpv
    // knows and lets the caller decide.
    //
    // `seekable-ranges` is an ARRAY of {start,end}. FOLD over all of it, not
    // first().start / last().end: mpv emits the array in reverse (command.c
    // walks `num_seek_ranges - 1` down to 0) and the underlying list is
    // LRU-ordered, not time-ordered — `set_current_range` moves the active
    // range to the end on every switch, and mpv itself qsorts by time
    // whenever it actually needs time order, which is the proof that the raw
    // order is not it. With two ranges the naive read took the start of the
    // NEWEST and the end of the OLDEST and inverted them.
    let cache_state = mpv::get_property("demuxer-cache-state");
    // The disk cache's brake (mpv.rs guard_cache), on the reading it needs.
    mpv::guard_cache(cache_state.as_deref());
    let dvr = cache_state
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            let ranges = v.get("seekable-ranges")?.as_array()?;
            let mut lo = f64::INFINITY;
            let mut hi = f64::NEG_INFINITY;
            for r in ranges {
                if let (Some(a), Some(b)) = (
                    r.get("start").and_then(|v| v.as_f64()),
                    r.get("end").and_then(|v| v.as_f64()),
                ) {
                    lo = lo.min(a);
                    hi = hi.max(b);
                }
            }
            if lo.is_finite() && hi.is_finite() {
                Some((lo, hi))
            } else {
                None
            }
        });
    let t_scalars = t_start.elapsed();
    let t_tracks_start = std::time::Instant::now();
    let tracks = mpv::track_list();
    let t_tracks = t_tracks_start.elapsed();
    let mut audio = Vec::new();
    let mut subs = Vec::new();
    for t in tracks {
        let label = if !t.title.is_empty() {
            t.title.clone()
        } else if !t.lang.is_empty() {
            t.lang.clone()
        } else {
            format!("Track {}", t.id)
        };
        let entry = serde_json::json!({
            "id": t.id, "label": label, "lang": t.lang, "selected": t.selected,
        });
        match t.kind.as_str() {
            "audio" => audio.push(entry),
            "sub" => subs.push(entry),
            _ => {}
        }
    }
    let t_chapters_start = std::time::Instant::now();
    let raw_chapters = mpv::chapter_list();
    let t_chapters = t_chapters_start.elapsed();
    let chapters: Vec<serde_json::Value> = raw_chapters
        .into_iter()
        .map(|c| serde_json::json!({ "title": c.title, "start": c.start }))
        .collect();
    mpv::perf_record(
        t_scalars.as_micros() as u64,
        t_tracks.as_micros() as u64,
        t_chapters.as_micros() as u64,
        t_start.elapsed().as_micros() as u64,
    );
    serde_json::json!({
        "pos": pos, "dur": dur, "presenting": presenting, "ended": ended,
        "buffering": buffering, "seekable": seekable, "cacheDur": cache_dur,
        "dvrStart": dvr.map(|d| d.0), "dvrEnd": dvr.map(|d| d.1),
        // HOW LONG AGO the in-app player was asked for its file, or null when
        // nothing is loaded. `ended` alone cannot say whether an idle came
        // AFTER the load (a link that failed to open: mpv gives up within
        // ~50ms and stays idle) or BEFORE it (the file before this one, idle
        // until `loadfile` lands). Only native knows when that was, and the
        // frontend reads an idle as a failed open only well after it
        // (ending.ts). New in v0.11.33, and the frontend ships apart from
        // this binary: a build without the field reads as before.
        "sinceLoadMs": mpv::since_load_ms(),
        "audio": audio, "subs": subs, "chapters": chapters,
    })
    .to_string()
}

/// What the address of the file that never opened answers: one request for
/// its first byte, and the HTTP status and content type, or the kind of
/// failure ("timeout", "refused", "dns", "network"). The address is the one
/// `play_wid` last handed mpv and nothing else: this takes no argument, so the
/// page cannot aim it. The answer carries no part of the address, and it is
/// printed here by status alone, because a debrid link holds the account's key.
///
/// Sent through the app's shared client, so the request goes out over the same
/// TLS stack as every other one (see its comment). Rejects when nothing is
/// loaded, and on a build from before v0.11.33, which has no such command: the
/// page takes either quietly.
#[tauri::command]
async fn mpv_open_error() -> Result<mpvopen::Answer, String> {
    let url = mpv::loaded_url().ok_or("nothing was opened")?;
    // Native says what it may open, here as at every other door (audit X1).
    mpvurl::http_only(&url)?;
    // With the agent the file was opened with: a provider that refuses the
    // wrong one refuses it here as it did for mpv.
    let agent = mpv::loaded_agent();
    // And with the Jellyfin sign-in, when that is what mpv was given for it:
    // without it a stream that wants the token answers 401 whatever happened.
    let authorization = jf_client_started().and_then(|c| c.authorization_for(&url));
    let answer = mpvopen::probe_signed(
        http_client(),
        &url,
        mpvopen::PROBE_WAIT,
        agent.as_deref(),
        authorization.as_deref(),
    )
    .await;
    log::info!(
        "[mpv-open] {}",
        match (answer.status, answer.failure) {
            (Some(code), _) => format!("answered {code}"),
            (None, Some(kind)) => format!("no answer ({kind})"),
            (None, None) => "no answer".to_string(),
        }
    );
    Ok(answer)
}

/// Status-poll cost report (plan 011). Reads the accumulator mpv_status fills
/// on every tick, alongside mpv's own drop counters — so one report answers
/// both halves of "is the player janky": how much UI-thread time the poll
/// burns, and whether the video pipeline is actually dropping frames. If
/// drops are zero while poll time is high, the stutter is ours, not mpv's.
#[tauri::command]
fn mpv_perf(reset: bool) -> String {
    let p = mpv::perf_snapshot(reset);
    let n = p.calls.max(1);
    let num = |k: &str| {
        mpv::get_property(k)
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(-1.0)
    };
    serde_json::json!({
        "calls": p.calls,
        "propReads": p.props,
        "avgUs": p.total_us / n,
        "maxUs": p.max_us,
        "scalarsUs": p.scalars_us / n,
        "tracksUs": p.tracks_us / n,
        "chaptersUs": p.chapters_us / n,
        "over16ms": p.over_16ms,
        // mpv's own view: are frames actually being lost?
        "frameDrops": num("frame-drop-count"),
        "voDelayed": num("vo-delayed-frame-count"),
        "fps": num("estimated-vf-fps"),
        "hwdec": mpv::get_property("hwdec-current").unwrap_or_default(),
    })
    .to_string()
}

/// Playback telemetry for the inverted chrome's "stats for nerds" overlay.
/// Every field is best-effort: mpv returns nothing for a property a given
/// stream/decoder doesn't expose, and we simply omit that key from the JSON.
/// Numbers are parsed where sensible (dimensions, fps, bitrates in bits/s,
/// cache seconds, dropped-frame count); codecs and hwdec stay strings. fps
/// prefers the container rate, falling back to mpv's estimate; dropped frames
/// prefer the total, falling back to the decoder count.
#[tauri::command]
fn mpv_stats() -> String {
    use serde_json::{Map, Number, Value};

    fn get_num(prop: &str) -> Option<f64> {
        mpv::get_property(prop).and_then(|s| s.parse::<f64>().ok())
    }
    fn put_str(m: &mut Map<String, Value>, key: &str, prop: &str) {
        if let Some(v) = mpv::get_property(prop) {
            m.insert(key.to_string(), Value::String(v));
        }
    }
    fn put_num(m: &mut Map<String, Value>, key: &str, val: Option<f64>) {
        if let Some(n) = val.and_then(Number::from_f64) {
            m.insert(key.to_string(), Value::Number(n));
        }
    }

    let mut m = Map::new();
    put_str(&mut m, "videoCodec", "video-codec");
    put_num(&mut m, "videoW", get_num("video-params/w"));
    put_num(&mut m, "videoH", get_num("video-params/h"));
    put_num(
        &mut m,
        "fps",
        get_num("container-fps").or_else(|| get_num("estimated-vf-fps")),
    );
    put_num(&mut m, "videoBitrate", get_num("video-bitrate"));
    put_str(&mut m, "audioCodec", "audio-codec");
    put_num(&mut m, "audioBitrate", get_num("audio-bitrate"));
    // What the source carries, and what reached the device: "6" against
    // "5.1" is surround playing as surround, against "stereo" a downmix.
    put_num(&mut m, "audioChannels", get_num("audio-params/channel-count"));
    put_str(&mut m, "audioOut", "audio-out-params/hr-channels");
    put_str(&mut m, "hwdec", "hwdec-current");
    put_num(
        &mut m,
        "dropped",
        get_num("frame-drop-count").or_else(|| get_num("decoder-frame-drop-count")),
    );
    put_num(&mut m, "cache", get_num("demuxer-cache-duration"));
    put_num(&mut m, "width", get_num("width"));
    put_num(&mut m, "height", get_num("height"));
    Value::Object(m).to_string()
}

/// Cross-platform HTTP GET returning the response body as text. Lets the app
/// reach AIOStreams / Xtream from the Rust side, so the webview isn't blocked by
/// browser CORS — the foundation for running self-contained, with no backend.
/// One process-wide HTTP client so back-to-back fetches (categories, streams,
/// the big xmltv) reuse the connection pool + TLS session instead of redoing a
/// TCP+TLS handshake every call. Built once, lazily.
pub(crate) fn http_client() -> &'static reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            // Present as a browser: many AIOStreams/addon hosts (esp. behind
            // Cloudflare/WAFs) reject requests without a normal User-Agent with 403.
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            )
            // Transparent response compression. xmltv.php returns ~20:1-compressible
            // XML; without this we pulled the whole guide raw (tens of MB), which
            // dominated load time. reqwest adds Accept-Encoding and decodes for us.
            .gzip(true)
            .brotli(true)
            .deflate(true)
            // Match the known-good curl request: HTTP/1.1 over the Windows Schannel
            // TLS stack, so the connection fingerprint isn't flagged as a bot.
            .http1_only()
            .build()
            .expect("failed to build the shared HTTP client")
    })
}

/// The most `http_get` holds of one body, counted after the transparent
/// decompression: over five times the largest real one (the xmltv guide,
/// ~95MB decoded). Past it a broken or hostile server, or a compression
/// bomb, would stream gigabytes into memory (audit NA4).
const HTTP_GET_MAX_BODY: usize = 512 * 1024 * 1024;

/// The error for a body past `cap`. It names the cap and never the URL,
/// which can carry a credential.
fn body_over_cap(cap: usize) -> String {
    format!("response is over the {} MiB limit", cap >> 20)
}

/// A response that declares more than `cap` fails before a byte is read.
fn check_declared_len(declared: Option<u64>, cap: usize) -> Result<(), String> {
    match declared {
        Some(n) if n > cap as u64 => Err(body_over_cap(cap)),
        _ => Ok(()),
    }
}

/// How much to reserve before reading: what the response declares, up to
/// `cap`. A compressed response declares nothing (reqwest drops the length
/// when it decodes), so that one grows as it reads.
fn body_capacity(declared: Option<u64>, cap: usize) -> usize {
    declared.map_or(0, |n| n.min(cap as u64) as usize)
}

/// Add one chunk to the body, failing on the chunk that takes the total past
/// `cap`. A body of exactly `cap` is fine.
fn append_capped(body: &mut Vec<u8>, chunk: &[u8], cap: usize) -> Result<(), String> {
    if body.len().saturating_add(chunk.len()) > cap {
        return Err(body_over_cap(cap));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

/// Returns the body as RAW BYTES (`tauri::ipc::Response`), not a String: a
/// String return rides the JSON IPC path, and JSON-escaping a ~95MB xmltv
/// document (every quote/newline) plus re-parsing it webview-side measurably
/// dominated load time. The raw path hands the buffer over untouched; the
/// frontend TextDecoder-decodes it in ~100ms.
///
/// The body is read chunk by chunk and stops at `HTTP_GET_MAX_BODY` (512 MiB);
/// a declared Content-Length over it fails before any is read.
///
/// `timeout_secs` (optional) overrides the client's 30s default for one
/// request — the full xmltv guide is tens of MB and legitimately exceeds
/// 30s on slower links, which read as "EPG always empty" for those users.
///
/// `headers` (optional) is for header-authenticated providers — Stalker/MAG
/// portals need per-request `Cookie` (the MAC), `Authorization: Bearer`, and
/// a MAG `User-Agent`. Merge semantics, verified against the locked reqwest
/// 0.12.28 source: `.headers(map)` REPLACES same-named request headers
/// (util::replace_headers), and client defaults (our Chrome UA) only fill
/// header slots the request left vacant (execute_request) — so caller
/// headers always win, and the Xtream/AIOStreams callers that pass nothing
/// are untouched. NEVER log header values: Cookie carries the MAC and
/// Authorization the session token.
#[tauri::command]
async fn http_get(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    timeout_secs: Option<u64>,
) -> Result<tauri::ipc::Response, String> {
    // Load-time diagnostics, printed to the `tauri dev` terminal (devtools
    // close on channel load, the terminal doesn't). Headers-vs-body split
    // separates connect/TTFB from download+decode; the frontend's own [live]
    // timer wraps this whole invoke, so (frontend − total here) = IPC-bridge
    // cost of hauling the decoded string into the webview. ONLY the origin
    // is logged: AIOStreams embeds the user's config (a credential) in the
    // PATH, not just the query string. The origin of the PARSED URL, so
    // `user:pass@` in front of the host goes too (audit X2); a URL that does
    // not parse prints a placeholder, never a piece of itself.
    let short = mvproxy::origin_of(&url);
    let t0 = std::time::Instant::now();
    let mut req = http_client()
        .get(&url)
        // Send the headers a browser would. Some hosts (Cloudflare's Browser
        // Integrity Check) 403 requests that have a User-Agent but lack these.
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/plain, */*",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9");
    if let Some(h) = headers {
        // Applied LAST via .headers(), which replaces same-named entries —
        // a caller's Accept/User-Agent overrides the browser defaults above.
        let mut map = reqwest::header::HeaderMap::new();
        for (k, v) in &h {
            // Errors echo the header NAME only — values may hold credentials.
            let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|_| format!("bad header name: {k}"))?;
            let val = reqwest::header::HeaderValue::from_str(v)
                .map_err(|_| format!("bad value for header: {k}"))?;
            map.insert(name, val);
        }
        req = req.headers(map);
    }
    if let Some(secs) = timeout_secs {
        req = req.timeout(std::time::Duration::from_secs(secs));
    }
    let mut res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let t_headers = t0.elapsed().as_millis();
    // Some(len) = the raw Content-Length reqwest saw. When the server
    // compressed the response, reqwest strips it during transparent decode,
    // so None here ≈ "compression was applied".
    let clen = res.content_length();
    check_declared_len(clen, HTTP_GET_MAX_BODY)?;
    let mut body: Vec<u8> = Vec::with_capacity(body_capacity(clen, HTTP_GET_MAX_BODY));
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        append_capped(&mut body, &chunk, HTTP_GET_MAX_BODY)?;
    }
    // Every request had a line, and the log file (a release build's only
    // record) was mostly these: Copy Diagnostics' last 200 lines were an
    // hour of score polls. The ones a support question is about stay in it:
    // a download of a megabyte or more (a guide, a playlist) or one that took
    // three seconds. The rest are debug, which a dev run still prints
    // (lib.rs `log_plugin`).
    let total = t0.elapsed().as_millis();
    let level = if body.len() >= 1_000_000 || total >= 3_000 {
        log::Level::Info
    } else {
        log::Level::Debug
    };
    log::log!(
        level,
        "[http] {} — headers {}ms, total {}ms, body {:.1}MB (content-length: {})",
        short,
        t_headers,
        total,
        body.len() as f64 / 1e6,
        match clen {
            Some(n) => format!("{:.1}MB on the wire → NOT compressed", n as f64 / 1e6),
            None => "absent (compressed, or chunked)".to_string(),
        },
    );
    // The Vec goes over as it is: a guide can be 95MB, and a copy held it
    // twice.
    Ok(tauri::ipc::Response::new(body))
}

/// Multi-view: serve a live stream to the webview through the loopback
/// proxy, which adds the CORS header the provider may not send. Returns the
/// `http://127.0.0.1:…/mv/<token>` URL to hand mpegts.js. See mvproxy.rs.
/// `convert_hevc`: this webview cannot play HEVC, so the proxy converts it
/// (mvconvert.rs). Optional, so a frontend from before it still works.
#[tauri::command]
fn mv_proxy_open(
    url: String,
    convert_hevc: Option<bool>,
    // The playlist's own User-Agent, sent upstream for the stream and for what
    // the HEVC conversion is fed from (ffmpeg reads a pipe and asks nobody).
    user_agent: Option<String>,
) -> Result<String, String> {
    let agent = mpvagent::clean(user_agent)?;
    mvproxy::open_as(&url, convert_hevc.unwrap_or(false), agent.as_deref())
}

/// Multi-view, an HLS (.m3u8) stream: the same loopback URL, and every
/// playlist it serves has its URIs pointed back through the proxy, so hls.js
/// reaches the segments with the CORS header too (v0.10.67). Its own command
/// so a newer frontend on an older native build, whose proxy would not
/// rewrite playlists, fails the call and plays the stream directly.
#[tauri::command]
fn mv_proxy_open_hls(url: String, user_agent: Option<String>) -> Result<String, String> {
    let agent = mpvagent::clean(user_agent)?;
    mvproxy::open_hls_as(&url, agent.as_deref())
}

/// Multi-view opened on a webview that can't play HEVC: ask now what this
/// machine's ffmpeg can do, so the first HEVC tile doesn't wait for it
/// (mvconvert.rs). Asked once per run; later calls return at once.
#[tauri::command]
async fn mv_convert_warm() {
    let _ = mvconvert::caps().await;
}

// ---- Recording (plan 029; see rec.rs). The page names an id, never a path:
// the file is the index's, and a folder it picks is only where new ones go. ----

/// Where recordings go: the folder the page gave (Settings → Playback), a full
/// path, or `Videos\BlammyTV`.
fn recordings_folder(
    app: &tauri::AppHandle,
    folder: Option<String>,
) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    match folder.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => Ok(f.into()),
        None => app
            .path()
            .video_dir()
            .map(|v| v.join("BlammyTV"))
            .map_err(|_| "there is no Videos folder".to_string()),
    }
}

/// Where recordings go when nothing is set (`Videos\BlammyTV`), for the
/// Settings field to show. Not made: the first recording does that.
#[tauri::command]
fn rec_default_folder(app: tauri::AppHandle) -> Result<String, String> {
    recordings_folder(&app, None).map(|p| p.to_string_lossy().into_owned())
}

/// Settings → Playback → Recordings Folder: the folder dialog. The page never
/// names a path of its own to record into; the one it passes to `rec_start` is
/// one this handed back. Opens on `current` if that is a folder that exists,
/// else the default. Answers the chosen full path, or null when the dialog was
/// closed. Async, with the wait on a blocking thread, as `settings_export`.
#[tauri::command]
async fn rec_pick_folder(
    app: tauri::AppHandle,
    current: Option<String>,
) -> Result<Option<String>, String> {
    let default = recordings_folder(&app, None)?;
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Choose a Folder for Recordings");
        if let Some(start) = rec::picker_start(current.as_deref(), &default) {
            dialog = dialog.set_directory(start);
        }
        if let Some(win) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&win);
        }
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Record a live channel to a file, in Rust, whatever the player does. Answers
/// the recording's id once bytes are coming, and rejects with why not (the host
/// and a reason, never the link). `rec-update` events then carry the record as
/// its status and size change. `until` is a programme's end (Unix ms): the
/// recording stops a minute after it. `schedule_id` is a scheduled record the
/// page was told is due (`rec_schedule`): the recording takes its id and stop
/// time, and a start that fails leaves that record Failed.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn rec_start(
    app: tauri::AppHandle,
    url: String,
    user_agent: Option<String>,
    channel: String,
    programme: Option<String>,
    playlist_id: String,
    folder: Option<String>,
    until: Option<u64>,
    schedule_id: Option<String>,
) -> Result<String, String> {
    let user_agent = mpvagent::clean(user_agent)?;
    let folder = recordings_folder(&app, folder)?;
    let spec = rec::Spec {
        url,
        user_agent,
        channel,
        programme,
        playlist_id,
        folder,
        id: None,
        until,
    };
    match schedule_id {
        Some(id) => rec::get()?.start_scheduled(&id, spec).await,
        None => rec::get()?.start(spec).await,
    }
}

/// Keep a programme from the Guide to record (plan 029, Phase 3): native
/// starts the clock, saves it across restarts and tells the page when it is
/// due, with `rec-update` carrying the record as `due`. `start` and `end` are
/// the programme's own times (Unix ms); native adds the minute either side.
#[tauri::command]
fn rec_schedule(
    channel_id: String,
    channel: String,
    programme: Option<String>,
    playlist_id: String,
    start: u64,
    end: u64,
) -> Result<rec::Record, String> {
    rec::get()?.schedule(rec::Plan {
        channel_id,
        channel,
        programme,
        playlist_id,
        start,
        end,
    })
}

/// A due recording the page could not start for want of a link. Failed, with
/// why.
#[tauri::command]
fn rec_schedule_fail(id: String, reason: String) -> Result<(), String> {
    rec::get()?.fail_scheduled(&id, &reason);
    Ok(())
}

/// Record the player's own buffer from where it is playing (plan 029, D3): for
/// a line with one connection, where a second would be refused. mpv's
/// `dump-cache` (mpv.rs), apart from `mpv_set`, which still refuses it. It
/// ends by itself when the player loads, reloads or stops, as Partial.
#[tauri::command]
async fn rec_buffer_start(
    app: tauri::AppHandle,
    channel: String,
    programme: Option<String>,
    playlist_id: Option<String>,
    folder: Option<String>,
) -> Result<String, String> {
    let folder = recordings_folder(&app, folder)?;
    rec::get()?
        .buffer_start(
            rec::BufferSpec {
                channel,
                programme,
                playlist_id: playlist_id.unwrap_or_default(),
                folder,
            },
            |file| mpv::dump_cache_start(&file.to_string_lossy()),
            Box::new(mpv::dump_cache_stop),
        )
        .await
}

/// Stop a recording and wait for its file to be finished. Answers the record.
#[tauri::command]
async fn rec_stop(id: String) -> Result<rec::Record, String> {
    rec::get()?.stop(&id).await
}

/// Every recording, newest first.
#[tauri::command]
fn rec_list() -> Result<Vec<rec::Record>, String> {
    Ok(rec::get()?.list())
}

/// Delete a recording's file and its entry. Not while it records.
#[tauri::command]
async fn rec_delete(id: String) -> Result<(), String> {
    let rec = rec::get()?.clone();
    tauri::async_runtime::spawn_blocking(move || rec.delete(&id))
        .await
        .map_err(|e| e.to_string())?
}

/// Show a recording's file in Explorer, selected.
#[tauri::command]
fn rec_show(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let file = rec::get()?.playable(&id)?;
    // Not the error itself: it names the path.
    app.opener()
        .reveal_item_in_dir(file)
        .map_err(|_| "could not open the folder".to_string())
}

/// Settings → Playback → Recordings → Smaller Files: whether a finished
/// recording is re-encoded to HEVC after it is repackaged (plan 029, Phase 4).
/// The page says it at launch and on each change. Until it has said, a shrink
/// left from the last run waits. Off drops the shrinks that have not started.
#[tauri::command]
fn rec_set_smaller(on: bool) -> Result<(), String> {
    rec::get()?.set_smaller(on);
    Ok(())
}

/// Give a running recording a fresh link, for its next reconnect: a Stalker
/// link expires, and the page can ask for another.
#[tauri::command]
fn rec_set_url(id: String, url: String) -> Result<(), String> {
    rec::get()?.set_url(&id, &url)
}

/// Play a recording in the in-app player, at the rect the page gives
/// (`inv_open`'s). The file comes from the index and must exist: this is the
/// one place a path, not an http URL, reaches mpv, and `inv_open` and
/// `popout_open` still refuse everything but http (mpvurl).
#[tauri::command]
fn rec_play(
    window: tauri::WebviewWindow,
    id: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    start: Option<f64>,
) -> Result<(), String> {
    let file = rec::get()?.playable(&id)?;
    open_in_player(
        window,
        file.to_string_lossy().into_owned(),
        x,
        y,
        w,
        h,
        start,
        Some(false),
        None,
    )
}

/// Forget a URL `mv_proxy_open` returned, when its tile unmounts.
#[tauri::command]
fn mv_proxy_close(local: String) {
    mvproxy::close(&local)
}

/// Multi-view's sound, played from this process (mvaudio.rs): open the
/// default output device and a loopback listener the webview POSTs the sound
/// tile's audio to, and return the URL and the rate to render it at. Opening
/// twice hands back the open one. Rejects with a plain message when there is
/// no device, and on a native build from before it, which the frontend treats
/// as "play it in the webview".
#[tauri::command]
async fn mv_audio_open() -> Result<mvaudio::Opened, String> {
    // Opening a device can take a moment: not on the thread that runs the UI.
    tauri::async_runtime::spawn_blocking(|| mvaudio::open(audio_output))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
use mvaudio_out::start as audio_output;

// Only Windows has the output; nothing else builds this app, but the shared
// part of mvaudio.rs should still compile.
#[cfg(not(windows))]
fn audio_output(_: std::sync::Arc<mvaudio::Shared>) -> Result<mvaudio::Output, String> {
    Err("multi-view's sound output is Windows only".to_string())
}

/// Stop multi-view's sound output and its listener, and free the device.
/// Nothing open is fine.
#[tauri::command]
async fn mv_audio_close() {
    let _ = tauri::async_runtime::spawn_blocking(mvaudio::close).await;
}

/// What the sound output is doing, for working out on a real machine why it
/// sounds the way it does: milliseconds buffered, underruns, overruns, batches.
#[tauri::command]
fn mv_audio_stats() -> mvaudio::Stats {
    mvaudio::stats()
}

/// Trakt (plan 015): one client for the run. Its client id is compiled in
/// by build.rs from apps/app/.env.local (TRAKT_CLIENT_ID; Trakt no longer
/// issues a secret) and is empty in a build without it, which then says
/// "not configured". A dev run keeps its session under its own name, so it never
/// spends the installed app's single-use refresh token (the lesson of
/// v0.10.19, where dev runs reached into the installed app's hot channel).
fn trakt_client() -> &'static std::sync::Arc<trakt::Trakt> {
    static CLIENT: OnceLock<std::sync::Arc<trakt::Trakt>> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let cfg = trakt::Config {
            client_id: option_env!("BLAMMYTV_TRAKT_ID").unwrap_or("").to_string(),
            redirect_uri: option_env!("BLAMMYTV_TRAKT_REDIRECT")
                .unwrap_or("urn:ietf:wg:oauth:2.0:oob")
                .to_string(),
            api_base: "https://api.trakt.tv".into(),
            auth_base: "https://auth.trakt.tv".into(),
            user_agent: format!("BlammyTV/{}", env!("CARGO_PKG_VERSION")),
        };
        #[cfg(windows)]
        let vault: Box<dyn trakt::Vault> = Box::new(trakt::WindowsVault {
            target: if tauri::is_dev() {
                "BlammyTV/trakt-dev"
            } else {
                "BlammyTV/trakt"
            }
            .into(),
        });
        #[cfg(not(windows))]
        let vault: Box<dyn trakt::Vault> = Box::new(trakt::MemoryVault::default());
        trakt::Trakt::new(cfg, http_client().clone(), vault)
    })
}

/// Whether this build can reach Trakt, and whether a session is kept.
#[tauri::command]
async fn trakt_status() -> trakt::Status {
    trakt_client().status().await
}

/// Start signing in: the code to show and where to enter it.
#[tauri::command]
async fn trakt_device_start() -> Result<trakt::DeviceCode, String> {
    trakt_client().device_start().await
}

/// One poll of the sign-in, at the interval `trakt_device_start` gave.
#[tauri::command]
async fn trakt_device_poll() -> Result<trakt::Poll, String> {
    trakt_client().device_poll().await
}

/// A Trakt API call by path (`/sync/history`), with the session's token
/// added here. The answer comes back as data, a 4xx included.
#[tauri::command]
async fn trakt_request(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<trakt::Reply, String> {
    trakt_client().request(&method, &path, body).await
}

/// Sign out of Trakt, here and there.
#[tauri::command]
async fn trakt_disconnect() {
    trakt_client().disconnect().await
}

/// MyAnimeList (plan 021): one client for the run, the same shape as
/// Trakt's. Its client id is compiled in by build.rs from apps/app/.env.local
/// (MAL_CLIENT_ID); an app of type "other" has no secret. The redirect is
/// http://localhost:47391/, registered with MAL exactly. A dev run keeps
/// its session under its own name, as Trakt's does.
fn mal_client() -> &'static std::sync::Arc<mal::Mal> {
    static CLIENT: OnceLock<std::sync::Arc<mal::Mal>> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let cfg = mal::Config {
            client_id: option_env!("BLAMMYTV_MAL_ID").unwrap_or("").to_string(),
            api_base: "https://api.myanimelist.net/v2".into(),
            auth_base: "https://myanimelist.net/v1/oauth2".into(),
            redirect_port: 47391,
            sign_in_for: std::time::Duration::from_secs(600),
            user_agent: format!("BlammyTV/{}", env!("CARGO_PKG_VERSION")),
        };
        #[cfg(windows)]
        let vault: Box<dyn trakt::Vault> = Box::new(mal::WindowsVault {
            target: if tauri::is_dev() {
                "BlammyTV/mal-dev"
            } else {
                "BlammyTV/mal"
            }
            .into(),
        });
        #[cfg(not(windows))]
        let vault: Box<dyn trakt::Vault> = Box::new(trakt::MemoryVault::default());
        mal::Mal::new(cfg, http_client().clone(), vault)
    })
}

/// Whether this build can reach MAL, and whether a session is kept.
#[tauri::command]
async fn mal_status() -> trakt::Status {
    mal_client().status().await
}

/// Start signing in: listen for MAL's redirect, and return the link for
/// the page to open in the browser.
#[tauri::command]
async fn mal_sign_in_start() -> Result<String, String> {
    mal_client().sign_in_start().await
}

/// Where the sign-in is: waiting, approved, denied, expired or failed.
#[tauri::command]
fn mal_sign_in_poll() -> mal::SignIn {
    mal_client().sign_in_poll()
}

/// Stop waiting for the browser and give the port back.
#[tauri::command]
async fn mal_sign_in_cancel() {
    mal_client().sign_in_cancel().await
}

/// A MAL API call by path (`/users/@me/animelist`), with the session's
/// token added here. `form` is the query on a GET and the form body on
/// anything else. The answer comes back as data, a 4xx included.
#[tauri::command]
async fn mal_request(
    method: String,
    path: String,
    form: Option<std::collections::BTreeMap<String, String>>,
) -> Result<mal::Reply, String> {
    mal_client().request(&method, &path, form).await
}

/// Sign out of MAL here. MAL has no revoke.
#[tauri::command]
async fn mal_disconnect() {
    mal_client().disconnect().await
}

/// AIOStreams' Jellyfin side (plan 023): one client for the run, the same
/// shape as Trakt's. Nothing is compiled in: Quick Connect needs no app key,
/// and the address is the AIOStreams one the page already holds, a manifest
/// URL or the instance's own. A dev run keeps its session under its own
/// name, as Trakt's does.
fn aiojf_client() -> &'static std::sync::Arc<aiojf::Aiojf> {
    static CLIENT: OnceLock<std::sync::Arc<aiojf::Aiojf>> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let cfg = aiojf::Config {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            // Windows sets it; the header says "Windows" when it is absent.
            device_name: std::env::var("COMPUTERNAME").unwrap_or_default(),
        };
        #[cfg(windows)]
        let vault: Box<dyn aiojf::Vault> = Box::new(aiojf::WindowsVault {
            target: if tauri::is_dev() {
                "BlammyTV/aiostreams-dev"
            } else {
                "BlammyTV/aiostreams"
            }
            .into(),
        });
        #[cfg(not(windows))]
        let vault: Box<dyn aiojf::Vault> = Box::new(aiojf::MemoryVault::default());
        aiojf::Aiojf::new(cfg, http_client().clone(), vault)
    })
}

/// Whether a session is kept, and whose.
#[tauri::command]
fn aiojf_status() -> aiojf::Status {
    aiojf_client().status()
}

/// Start signing in from an AIOStreams address: the code to show and the
/// configure page where it is approved. The address is a manifest URL as
/// before, or a configure URL, or just the instance's own (`aio.example.com`
/// will do). The argument keeps its name, `manifestUrl`, for a frontend that
/// sends it that way. Rejects with `unsupported: ...` when that AIOStreams
/// has no Jellyfin side.
#[tauri::command]
async fn aiojf_start(manifest_url: String) -> Result<aiojf::Started, String> {
    aiojf_client().start(&manifest_url).await
}

/// One poll of the sign-in: approved, pending, expired or error.
#[tauri::command]
async fn aiojf_poll() -> Result<aiojf::Poll, String> {
    aiojf_client().poll().await
}

/// A Jellyfin API call by path (`/UserItems/Resume`), with the session's
/// token added here. Only the calls the app makes are sent (aiojf.rs
/// `on_the_list`), never one that would make AIOStreams search for streams;
/// anything else rejects with `refused: ...` and sends nothing. The answer
/// comes back as data, a 4xx included, with the token taken out of it, and a
/// 401 signs out here.
#[tauri::command]
async fn aiojf_request(
    method: String,
    path: String,
    query: Option<std::collections::HashMap<String, String>>,
    body: Option<serde_json::Value>,
) -> Result<aiojf::Reply, String> {
    aiojf_client().request(&method, &path, query, body).await
}

/// The stream search for one title, started by name (plan 024): the sources
/// AIOStreams finds, with `Id`, `Path`, `Name`, `Type`, `Size`, `Container`,
/// `RunTimeTicks`, `IsInfiniteStream` and `aiostreams` and nothing else, as
/// the full answer carries the token. `refresh` searches again; without it a
/// list from the last 3 minutes is taken as it is. `aiojf_request` refuses
/// this path, so nothing starts a search by accident. Rejects with
/// `refused: ...` for an `itemId` that is not 32 lower case hex.
#[tauri::command]
async fn aiojf_sources(item_id: String, refresh: Option<bool>) -> Result<aiojf::Sources, String> {
    aiojf_client()
        .sources(&item_id, refresh.unwrap_or(false))
        .await
}

/// Sign out of AIOStreams, here and, best effort, there.
#[tauri::command]
async fn aiojf_disconnect() {
    aiojf_client().disconnect().await
}

static JF_CLIENT: OnceLock<std::sync::Arc<jf::Jf>> = OnceLock::new();

/// The Jellyfin client if the page has started it, without starting it: what
/// mpv asks before every file, so a user with no Jellyfin never reads the
/// vault for one. A file only gets a Jellyfin header after the page has asked
/// for the stream check (`jf_prepare_stream`), which starts it.
pub(crate) fn jf_client_started() -> Option<&'static std::sync::Arc<jf::Jf>> {
    JF_CLIENT.get()
}

/// A Jellyfin server of the user's own (plan 027): one client for the run,
/// the same shape as AIOStreams' above. The address is the server's, typed
/// in Settings. A dev run keeps its session under its own name.
fn jf_client() -> &'static std::sync::Arc<jf::Jf> {
    JF_CLIENT.get_or_init(|| {
        let cfg = jf::Config {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            // Windows sets it; the header says "Windows" when it is absent.
            device_name: std::env::var("COMPUTERNAME").unwrap_or_default(),
        };
        #[cfg(windows)]
        let vault: Box<dyn jf::Vault> = Box::new(jf::WindowsVault {
            target: if tauri::is_dev() {
                "BlammyTV/jellyfin-dev"
            } else {
                "BlammyTV/jellyfin"
            }
            .into(),
        });
        #[cfg(not(windows))]
        let vault: Box<dyn jf::Vault> = Box::new(jf::MemoryVault::default());
        jf::Jf::new(cfg, http_client().clone(), vault)
    })
}

/// Whether a Jellyfin session is kept, and whose.
#[tauri::command]
fn jf_status() -> jf::Status {
    jf_client().status()
}

/// Sign in to a Jellyfin server by user name and password. The password goes
/// to the server once and is not kept. Rejects with `unsupported: ...` (not a
/// Jellyfin, an AIOStreams, too old), `denied: ...` (wrong login) or a plain
/// reason.
#[tauri::command]
async fn jf_sign_in(address: String, user: String, password: String) -> Result<jf::Status, String> {
    jf_client().sign_in(&address, &user, &password).await
}

/// Start Quick Connect: the code to type into Jellyfin's own web page.
#[tauri::command]
async fn jf_quick_connect(address: String) -> Result<jf::Started, String> {
    jf_client().quick_connect(&address).await
}

/// One poll of the Quick Connect: approved, pending, expired or error.
#[tauri::command]
async fn jf_poll() -> Result<jf::Poll, String> {
    jf_client().poll().await
}

/// A Jellyfin API call by path (`/UserItems/Resume`), with the session's token
/// added here. Only the calls the app makes are sent (jf.rs `on_the_list`);
/// anything else rejects with `refused: ...` and sends nothing. The answer
/// comes back as data, a 4xx included, with the token taken out of it, and a
/// 401 signs out here.
#[tauri::command]
async fn jf_request(
    method: String,
    path: String,
    query: Option<std::collections::HashMap<String, String>>,
    body: Option<serde_json::Value>,
) -> Result<jf::Reply, String> {
    jf_client().request(&method, &path, query, body).await
}

/// The media sources of one item (`PlaybackInfo`), trimmed to what the app
/// shows: the full answer carries paths and the token. Rejects with
/// `refused: ...` for an `itemId` that is not 32 lower case hex.
#[tauri::command]
async fn jf_sources(item_id: String) -> Result<jf::Sources, String> {
    jf_client().sources(&item_id).await
}

/// The check before a Jellyfin stream is handed to the player: does the server
/// serve it as it is, or only with the token (which then goes to mpv as a
/// header for this file, never in the address)? Takes the stream's address, a
/// direct stream of the signed-in server; anything else rejects with
/// `refused: ...` and nothing is sent. `offOrigin` means the stream is only
/// reached through a redirect to another server and must not be played with
/// the token. A new command: an older native build rejects it and the page
/// plays the stream as it would without.
#[tauri::command]
async fn jf_prepare_stream(url: String) -> Result<jf::Prepared, String> {
    jf_client().prepare_stream(&url).await
}

/// The external subtitles of the streams just listed (a `.srt` beside the
/// video), so the player can add them once it has the file. Takes each
/// stream's address and the index and name of each subtitle, never an address
/// for a subtitle: those are made here from the stream (`jf::subtitle_lines`).
/// A stream that is not a direct stream of the signed-in server is left out.
/// Answers how many subtitles are known. A new command: an older native build
/// rejects it and plays without the subtitles.
#[tauri::command]
fn jf_set_subtitles(entries: Vec<jf::SubsFor>) -> Result<usize, String> {
    jf_client().set_subtitles(entries)
}

/// Sign out of Jellyfin, here and there. True when the server confirmed the
/// token is revoked.
#[tauri::command]
async fn jf_disconnect() -> bool {
    jf_client().disconnect().await
}

/// Forensic GET for the settings Connection Test. Unlike `http_get`, a
/// non-2xx status is DATA here, not an error: the point is to answer "WHO
/// rejected this request" from a tester's screenshot — a WAF in front of
/// the instance (`server: cloudflare` + `cf-mitigated: challenge`) reads
/// completely differently from the instance itself or an antivirus
/// web-shield forging responses locally. Same shared client as `http_get`,
/// so the probe receives the same treatment as real app traffic. Returns a
/// JSON string: `{ status, headers: <identifying subset>, bodyHead }`.
/// The URL is a credential: any echo of its path/query is cut from the
/// body head before it leaves this function, and the frontend scrubs again
/// before display.
#[tauri::command]
async fn http_probe(url: String) -> Result<String, String> {
    let mut res = http_client()
        .get(&url)
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/plain, */*",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        // Transport errors echo the URL (reqwest appends it) — callers
        // must scrub, same contract as http_get.
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    // Headers that identify the responder and nothing else — a full dump
    // could carry Set-Cookie or other reflected values.
    const KEEP: [&str; 8] = [
        "server",
        "via",
        "cf-ray",
        "cf-mitigated",
        "cf-cache-status",
        "x-served-by",
        "x-powered-by",
        "content-type",
    ];
    let mut headers = serde_json::Map::new();
    for name in KEEP {
        if let Some(v) = res.headers().get(name).and_then(|v| v.to_str().ok()) {
            headers.insert(name.to_string(), serde_json::Value::from(v));
        }
    }
    // Enough body to recognize a block page; never the whole response.
    let mut body: Vec<u8> = Vec::new();
    while body.len() < 600 {
        match res.chunk().await {
            Ok(Some(c)) => body.extend_from_slice(&c),
            _ => break,
        }
    }
    body.truncate(600);
    let mut head = String::from_utf8_lossy(&body).into_owned();
    // Error pages love echoing the request back at you.
    if let Ok(parsed) = reqwest::Url::parse(&url) {
        head = head.replace(&url, "[url]");
        if parsed.path().len() > 1 {
            head = head.replace(parsed.path(), "[path]");
        }
        if let Some(q) = parsed.query() {
            if !q.is_empty() {
                head = head.replace(q, "[query]");
            }
        }
    }
    Ok(
        serde_json::json!({ "status": status, "headers": headers, "bodyHead": head })
            .to_string(),
    )
}

// Self-update: check GitHub Releases (see tauri.conf.json > plugins.updater) for
// a newer signed build. Returns the new version string when one is available.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(|e| e.to_string())?;
        match updater.check().await {
            Ok(Some(update)) => Ok(Some(update.version)),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(None)
    }
}

/// An update that is waiting, with the words its release put on it.
#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    /// `latest.json`'s `notes`, cleaned (about.rs) and empty when there are
    /// none. Display text: the page draws it as text, never as HTML.
    notes: String,
}

// `check_update` with the release's notes (plan 025, P4a): Settings → App →
// Updates shows them under the version. Its own command and not a change to
// `check_update`, which the header's chip and a frontend from before this call
// both use as it is; a frontend that asks this one and finds an older native
// without it falls back to that one.
#[tauri::command]
async fn check_update_info(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(|e| e.to_string())?;
        match updater.check().await {
            Ok(Some(update)) => Ok(Some(UpdateInfo {
                notes: about::clean_notes(update.body.as_deref().unwrap_or_default()),
                version: update.version,
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(None)
    }
}

/// What this install is made of, for Settings → App → About (about.rs). Every
/// field is a version string and every one is optional: a field that can't be
/// told is left out and the page doesn't draw that row. No path, URL or name
/// goes into any of them.
///
/// mpv's two come from the in-app player when there is one, and from a handle
/// of its own that is made and destroyed at once when there isn't (mpv.rs
/// `versions`); never from the persistent player, which needs a window. The
/// handle and the ffmpeg start are each slow enough to keep off the thread
/// that runs the UI, and independent, so they are asked together.
#[tauri::command]
async fn about_versions() -> about::Versions {
    let asked = tauri::async_runtime::spawn_blocking(mpv::versions);
    let (asked, bundled) = futures_util::future::join(asked, mvconvert::version()).await;
    let (player_mpv, player_ffmpeg) = asked.unwrap_or_default();
    about::Versions {
        native: Some(env!("CARGO_PKG_VERSION").to_string()),
        mpv: player_mpv,
        ffmpeg: player_ffmpeg,
        bundled_ffmpeg: bundled,
        // After mpv was asked, which loads libmpv and so settles the choice.
        vulkan: Some(mpv::vulkan_loader().to_string()),
    }
}

/// The page's warnings and errors, for the log file (lib/appLog.ts): a line a
/// webview would otherwise take with it when it closes. Written under its own
/// target, "frontend", so the file says which side a line came from.
///
/// The page scrubs every line before it sends it (lib/scrub.ts), and this
/// makes each one a single line of the file (logtail::clean_line). A level
/// that is not "warn" or "error" writes nothing: the page logs those two and
/// nothing else, and the tune diagnostics that fire per tune are not among
/// them. Async, so the write is off the thread that runs the window.
#[tauri::command]
async fn app_log(level: String, line: String) {
    let line = logtail::clean_line(&line);
    if line.is_empty() {
        return;
    }
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{line}"),
        "warn" => log::warn!(target: "frontend", "{line}"),
        _ => {}
    }
}

/// The last `lines` lines of the log, oldest first, for Settings → App → Copy
/// Diagnostics: the current file's and, when that is short, the end of the old
/// one before it (logtail.rs). Lines only, never the folder's path, which has
/// the user's name in it. An older native has no such command, and a native
/// whose log could not be opened refuses: either way the page copies what it
/// has and says the log wasn't available.
#[tauri::command]
async fn log_tail(app: tauri::AppHandle, lines: usize) -> Result<Vec<String>, String> {
    use tauri::Manager;
    if !LOGGING.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("the log is not being written".into());
    }
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || logtail::tail(&dir, lines))
        .await
        .map_err(|e| e.to_string())
}

/// Export settings: the save dialog, then the write (plan 025, P4c;
/// settingsfile.rs). The page hands over the text of the file and a name to
/// start the dialog on, and never a path: the only path there is comes from the
/// dialog the person uses. Answers the name of the file they saved it as (the
/// name alone, never the folder, which has their user name in it), or null when
/// they closed the dialog.
///
/// `json` is checked before anything opens: an empty one is refused, and so is
/// one over the cap. The empty refusal is also how the page finds out whether
/// this build has the command at all (an older one answers "not found"), so it
/// must never reach a dialog. Nothing about the file's contents or where it
/// went is logged.
///
/// Async, with the wait on a blocking thread: the dialog holds its caller until
/// the person is done, and the thread that runs the window must not be it.
#[tauri::command]
async fn settings_export(
    app: tauri::AppHandle,
    json: String,
    suggested: String,
) -> Result<Option<String>, String> {
    settingsfile::check_export(&json)?;
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Export settings")
            .add_filter("BlammyTV settings", &["json"])
            .set_file_name(settingsfile::suggested_name(&suggested));
        if let Some(win) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&win);
        }
        let Some(picked) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, json.as_bytes())
            .map_err(|e| format!("could not write the file: {e}"))?;
        Ok(Some(
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| settingsfile::DEFAULT_NAME.to_string()),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import settings: the open dialog, then the file's text (plan 025, P4c;
/// settingsfile.rs). Filtered to .json, one file, and read only up to the cap
/// (`too-big` past it, `not-text` for a file that is not UTF-8). Answers the
/// text, or null when the dialog was closed. What the text means is the page's
/// to judge and it changes nothing until it has. Nothing about the file is
/// logged. Async for the same reason as `settings_export`.
#[tauri::command]
async fn settings_import(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Import settings")
            .add_filter("BlammyTV settings", &["json"]);
        if let Some(win) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&win);
        }
        let Some(picked) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        settingsfile::read_capped(&path, settingsfile::MAX_BYTES)
            .map(Some)
            .map_err(|e| e.message())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether the log plugin is up: it could be added and has its file open. Read
/// by `log_tail`, which would otherwise answer "no lines" for a log that was
/// never being written, and the page would say "empty".
static LOGGING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The one log file, in a release build and a dev one alike (tauri-plugin-log;
/// the app's log folder, `blammytv.log`). About a megabyte, then the plugin
/// renames it and starts a new one, and one old file is kept: `KeepSome(1)`,
/// because the plugin's `KeepOne` keeps none, it deletes the full file. Info and
/// up. A dev run keeps printing to its terminal as well.
///
/// A release build has no console (main.rs: `windows_subsystem`), so before
/// this nothing it printed went anywhere and support was screenshots. Nothing
/// that is a credential is logged: the native lines say origins and counts
/// (CLAUDE.md), and the page's are scrubbed before they get here.
fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some(logtail::STEM.to_string()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    // A dev run also takes this crate's debug lines (the small `[http]`
    // requests). Its own target only: the dependencies' debug would bury
    // everything.
    let builder = tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Info);
    let builder = if cfg!(debug_assertions) {
        builder.level_for("app_lib", log::LevelFilter::Debug)
    } else {
        builder
    };
    builder
        .max_file_size(u128::from(logtail::MAX_BYTES))
        .rotation_strategy(RotationStrategy::KeepSome(1))
        .build()
}

// Download + install the pending update, then relaunch into it. On success the
// app restarts and this never returns.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(|e| e.to_string())?;
        let update = updater
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No update available".to_string())?;
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        // restart() starts the new copy before this one has exited. Give the
        // one-copy name up first, or the new one would find it taken and
        // hand off to this closing window (single.rs). On Windows the
        // installer path exits inside download_and_install; this is for any
        // path that returns.
        #[cfg(windows)]
        single::release();
        app.restart()
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(())
    }
}

// Open a web page in the SYSTEM browser: Trakt's and MAL's sign-in pages,
// and your AIOStreams configure page. The webview blocks target=_blank
// navigation by design, so this command is the app's only external-nav
// path. Web pages only, no other scheme. http too: an AIOStreams on your
// own network is often served without TLS, and its configure page is where
// the sign-in code is approved.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web pages can be opened".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The one-copy check stays FIRST, ahead of `tauri::Builder` and so of
    // `context()`. `.run(context())` evaluates `context()` before any
    // plugin's setup, and `context()` calls `frontend::resolve()`, which arms
    // the hot channel's boot sentinel; a second copy that armed it and then
    // exited would leave it armed, and two of those quarantine a good bundle.
    // And a second copy that got as far as Trakt would spend the first copy's
    // single-use refresh token and clear the vault. A later check, a plugin
    // among them, is too late for both (single.rs, audit NA1).
    #[cfg(windows)]
    if !single::claim() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // Used from Rust, by settings_export and settings_import above. No
        // capability grants the page the plugin's own commands, so it cannot
        // open a dialog itself. The plugin also puts its own window.alert and
        // window.confirm on every page; nothing here calls either.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let _ = APP.set(app.handle().clone());
            // The log comes first. It is added here and not on the builder
            // because a plugin that fails to set up ends the run: a log file
            // this user can't open (a folder, or a file left by another
            // account) would then be an app that can't start, over a log. Here
            // the cost is the log, and `log_tail` says so. Then the lines
            // frontend::resolve() had to keep, from before there was a logger.
            match app.handle().plugin(log_plugin()) {
                Ok(()) => {
                    LOGGING.store(true, std::sync::atomic::Ordering::Relaxed);
                    frontend::replay_boot_log();
                }
                // The one print left: there is no log to say it to. A dev run's
                // terminal shows it; a release build has no console.
                Err(e) => eprintln!("[log] could not start the log: {e}"),
            }

            // The recordings index, in the app's data folder (rec.rs). A recording
            // the last run died in is settled here. With no data folder there is
            // no recording, and each rec_ command says so.
            match app.path().app_data_dir() {
                Ok(dir) => rec::init(
                    dir.join("recordings.json"),
                    std::sync::Arc::new(|record| {
                        use tauri::Emitter;
                        if let Some(app) = APP.get() {
                            let _ = app.emit("rec-update", record);
                        }
                    }),
                ),
                Err(e) => log::warn!("[rec] no data folder, recording is off: {e}"),
            }

            // Window bring-up. The window-state plugin has, by now, restored a
            // saved size/position from a previous launch. On the very first
            // launch there's nothing to restore, so open maximized. A private
            // marker file (not the plugin's) draws the first-run line — after
            // it exists we leave the window alone, so a remembered,
            // un-maximized size survives every later launch instead of being
            // forced back to maximized.
            if let Some(win) = app.get_webview_window("main") {
                let marker = app
                    .path()
                    .app_config_dir()
                    .ok()
                    .map(|dir| dir.join(".blammytv-initialized"));
                let first_run =
                    marker.as_ref().map(|p| !p.exists()).unwrap_or(false);
                if first_run {
                    let _ = win.maximize();
                    if let Some(p) = &marker {
                        if let Some(parent) = p.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::write(p, b"1");
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            popout_open,
            popout_pos,
            popout_stop,
            vlc_open,
            inv_open,
            inv_set_rect,
            inv_stop,
            mpv_pause,
            mpv_mute,
            mpv_volume,
            mpv_seek,
            mpv_seek_abs,
            mpv_set_speed,
            mpv_go_live,
            mpv_prefs,
            mpv_sub_delay,
            mpv_sub_delay_reset,
            mpv_track,
            mpv_status,
            mpv_open_error,
            mpv_stats,
            mpv_diag,
            mpv_perf,
            mpv_set,
            mpv_get,
            mpv_blur,
            mpv_frost,
            mpv_frost_rect,
            http_get,
            http_probe,
            mv_proxy_open,
            mv_proxy_open_hls,
            mv_proxy_close,
            mv_convert_warm,
            rec_default_folder,
            rec_pick_folder,
            rec_start,
            rec_schedule,
            rec_schedule_fail,
            rec_buffer_start,
            rec_stop,
            rec_list,
            rec_delete,
            rec_show,
            rec_set_url,
            rec_set_smaller,
            rec_play,
            mv_audio_open,
            mv_audio_close,
            mv_audio_stats,
            trakt_status,
            trakt_device_start,
            trakt_device_poll,
            trakt_request,
            trakt_disconnect,
            mal_status,
            mal_sign_in_start,
            mal_sign_in_poll,
            mal_sign_in_cancel,
            mal_request,
            mal_disconnect,
            aiojf_status,
            aiojf_start,
            aiojf_poll,
            aiojf_request,
            aiojf_sources,
            aiojf_disconnect,
            jf_status,
            jf_sign_in,
            jf_quick_connect,
            jf_poll,
            jf_request,
            jf_sources,
            jf_prepare_stream,
            jf_set_subtitles,
            jf_disconnect,
            check_update,
            check_update_info,
            about_versions,
            app_log,
            log_tail,
            settings_export,
            settings_import,
            install_update,
            frontend::frontend_ready,
            frontend::frontend_status,
            frontend::frontend_check,
            frontend::frontend_apply
        ])
        .run(context())
        .expect("error while running tauri application");
}

/// The app context, with the frontend hot channel's asset provider spliced
/// in when a staged bundle is active (plan 008). Untouched otherwise: the
/// swap only happens when there is something staged to serve, so the normal
/// path is byte-for-byte the stock embedded one.
fn context() -> tauri::Context<tauri::Wry> {
    let mut ctx = tauri::generate_context!();
    if let Some(dir) = frontend::resolve() {
        // Two-step: set_assets returns the PREVIOUS provider, and that is
        // the embedded one we need to keep as the per-file fallback.
        let embedded = ctx.set_assets(Box::new(frontend::Placeholder));
        ctx.set_assets(Box::new(frontend::StagedAssets::new(Some(dir), embedded)));
    }
    ctx
}

#[cfg(test)]
mod tests {
    use super::{append_capped, body_capacity, check_declared_len, tunable, HTTP_GET_MAX_BODY};

    /// Plan 016 N5: a release build's `mpv_set` reaches the tuning
    /// families and none of mpv's properties that touch files or code.
    #[test]
    fn a_release_build_tunes_but_never_touches_files_or_scripts() {
        for ok in [
            "cache-secs",
            "cache-pause-wait",
            "demuxer-max-bytes",
            "demuxer-readahead-secs",
            "hwdec",
            "video-sync",
            "tone-mapping",
            "target-peak",
            "network-timeout",
        ] {
            assert!(tunable(ok), "refused a tuning option: {ok}");
        }
        for no in [
            "log-file",
            "stream-record",
            "cache-dir",
            "demuxer-cache-dir",
            "scripts",
            "script-opts",
            "glsl-shaders",
            "gpu-shader-cache-dir",
            "input-conf",
            "include",
            "demuxer-lavf-o",
            "demuxer-lavf-format",
            "vd-lavc-o",
            "target-lut",
            "screenshot-directory",
            "vf",
            "af",
            "external-files",
            "sub-files",
            "profile",
        ] {
            assert!(!tunable(no), "let through: {no}");
        }
    }

    /// Audit NA4: `http_get` stops a body at the cap. Small caps here, so no
    /// test holds half a gigabyte.
    #[test]
    fn a_body_under_the_cap_passes() {
        let mut body = Vec::new();
        append_capped(&mut body, b"abcd", 10).unwrap();
        append_capped(&mut body, b"efg", 10).unwrap();
        assert_eq!(body, b"abcdefg");
    }

    #[test]
    fn a_body_of_exactly_the_cap_passes() {
        let mut one = Vec::new();
        append_capped(&mut one, &[7; 10], 10).unwrap();
        assert_eq!(one.len(), 10);
        let mut two = Vec::new();
        append_capped(&mut two, &[7; 6], 10).unwrap();
        append_capped(&mut two, &[7; 4], 10).unwrap();
        assert_eq!(two.len(), 10);
    }

    #[test]
    fn one_byte_over_the_cap_fails_and_is_not_kept() {
        let mut across = Vec::new();
        append_capped(&mut across, &[7; 10], 10).unwrap();
        assert!(append_capped(&mut across, &[7; 1], 10).is_err());
        assert_eq!(across.len(), 10, "the chunk that broke the cap was kept");
        let mut single = Vec::new();
        assert!(append_capped(&mut single, &[7; 11], 10).is_err());
        assert!(single.is_empty());
    }

    #[test]
    fn a_declared_length_over_the_cap_fails_before_reading() {
        assert!(check_declared_len(Some(11), 10).is_err());
        assert!(check_declared_len(Some(10), 10).is_ok());
        assert!(check_declared_len(Some(0), 10).is_ok());
        // A compressed response declares nothing; the chunks are what count.
        assert!(check_declared_len(None, 10).is_ok());
    }

    #[test]
    fn the_cap_is_512_mib_and_the_error_names_it() {
        assert_eq!(HTTP_GET_MAX_BODY, 512 * 1024 * 1024);
        assert_eq!(
            check_declared_len(Some(HTTP_GET_MAX_BODY as u64 + 1), HTTP_GET_MAX_BODY),
            Err("response is over the 512 MiB limit".to_string()),
        );
    }

    #[test]
    fn the_reserve_follows_the_declared_length_up_to_the_cap() {
        assert_eq!(body_capacity(None, 10_000), 0);
        assert_eq!(body_capacity(Some(1_000), 10_000), 1_000);
        assert_eq!(body_capacity(Some(10_000), 10_000), 10_000);
        assert_eq!(body_capacity(Some(u64::MAX), 10_000), 10_000);
    }
}
