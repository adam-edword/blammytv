// Minimal libmpv binding loaded at runtime from libmpv-2.dll (the same DLL the
// Electron addon used). Runtime loading avoids build-time linking against mpv.
//
// Two instances: the in-app PLAYER (rendered into a `--wid` child window,
// see inv.rs) and the POPOUT PiP (mpv's own floating window).

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

/// Locate libmpv-2.dll: next to the exe, a bundled `resources/` dir, then the
/// OS search path (covers dev — on PATH or beside the dev exe — and the
/// packaged installer, wherever the bundler drops the resource).
fn load_libmpv() -> Result<Library, String> {
    let mut tried: Vec<String> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for p in [dir.join("libmpv-2.dll"), dir.join("resources/libmpv-2.dll")] {
                match unsafe { Library::new(&p) } {
                    Ok(lib) => return Ok(lib),
                    Err(e) => tried.push(format!("{}: {e}", p.display())),
                }
            }
        }
    }
    unsafe { Library::new("libmpv-2.dll") }
        .map_err(|e| format!("load libmpv-2.dll: {e} (also tried: {})", tried.join("; ")))
}

fn lib() -> Result<&'static Lib, String> {
    if let Some(l) = LIB.get() {
        return Ok(l);
    }
    unsafe {
        let library: &'static Library = Box::leak(Box::new(load_libmpv()?));
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
// The popout PiP runs as its OWN mpv instance, separate from the in-app
// PLAYER — so tearing down the in-app player (inv::close/stop) can't kill it.
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
        // "immediate": the PiP window appears BEFORE the stream opens —
        // debrid URLs can take seconds to probe, and "yes" kept the window
        // invisible until first frame (read as a 5-10s dead click).
        set("force-window", "immediate");
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
                let ev = (l.wait_event)(h, -1.0);
                if ev.is_null() {
                    continue;
                }
                if (*ev).event_id == MPV_EVENT_SHUTDOWN {
                    break;
                }
            }
            // This thread is the handle's SOLE destroyer: terminate_destroy
            // concurrent with wait_event on the same handle is forbidden by
            // libmpv, so stop_popout() sends `quit` and lets us tear down
            // after SHUTDOWN. POPOUT ownership only decides whether the
            // close was user-driven (✕/taskbar/q → emit, so React reclaims)
            // or programmatic (already taken → stay silent; the button
            // drives the reclaim itself).
            let mut g = POPOUT.lock().unwrap();
            let ours = g.as_ref().map(|p| p.0 as usize) == Some(h as usize);
            if ours {
                g.take();
            }
            drop(g);
            let pos = if ours {
                // Best-effort final position BEFORE destroy — post-SHUTDOWN
                // reads are contract-legal; a quitting core may return
                // nothing, and 0.0 tells the frontend "no reading".
                let name = CString::new("time-pos").unwrap();
                let ptr = (l.get_property_string)(h, name.as_ptr());
                if ptr.is_null() {
                    0.0
                } else {
                    let s = std::ffi::CStr::from_ptr(ptr)
                        .to_string_lossy()
                        .into_owned();
                    (l.free)(ptr as *mut c_void);
                    s.parse::<f64>().unwrap_or(0.0)
                }
            } else {
                0.0
            };
            (l.terminate_destroy)(h);
            if ours {
                crate::emit_ui_pos("popout-closed", pos);
            }
        });
    }
    Ok(())
}

pub fn stop_popout() {
    // Programmatic close (Bring It Back / a new play while popped): take
    // the handle out of POPOUT so the watcher stays silent, then ask mpv
    // to QUIT — the watcher, the sole wait_event-er, performs the destroy
    // on SHUTDOWN. Destroying here raced its blocked wait_event on the
    // same handle (forbidden by libmpv) on every Bring It Back.
    let taken = POPOUT.lock().unwrap().take();
    if let (Some(p), Some(l)) = (taken, LIB.get()) {
        unsafe {
            let cmd = CString::new("quit").unwrap();
            let args = [cmd.as_ptr(), std::ptr::null()];
            (l.command)(p.0, args.as_ptr());
        }
    }
}

