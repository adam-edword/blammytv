mod frontend;
mod mal;
mod mpv;
mod mpvurl;
mod mvaudio;
mod mvconvert;
mod mvproxy;
mod trakt;

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
) -> Result<(), String> {
    // Native says what mpv may open, not only the frontend (audit X1).
    mpvurl::http_only(&url)?;
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
    mpv::play_popout(&url, hand)
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
) -> Result<(), String> {
    // Native says what mpv may open, not only the frontend (audit X1).
    mpvurl::http_only(&url)?;
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(inv::open(hwnd, x, y, w, h, &url, start, live));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, x, y, w, h, start, live);
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
    println!("[mpv] frost requested, vo={vo}");
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
    let dvr = mpv::get_property("demuxer-cache-state")
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
        "audio": audio, "subs": subs, "chapters": chapters,
    })
    .to_string()
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
    println!(
        "[http] {} — headers {}ms, total {}ms, body {:.1}MB (content-length: {})",
        short,
        t_headers,
        t0.elapsed().as_millis(),
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
fn mv_proxy_open(url: String, convert_hevc: Option<bool>) -> Result<String, String> {
    mvproxy::open(&url, convert_hevc.unwrap_or(false))
}

/// Multi-view, an HLS (.m3u8) stream: the same loopback URL, and every
/// playlist it serves has its URIs pointed back through the proxy, so hls.js
/// reaches the segments with the CORS header too (v0.10.67). Its own command
/// so a newer frontend on an older native build, whose proxy would not
/// rewrite playlists, fails the call and plays the stream directly.
#[tauri::command]
fn mv_proxy_open_hls(url: String) -> Result<String, String> {
    mvproxy::open_hls(&url)
}

/// Multi-view opened on a webview that can't play HEVC: ask now what this
/// machine's ffmpeg can do, so the first HEVC tile doesn't wait for it
/// (mvconvert.rs). Asked once per run; later calls return at once.
#[tauri::command]
async fn mv_convert_warm() {
    let _ = mvconvert::caps().await;
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

// Buy links: open a checkout URL in the SYSTEM browser. The webview blocks
// target=_blank navigation by design, so this command is the app's only
// external-nav path. https-only — nothing else has business leaving the app.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https urls can be opened".into());
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
        .setup(|app| {
            use tauri::Manager;
            let _ = APP.set(app.handle().clone());

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

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            popout_open,
            popout_pos,
            popout_stop,
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
            mpv_track,
            mpv_status,
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
            check_update,
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
