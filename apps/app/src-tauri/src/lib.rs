mod mpv;
#[cfg(windows)]
mod inv;

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
fn popout_open(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    let start;
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                // Capture the position before teardown so the popout resumes there.
                let pos = mpv::get_property("time-pos")
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                inv::close();
                let _ = tx.send(pos);
            })
            .map_err(|e| e.to_string())?;
        start = rx.recv().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        start = 0.0_f64;
        let _ = &window;
    }
    // Own mpv instance so the in-app teardown (fired by the React unmount)
    // can't terminate it.
    mpv::play_popout(&url, start)
}

// ---- Inverted-layer player (THE architecture; see inv.rs). Rects are PHYSICAL px. ----

#[tauri::command]
fn inv_open(
    window: tauri::WebviewWindow,
    url: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(inv::open(hwnd, x, y, w, h, &url));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, x, y, w, h);
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

/// Frozen-frame glass (DORMANT — Adam requires the video visibly playing
/// behind modals; kept for future channel thumbnails): one tone-mapped
/// frame of the playing video as raw PNG bytes.
#[tauri::command]
fn mpv_snapshot() -> Result<tauri::ipc::Response, String> {
    let path = std::env::temp_dir().join("blammytv-freeze.png");
    if !mpv::screenshot_to_file(path.to_string_lossy().as_ref()) {
        return Err("no frame to snapshot".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    Ok(tauri::ipc::Response::new(bytes))
}

/// Player status snapshot for the inverted chrome's poll (replaced the old
/// overlay webview's loader/time/tracks push threads): position/duration,
/// whether mpv is
/// actually presenting (core-idle == "no" ⇒ first frame has landed), and the
/// audio/sub track lists.
#[tauri::command]
fn mpv_status() -> String {
    let pos = mpv::get_property("time-pos").and_then(|s| s.parse::<f64>().ok());
    let dur = mpv::get_property("duration").and_then(|s| s.parse::<f64>().ok());
    let presenting = mpv::get_property("core-idle").as_deref() == Some("no");
    // Mid-play death signal: a live stream that dies makes mpv reach EOF and
    // fall back to idle (no file loaded). Either means the picture is gone
    // even though we WERE presenting — the frontend watchdog re-arms on it.
    let ended = mpv::get_property("eof-reached").as_deref() == Some("yes")
        || mpv::get_property("idle-active").as_deref() == Some("yes");
    let mut audio = Vec::new();
    let mut subs = Vec::new();
    for t in mpv::track_list() {
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
    let chapters: Vec<serde_json::Value> = mpv::chapter_list()
        .into_iter()
        .map(|c| serde_json::json!({ "title": c.title, "start": c.start }))
        .collect();
    serde_json::json!({
        "pos": pos, "dur": dur, "presenting": presenting, "ended": ended,
        "audio": audio, "subs": subs, "chapters": chapters,
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
fn http_client() -> &'static reqwest::Client {
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

/// Returns the body as RAW BYTES (`tauri::ipc::Response`), not a String: a
/// String return rides the JSON IPC path, and JSON-escaping a ~95MB xmltv
/// document (every quote/newline) plus re-parsing it webview-side measurably
/// dominated load time. The raw path hands the buffer over untouched; the
/// frontend TextDecoder-decodes it in ~100ms.
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
    // PATH, not just the query string.
    let short: String = url.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
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
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let t_headers = t0.elapsed().as_millis();
    // Some(len) = the raw Content-Length reqwest saw. When the server
    // compressed the response, reqwest strips it during transparent decode,
    // so None here ≈ "compression was applied".
    let clen = res.content_length();
    let body = res.bytes().await.map_err(|e| e.to_string())?;
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
    Ok(tauri::ipc::Response::new(body.to_vec()))
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
        app.restart()
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            mpv_blur,
            mpv_frost,
            mpv_frost_rect,
            mpv_snapshot,
            http_get,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
