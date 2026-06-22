mod mpv;
#[cfg(windows)]
mod comp;

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
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(comp::theater(
                    hwnd, x, y, w, h, radius, &url, &overlay_url, &meta_json,
                ));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url, overlay_url, meta_json, x, y, w, h, radius);
        Ok(())
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
                comp::close_theater();
                let _ = tx.send(());
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?;
    }
    // Own mpv instance so the composition teardown (fired by the React unmount)
    // can't terminate it.
    mpv::play_popout(&url)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            comp_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
