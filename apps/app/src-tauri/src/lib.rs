mod mpv;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![mpv_play, mpv_set_pause, mpv_stop])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
