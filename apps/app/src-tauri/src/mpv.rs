// Minimal libmpv binding loaded at runtime from libmpv-2.dll (the same DLL the
// Electron addon used). Runtime loading avoids build-time linking against mpv.
//
// Two instances: the composition PLAYER (rendered into a `--wid` child window,
// see comp.rs) and the POPOUT PiP (mpv's own floating window).

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
type FnWaitEvent = unsafe extern "C" fn(Handle, f64) -> *mut MpvEvent;
type FnTerminateDestroy = unsafe extern "C" fn(Handle);

// Just the leading field we need (matches `struct mpv_event`).
#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    _error: c_int,
    _reply_userdata: u64,
    _data: *mut c_void,
}
const MPV_EVENT_SHUTDOWN: c_int = 1;

// Move an mpv handle into the event-watcher thread (guarded by the POPOUT mutex).
struct SendHandle(Handle);
unsafe impl Send for SendHandle {}

struct Lib {
    create: FnCreate,
    set_option_string: FnSetOptionString,
    initialize: FnInitialize,
    command: FnCommand,
    set_property_string: FnSetPropertyString,
    get_property_string: FnGetPropertyString,
    free: FnFree,
    wait_event: FnWaitEvent,
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
            wait_event: std::mem::transmute::<_, FnWaitEvent>(sym(b"mpv_wait_event\0")?),
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
pub fn play_popout(url: &str, start: f64) -> Result<(), String> {
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
        // Resume where the in-app player was (VOD); 0 for live.
        if start > 0.0 {
            set("start", &start.to_string());
        }
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

        // Watch the popout's events: when its window is closed (✕ / taskbar / q),
        // mpv emits SHUTDOWN — we must terminate it, else it hangs in-process and
        // a force-close takes the whole app down.
        let sh = SendHandle(h);
        std::thread::spawn(move || {
            let sh = sh; // capture the whole (Send) wrapper, not the raw ptr field
            let h = sh.0;
            let l = match LIB.get() {
                Some(l) => l,
                None => return,
            };
            loop {
                let ev = unsafe { (l.wait_event)(h, -1.0) };
                if ev.is_null() {
                    continue;
                }
                if unsafe { (*ev).event_id } == MPV_EVENT_SHUTDOWN {
                    break;
                }
            }
            // Destroy only if POPOUT still holds this handle (else stop_popout
            // already took ownership — avoid a double terminate_destroy).
            let mut g = POPOUT.lock().unwrap();
            let ours = g.as_ref().map(|p| p.0 as usize) == Some(h as usize);
            let taken = if ours { g.take() } else { None };
            drop(g);
            if let Some(p) = taken {
                unsafe { (l.terminate_destroy)(p.0) };
                // The user closed the popout window (we still owned it) → tell
                // React to bring the in-app player back. A programmatic
                // stop_popout() takes ownership first, so `taken` is None there
                // and we stay silent (the button drives the reclaim itself).
                crate::emit_comp("popout-closed");
            }
        });
    }
    Ok(())
}

pub fn stop_popout() {
    if let (Some(p), Some(l)) = (POPOUT.lock().unwrap().take(), LIB.get()) {
        unsafe { (l.terminate_destroy)(p.0) };
    }
}

/// Render into an existing child window (`--wid`) instead of mpv's own — for the
/// Tauri composition path: native video in a child HWND, webview composited over.
///
/// `composited` forces the bitblt present model (`d3d11-flip=no`) so a DComp layer
/// can be drawn over the video. Left off, mpv uses its default flip model — which
/// is what actually shows video when embedded; bitblt into a `--wid` child often
/// renders nothing.
pub fn play_wid(url: &str, wid: isize, composited: bool, start: f64) -> Result<(), String> {
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
        // Resume at a position when reclaiming from the popout (0 otherwise).
        if start > 0.0 {
            set("start", &start.to_string());
        }
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

/// Current playback position of the popout window (seconds), or 0.0 if none.
/// Reads under the POPOUT lock so it's safe against stop_popout().
pub fn popout_pos() -> f64 {
    let g = POPOUT.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let name = CString::new("time-pos").unwrap();
            let ptr = (l.get_property_string)(p.0, name.as_ptr());
            if !ptr.is_null() {
                let s = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
                (l.free)(ptr as *mut c_void);
                return s.parse::<f64>().unwrap_or(0.0);
            }
        }
    }
    0.0
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

/// Absolute seek to a position in seconds (for scrubbing).
pub fn seek_abs(pos: f64) {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let cmd = CString::new("seek").unwrap();
            let d = CString::new(format!("{pos}")).unwrap();
            let abs = CString::new("absolute").unwrap();
            let args = [cmd.as_ptr(), d.as_ptr(), abs.as_ptr(), std::ptr::null()];
            (l.command)(p.0, args.as_ptr());
        }
    }
}

pub fn stop() {
    if let (Some(p), Some(l)) = (PLAYER.lock().unwrap().take(), LIB.get()) {
        unsafe { (l.terminate_destroy)(p.0) };
    }
}

/// One entry from mpv's `track-list` (audio / sub / video).
pub struct TrackInfo {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub lang: String,
    pub selected: bool,
}

/// Read the current track list via mpv's `track-list/...` string sub-properties.
pub fn track_list() -> Vec<TrackInfo> {
    let count = get_property("track-list/count")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    (0..count)
        .map(|i| TrackInfo {
            id: get_property(&format!("track-list/{i}/id"))
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            kind: get_property(&format!("track-list/{i}/type")).unwrap_or_default(),
            title: get_property(&format!("track-list/{i}/title")).unwrap_or_default(),
            lang: get_property(&format!("track-list/{i}/lang")).unwrap_or_default(),
            selected: get_property(&format!("track-list/{i}/selected")).as_deref()
                == Some("yes"),
        })
        .collect()
}

/// Set a string property on the player (no-op if there's no player).
fn set_prop(name: &str, value: &str) {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let (k, v) = (
                CString::new(name).unwrap(),
                CString::new(value).unwrap(),
            );
            (l.set_property_string)(p.0, k.as_ptr(), v.as_ptr());
        }
    }
}

/// Select an audio ("audio") or subtitle ("sub") track. `id` is a track id, or
/// "no" (off) / "auto".
pub fn set_track(kind: &str, id: &str) {
    let prop = match kind {
        "audio" => "aid",
        "sub" => "sid",
        _ => return,
    };
    set_prop(prop, id);
}

/// Playback speed multiplier (1.0 = normal).
pub fn set_speed(speed: f64) {
    set_prop("speed", &speed.to_string());
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
