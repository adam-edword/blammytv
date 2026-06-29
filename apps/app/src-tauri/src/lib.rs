// Native player is Windows-only (libmpv via libmpv-2.dll + DirectComposition).
// Other platforms (Android, …) will get their own player; these stay gated.
#[cfg(windows)]
mod mpv;
#[cfg(windows)]
mod comp;

// On-device LAN setup server ("configure from another device"). All platforms.
mod config_server;

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
        let start = rx.recv().map_err(|e| e.to_string())?;
        // Own mpv instance so the composition teardown (fired by the React
        // unmount) can't terminate it.
        mpv::play_popout(&url, start)
    }
    // Popout is a Windows-only feature (native mpv window); no-op elsewhere.
    #[cfg(not(windows))]
    {
        let _ = (window, url);
        Ok(())
    }
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

/// Cross-platform HTTP GET returning the response body as text. Lets the app
/// reach AIOStreams / Xtream from the Rust side, so the webview isn't blocked by
/// browser CORS — the foundation for running self-contained, with no backend.
/// One shared client for all `http_get` calls — building a fresh reqwest client
/// per request meant a new TLS stack + no connection reuse, so a config load that
/// fans out dozens of requests (AIOStreams catalogs/enrich + Xtream EPG) paid a
/// full handshake every time. A shared client keep-alives connections per host.
static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            // Present as a browser: many AIOStreams/addon hosts (esp. behind
            // Cloudflare/WAFs) reject requests without a normal User-Agent with 403.
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            )
            // HTTP/1.1 keeps the connection fingerprint plain (some hosts flag
            // h2/rustls as a bot).
            .http1_only()
            .build()
            .expect("build shared HTTP client")
    })
}

#[tauri::command]
async fn http_get(url: String) -> Result<String, String> {
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
        .map_err(err_chain)?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    res.text().await.map_err(err_chain)
}

/// Flatten an error and its `source()` chain into one line. reqwest's top-level
/// message is only "error sending request for url (…)" — the real cause (TLS
/// handshake, DNS, connection refused, timeout, bad cert) lives in the source
/// chain, which `to_string()` drops. Keeping it makes failures diagnosable.
fn err_chain<E: std::error::Error>(e: E) -> String {
    let mut out = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        out.push_str(": ");
        out.push_str(&s.to_string());
        source = s.source();
    }
    out
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
    // reqwest 0.13 (pulled transitively by Tauri core) builds rustls clients with
    // no default crypto provider on non-Windows targets, so the first HTTPS client
    // panics ("No rustls crypto provider is configured"). Install the ring provider
    // process-wide before anything builds a client. Windows uses native-tls, so
    // this is gated off there.
    #[cfg(not(windows))]
    {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Window-state + self-updater are desktop-only; mobile gets its own story.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
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
            http_get,
            check_update,
            install_update,
            config_server::config_server_start,
            config_server::config_server_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
