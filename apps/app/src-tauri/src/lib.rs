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

#[tauri::command]
fn mpv_play(url: String) -> Result<(), String> {
    mpv::play(&url)
}

#[tauri::command]
fn mpv_set_pause(paused: bool) {
    mpv::set_pause(paused);
}

#[tauri::command]
fn mpv_stop() {
    mpv::stop();
}

// Log the mpv colour pipeline (HDR diagnosis); tag distinguishes theater vs fullscreen.
#[tauri::command]
fn mpv_color_diag(tag: String) {
    mpv::log_color_diag(&tag);
}

// Telly-way composition spike, Step 1: composite a semi-transparent blue GPU
// layer over the window via DirectComposition. Runs on the UI thread.
#[tauri::command]
fn comp_color_test(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let (w, h) = (size.width, size.height);
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(comp::color_test(hwnd, w, h));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(())
    }
}

// Diagnostic: mpv embedded in a bare child window (no DComp / webview).
#[tauri::command]
fn comp_mpv_child(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let (w, h) = (size.width, size.height);
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(comp::mpv_child(hwnd, w, h, &url));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, url);
        Ok(())
    }
}

// Step 3 / Milestone 1: native mpv child window with the composition WebView2
// over it, the webview loading the real app (overlay mode) transparent on top.
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

// Step 2: a composition-hosted WebView2 (transparent) over the blue layer.
#[tauri::command]
fn comp_webview_test(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let (w, h) = (size.width, size.height);
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(comp::webview_test(hwnd, w, h));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
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
            mpv_play,
            mpv_set_pause,
            mpv_stop,
            mpv_color_diag,
            comp_color_test,
            comp_webview_test,
            comp_mpv_child,
            comp_theater,
            comp_set_rect,
            comp_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