/// Render into an existing child window (`--wid`) instead of mpv's own —
/// the in-app player: native video in a child HWND at the bottom of the
/// z-order (inv.rs), under the transparent UI webview.
///
/// `composited` forces the bitblt present model (`d3d11-flip=no`) so a DComp
/// layer can be drawn over the video — a relic of the deleted comp.rs path;
/// the sole surviving caller (inv.rs) passes false, keeping mpv's default
/// flip model (the quality path, and what actually shows video embedded).
/// `start` resumes at a position; inv.rs currently always passes 0.0, so
/// popout reclaim rejoins at the live edge, not the captured position.
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

/// Absolute seek to a position in seconds — the VOD scrubber's verb
/// (mpv_seek_abs command, live since v0.2.47).
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

/// "Go to live" for a live stream: reload the current URL on the composition
/// PLAYER. A forward seek can't reach the live edge (mpv never pulled the data
/// between the playback buffer and now), so we re-`loadfile` the same path,
/// which restarts at the newest segment. Player-level options (wid, d3d11-flip,
/// volume) persist across loadfile, so only the video rebuffers — the overlay
/// stays put. Reversible: drop this and the goLive bridge/handler to restore
/// the old (non-functional) forward-seek behavior.
pub fn reload_live() {
    // get_property locks PLAYER and releases before we re-lock below.
    let url = match get_property("path") {
        Some(u) => u,
        None => return,
    };
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let cmd = CString::new("loadfile").unwrap();
            let curl = match CString::new(url) {
                Ok(c) => c,
                Err(_) => return,
            };
            let args = [cmd.as_ptr(), curl.as_ptr(), std::ptr::null()];
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

pub struct ChapterInfo {
    pub title: String,
    pub start: f64,
}

/// The file's chapter markers (the Skip Intro data source: scene files
/// often name them "Intro"/"OP"/"Recap"). Same per-index sub-property
/// pattern as track_list; bounded in case a broken mux reports absurdity.
pub fn chapter_list() -> Vec<ChapterInfo> {
    let count = get_property("chapter-list/count")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    (0..count.min(128))
        .map(|i| ChapterInfo {
            title: get_property(&format!("chapter-list/{i}/title")).unwrap_or_default(),
            start: get_property(&format!("chapter-list/{i}/time"))
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0),
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

/// Playback speed multiplier (1.0 = normal) — the VOD speed menu
/// (mpv_set_speed command).
pub fn set_speed(speed: f64) {
    set_prop("speed", &speed.to_string());
}

/// Set the GPU post-process shader chain (absolute path to a .glsl user
/// shader, or empty to clear). Runtime-safe: the vo reconfigures mid-play.
/// Used by the inverted player's frost-behind-modal (lib.rs `mpv_blur`).
pub fn set_glsl_shaders(path: &str) {
    set_prop("glsl-shaders", path);
}

/// Set shader tunables (`glsl-shader-opts`, "name=value,..."): updates
/// //!PARAM uniforms in the loaded chain WITHOUT reloading it — the cheap
/// per-frame-safe path for the moving frost rect (gpu-next required for
/// PARAM; Adam runs mpv 0.41-dev, where it's the default vo).
pub fn set_shader_opts(opts: &str) {
    set_prop("glsl-shader-opts", opts);
}

/// Write one tone-mapped frame of the current video to `path` (format from
/// the extension; "video" = no OSD). mpv_command is synchronous, so the
/// file exists when this returns true. Used for the frozen-frame glass
/// behind modals (lib.rs `mpv_snapshot`).
pub fn screenshot_to_file(path: &str) -> bool {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let cmd = CString::new("screenshot-to-file").unwrap();
            let cpath = match CString::new(path) {
                Ok(c) => c,
                Err(_) => return false,
            };
            let flags = CString::new("video").unwrap();
            let args = [
                cmd.as_ptr(),
                cpath.as_ptr(),
                flags.as_ptr(),
                std::ptr::null(),
            ];
            return (l.command)(p.0, args.as_ptr()) >= 0;
        }
    }
    false
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
