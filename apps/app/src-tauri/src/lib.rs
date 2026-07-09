mod mpv;
#[cfg(windows)]
mod comp;
#[cfg(windows)]
mod spike;
#[cfg(windows)]
mod inv;

use std::sync::OnceLock;

// App handle, so native code (the composition overlay's ✕) can notify the UI.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Notify the React app of a native-player event (the overlay's ✕ / expand /
/// collapse), so it can drive the guide + the layer geometry.
pub fn emit_comp(event: &str) {
    if let Some(app) = APP.get() {
        use tauri::Emitter;
        let _ = app.emit(event, ());
    }
}

/// Run a closure on the UI thread (e.g. to post into the composition webview from
/// a background mpv poll thread, which must touch COM on the main thread).
pub fn run_on_main<F: FnOnce() + Send + 'static>(f: F) {
    if let Some(app) = APP.get() {
        let _ = app.run_on_main_thread(f);
    }
}

// Forward a keyboard shortcut from the React main webview into the composition
// overlay (which owns the player UI + mpv control).
#[tauri::command]
fn comp_key(window: tauri::WebviewWindow, key: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        window
            .run_on_main_thread(move || comp::post_key(&key))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (window, key);
    }
    Ok(())
}

// Open the native composition player: mpv renders into the given rect (the preview
// box, or full window) with the transparent overlay composited on top.
#[tauri::command]
fn comp_theater(
    window: tauri::WebviewWindow,
    url: String,
    overlay_url: String,
    meta_json: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    radius: i32,
    start: f64,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(comp::theater(
                    hwnd, x, y, w, h, radius, &url, &overlay_url, &meta_json, start,
                ));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, overlay_url, meta_json, x, y, w, h, radius, start);
        Ok(())
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

// Move/resize the native composition layer to follow its in-app box (or expand).
#[tauri::command]
fn comp_set_rect(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    radius: i32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        window
            .run_on_main_thread(move || comp::set_rect(x, y, w, h, radius))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, x, y, w, h, radius);
        Ok(())
    }
}

// Pop out: tear down the in-app composition player, then play in mpv's own
// floating window (PiP with mpv's OSC), like the old desktop popout.
#[tauri::command]
fn comp_popout(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
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
                comp::close_theater();
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
    // Own mpv instance so the composition teardown (fired by the React unmount)
    // can't terminate it.
    mpv::play_popout(&url, start)
}

// Tear down the native composition player (mpv + overlay) and free the HWND.
#[tauri::command]
fn comp_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                comp::close_theater();
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

// ---- Inverted-layer player (dev flag; see inv.rs). Rects are PHYSICAL px. ----

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

/// Player status snapshot for the inverted chrome's poll (replaces comp.rs's
/// loader/time/tracks push threads): position/duration, whether mpv is
/// actually presenting (core-idle == "no" ⇒ first frame has landed), and the
/// audio/sub track lists.
#[tauri::command]
fn mpv_status() -> String {
    let pos = mpv::get_property("time-pos").and_then(|s| s.parse::<f64>().ok());
    let dur = mpv::get_property("duration").and_then(|s| s.parse::<f64>().ok());
    let presenting = mpv::get_property("core-idle").as_deref() == Some("no");
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
    serde_json::json!({
        "pos": pos, "dur": dur, "presenting": presenting,
        "audio": audio, "subs": subs,
    })
    .to_string()
}

// ---- Layer-inversion spike (dev-only UI drives these; see spike.rs). ----

// Open the transparent spike window pointed at our bundle's ?spike=1 page.
// Async on purpose: building a window inside a synchronous command deadlocks
// on Windows (documented tauri behavior).
#[tauri::command]
async fn spike_window(app: tauri::AppHandle, page: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if let Some(win) = app.get_webview_window("spike") {
            let _ = win.set_focus();
            return Ok(());
        }
        let url: tauri::Url = page.parse().map_err(|e| format!("bad page url: {e}"))?;
        let win =
            tauri::WebviewWindowBuilder::new(&app, "spike", tauri::WebviewUrl::External(url))
                .title("BlammyTV — Layer Spike")
                .inner_size(1100.0, 700.0)
                .resizable(false)
                .transparent(true)
                .build()
                .map_err(|e| e.to_string())?;
        // Closing the spike window stops its playback + drops the child.
        win.on_window_event(|ev| {
            if matches!(
                ev,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                run_on_main(spike::close);
            }
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, page);
        Ok(())
    }
}

// (Re)start spike playback into a fresh bottom-of-z-order child of the spike
// window. `bitblt` toggles mpv's present mode (see spike.rs).
#[tauri::command]
fn spike_play(app: tauri::AppHandle, url: String, bitblt: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let win = app
            .get_webview_window("spike")
            .ok_or("spike window not open")?;
        let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let size = win.inner_size().map_err(|e| e.to_string())?;
        let (tx, rx) = std::sync::mpsc::channel();
        win.run_on_main_thread(move || {
            let _ = tx.send(spike::open_under(
                hwnd,
                size.width,
                size.height,
                &url,
                bitblt,
            ));
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, url, bitblt);
        Ok(())
    }
}

// Stop spike playback (the window itself stays open).
#[tauri::command]
fn spike_stop(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            spike::close();
            let _ = tx.send(());
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
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
#[tauri::command]
async fn http_get(url: String) -> Result<tauri::ipc::Response, String> {
    // Load-time diagnostics, printed to the `tauri dev` terminal (devtools
    // close on channel load, the terminal doesn't). Headers-vs-body split
    // separates connect/TTFB from download+decode; the frontend's own [live]
    // timer wraps this whole invoke, so (frontend − total here) = IPC-bridge
    // cost of hauling the decoded string into the webview. URL is logged
    // without its query string — credentials live there.
    let short = url.split('?').next().unwrap_or(&url).to_string();
    let t0 = std::time::Instant::now();
    let res = http_client()
        .get(&url)
        // Send the headers a browser would. Some hosts (Cloudflare's Browser
        // Integrity Check) 403 requests that have a User-Agent but lack these.
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/plain, */*",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
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
            comp_key,
            comp_theater,
            comp_set_rect,
            comp_popout,
            comp_stop,
            popout_pos,
            popout_stop,
            spike_window,
            spike_play,
            spike_stop,
            inv_open,
            inv_set_rect,
            inv_stop,
            mpv_pause,
            mpv_mute,
            mpv_volume,
            mpv_seek,
            mpv_go_live,
            mpv_track,
            mpv_status,
            mpv_blur,
            http_get,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
