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
type FnGetPropertyString = unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char;
type FnFree = unsafe extern "C" fn(*mut c_void);
type FnTerminateDestroy = unsafe extern "C" fn(Handle);

struct Lib {
    create: FnCreate,
    set_option_string: FnSetOptionString,
    initialize: FnInitialize,
    command: FnCommand,
    set_property_string: FnSetPropertyString,
    get_property_string: FnGetPropertyString,
    free: FnFree,
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
            get_property_string: std::mem::transmute::<_, FnGetPropertyString>(
                sym(b"mpv_get_property_string\0")?,
            ),
            free: std::mem::transmute::<_, FnFree>(sym(b"mpv_free\0")?),
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
// The popout PiP runs as its OWN mpv instance, separate from the composition
// PLAYER — so tearing down the in-app player (close_theater/stop) can't kill it.
static POPOUT: Mutex<Option<Player>> = Mutex::new(None);

/// Play in mpv's own floating window (PiP): on-top, half-size, separate instance.
pub fn play_popout(url: &str) -> Result<(), String> {
    let l = lib()?;
    stop_popout();
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
        // Float above the app at a sensible size, else it opens behind BlammyTV.
        set("ontop", "yes");
        set("autofit", "50%");
        // Borderless — a clean PiP, no Windows title bar (still drag/resizable).
        set("border", "no");
        set("hwdec", "auto-safe");
        set("audio-channels", "stereo");
        set("title", "BlammyTV — Popout");
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
        *POPOUT.lock().unwrap() = Some(Player(h));
    }
    Ok(())
}

pub fn stop_popout() {
    if let (Some(p), Some(l)) = (POPOUT.lock().unwrap().take(), LIB.get()) {
        unsafe { (l.terminate_destroy)(p.0) };
    }
}

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
///
/// `composited` forces the bitblt present model (`d3d11-flip=no`) so a DComp layer
/// can be drawn over the video. Left off, mpv uses its default flip model — which
/// is what actually shows video when embedded; bitblt into a `--wid` child often
/// renders nothing.
pub fn play_wid(url: &str, wid: isize, composited: bool) -> Result<(), String> {
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
        // NOTE: the theater/fullscreen brightness difference is NOT mpv — its
        // output is byte-identical SDR (R8G8B8A8_UNORM, sRGB) in both states
        // (verified via diagnostics). It's a Windows presentation quirk (DWM
        // composition windowed vs independent-flip/overlay fullscreen). The real
        // fix is rendering mpv into a DComp composition swapchain (render API).
        if composited {
            // Present through DWM (bitblt) so the DComp webview can composite over it.
            set("d3d11-flip", "no");
        }
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

pub fn set_mute(muted: bool) {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let (k, v) = (
                CString::new("mute").unwrap(),
                CString::new(if muted { "yes" } else { "no" }).unwrap(),
            );
            (l.set_property_string)(p.0, k.as_ptr(), v.as_ptr());
        }
    }
}

/// Volume on mpv's 0..100 scale (can exceed 100, but the UI sends 0..100).
pub fn set_volume(vol: i64) {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let (k, v) = (
                CString::new("volume").unwrap(),
                CString::new(vol.to_string()).unwrap(),
            );
            (l.set_property_string)(p.0, k.as_ptr(), v.as_ptr());
        }
    }
}

/// Relative seek in seconds (negative = back).
pub fn seek(delta: f64) {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let cmd = CString::new("seek").unwrap();
            let d = CString::new(format!("{delta}")).unwrap();
            let rel = CString::new("relative").unwrap();
            let args = [cmd.as_ptr(), d.as_ptr(), rel.as_ptr(), std::ptr::null()];
            (l.command)(p.0, args.as_ptr());
        }
    }
}

pub fn stop() {
    if let (Some(p), Some(l)) = (PLAYER.lock().unwrap().take(), LIB.get()) {
        unsafe { (l.terminate_destroy)(p.0) };
    }
}

/// Read an mpv property as a string (via the player mutex, so it's safe against
/// stop()/terminate). Returns None if no player or the property is empty/unset.
pub fn get_property(name: &str) -> Option<String> {
    let g = PLAYER.lock().unwrap();
    let (p, l) = (g.as_ref()?, LIB.get()?);
    unsafe {
        let cname = CString::new(name).ok()?;
        let ptr = (l.get_property_string)(p.0, cname.as_ptr());
        if ptr.is_null() {
            return None;
        }
        let s = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
        (l.free)(ptr as *mut c_void);
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

fn mpv_log_path() -> String {
    std::env::temp_dir()
        .join("blammytv-mpv.log")
        .to_string_lossy()
        .into_owned()
}

/// Surface the swapchain/HDR lines mpv wrote to its log — the resolved output
/// colorspace (windowed vs fullscreen), which the `target-*` properties hide.
fn log_swapchain_lines(tag: &str) {
    let Ok(text) = std::fs::read_to_string(mpv_log_path()) else {
        return;
    };
    // Target the d3d11 swapchain/colorspace decision; exclude libplacebo shader
    // source (which spams "pq"/"tone"/"peak" from GLSL, not actual output state).
    let hits: Vec<&str> = text
        .lines()
        .filter(|l| {
            let low = l.to_lowercase();
            if low.contains("libplacebo") {
                return false;
            }
            low.contains("swapchain")
                || low.contains("dxgi")
                || low.contains("scrgb")
                || low.contains("hdr10")
                || low.contains("color space")
                || (low.contains("d3d11") && (low.contains("color") || low.contains("hdr")))
        })
        .collect();
    // Last few are the most recent (current window state).
    for l in hits.iter().rev().take(6).rev() {
        log::info!("[swapchain {tag}] {l}");
    }
    if hits.is_empty() {
        log::info!("[swapchain {tag}] (no swapchain/colorspace lines in mpv log)");
    }
}

/// Log the actual colour pipeline — to settle whether the theater/fullscreen
/// brightness difference is HDR (source gamma/primaries vs what mpv outputs).
pub fn log_color_diag(tag: &str) {
    let props = [
        "video-params/gamma",      // pq/hlg = HDR source, bt.1886/etc = SDR
        "video-params/primaries",  // bt.2020 = wide gamut
        "video-params/sig-peak",   // >1 = HDR source
        "target-trc",              // what mpv outputs to
        "target-prim",
        "target-peak",
        "current-vo",
        "dwidth",
        "dheight",
    ];
    let mut out = String::new();
    for p in props {
        let v = get_property(p).unwrap_or_else(|| "?".into());
        out.push_str(&format!("{p}={v}  "));
    }
    log::info!("[color-diag {tag}] {out}");
    log_swapchain_lines(tag);
}
