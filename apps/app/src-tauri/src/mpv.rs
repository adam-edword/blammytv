// Minimal libmpv binding loaded at runtime from libmpv-2.dll (the same DLL the
// Electron addon used). Runtime loading avoids build-time linking against mpv.
//
// Milestone 1: prove libmpv runs inside the Tauri/Rust shell by playing a stream
// in mpv's own window (force-window). The render-into-the-webview compositing
// comes next; this confirms the stack end-to-end.

use libloading::Library;
use std::ffi::CString;
use std::os::raw::{c_char, c_int, c_void};
use std::sync::{Mutex, OnceLock};

type Handle = *mut c_void;

type FnCreate = unsafe extern "C" fn() -> Handle;
type FnSetOptionString = unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int;
type FnInitialize = unsafe extern "C" fn(Handle) -> c_int;
type FnCommand = unsafe extern "C" fn(Handle, *const *const c_char) -> c_int;
type FnSetPropertyString = unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int;
type FnTerminateDestroy = unsafe extern "C" fn(Handle);

struct Lib {
    create: FnCreate,
    set_option_string: FnSetOptionString,
    initialize: FnInitialize,
    command: FnCommand,
    set_property_string: FnSetPropertyString,
    terminate_destroy: FnTerminateDestroy,
}
// The function pointers are plain C functions; access is serialized via the
// player Mutex.
unsafe impl Send for Lib {}
unsafe impl Sync for Lib {}

static LIB: OnceLock<Lib> = OnceLock::new();

fn lib() -> Result<&'static Lib, String> {
    if let Some(l) = LIB.get() {
        return Ok(l);
    }
    unsafe {
        let library: &'static Library = Box::leak(Box::new(
            Library::new("libmpv-2.dll")
                .map_err(|e| format!("load libmpv-2.dll: {e} (is it next to the exe / on PATH?)"))?,
        ));
        let sym = |name: &[u8]| -> Result<*const c_void, String> {
            library
                .get::<*const c_void>(name)
                .map(|s| *s)
                .map_err(|e| format!("missing symbol {}: {e}", String::from_utf8_lossy(name)))
        };
        let l = Lib {
            create: std::mem::transmute::<_, FnCreate>(sym(b"mpv_create\0")?),
            set_option_string: std::mem::transmute::<_, FnSetOptionString>(
                sym(b"mpv_set_option_string\0")?,
            ),
            initialize: std::mem::transmute::<_, FnInitialize>(sym(b"mpv_initialize\0")?),
            command: std::mem::transmute::<_, FnCommand>(sym(b"mpv_command\0")?),
            set_property_string: std::mem::transmute::<_, FnSetPropertyString>(
                sym(b"mpv_set_property_string\0")?,
            ),
            terminate_destroy: std::mem::transmute::<_, FnTerminateDestroy>(
                sym(b"mpv_terminate_destroy\0")?,
            ),
        };
        let _ = LIB.set(l);
        Ok(LIB.get().unwrap())
    }
}

struct Player(Handle);
// Single instance, guarded by the Mutex below.
unsafe impl Send for Player {}

static PLAYER: Mutex<Option<Player>> = Mutex::new(None);

pub fn play(url: &str) -> Result<(), String> {
    let l = lib()?;
    stop();
    unsafe {
        let h = (l.create)();
        if h.is_null() {
            return Err("mpv_create failed".into());
        }
        let set = |k: &str, v: &str| {
            let (ck, cv) = (CString::new(k).unwrap(), CString::new(v).unwrap());
            (l.set_option_string)(h, ck.as_ptr(), cv.as_ptr());
        };
        set("force-window", "yes");
        set("hwdec", "auto-safe");
        // Downmix surround (AC3/E-AC3 5.1) to clean stereo for desktop output —
        // matches the Electron path; native 5.1 on a stereo device sounds rough.
        set("audio-channels", "stereo");
        set("title", "BlammyTV (Tauri)");
        set("osc", "yes");
        set("terminal", "no");
        if (l.initialize)(h) < 0 {
            (l.terminate_destroy)(h);
            return Err("mpv_initialize failed".into());
        }
        let load = CString::new("loadfile").unwrap();
        let curl = CString::new(url).map_err(|_| "url has a null byte")?;
        let args = [load.as_ptr(), curl.as_ptr(), std::ptr::null()];
        if (l.command)(h, args.as_ptr()) < 0 {
            (l.terminate_destroy)(h);
            return Err("loadfile failed".into());
        }
        *PLAYER.lock().unwrap() = Some(Player(h));
    }
    Ok(())
}

/// Render into an existing child window (`--wid`) instead of mpv's own — for the
/// Tauri composition path: native video in a child HWND, webview composited over.
pub fn play_wid(url: &str, wid: isize) -> Result<(), String> {
    let l = lib()?;
    stop();
    unsafe {
        let h = (l.create)();
        if h.is_null() {
            return Err("mpv_create failed".into());
        }
        let set = |k: &str, v: &str| {
            let (ck, cv) = (CString::new(k).unwrap(), CString::new(v).unwrap());
            (l.set_option_string)(h, ck.as_ptr(), cv.as_ptr());
        };
        set("wid", &wid.to_string());
        set("hwdec", "auto-safe");
        // Present through DWM (bitblt) so the DComp webview can composite over it.
        set("d3d11-flip", "no");
        set("audio-channels", "stereo");
        set("terminal", "no");
        if (l.initialize)(h) < 0 {
            (l.terminate_destroy)(h);
            return Err("mpv_initialize failed".into());
        }
        let load = CString::new("loadfile").unwrap();
        let curl = CString::new(url).map_err(|_| "url has a null byte")?;
        let args = [load.as_ptr(), curl.as_ptr(), std::ptr::null()];
        if (l.command)(h, args.as_ptr()) < 0 {
            (l.terminate_destroy)(h);
            return Err("loadfile failed".into());
        }
        *PLAYER.lock().unwrap() = Some(Player(h));
    }
    Ok(())
}

pub fn set_pause(paused: bool) {
    let mut g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_mut(), LIB.get()) {
        unsafe {
            let (k, v) = (
                CString::new("pause").unwrap(),
                CString::new(if paused { "yes" } else { "no" }).unwrap(),
            );
            (l.set_property_string)(p.0, k.as_ptr(), v.as_ptr());
        }
    }
}

pub fn stop() {
    if let (Some(p), Some(l)) = (PLAYER.lock().unwrap().take(), LIB.get()) {
        unsafe { (l.terminate_destroy)(p.0) };
    }
}
