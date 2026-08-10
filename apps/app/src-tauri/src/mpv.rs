// Minimal libmpv binding loaded at runtime from libmpv-2.dll (the same DLL the
// Electron addon used). Runtime loading avoids build-time linking against mpv.
//
// Two instances: the in-app PLAYER (rendered into a `--wid` child window,
// see inv.rs) and the POPOUT PiP (mpv's own floating window).

use libloading::Library;
use std::ffi::CString;
use std::os::raw::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
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
/// The `wid` the live PLAYER was initialized against. `wid` is an INIT-ONLY
/// mpv option, so the instance renders into that window for its whole life
/// and ensure_player has nothing to do with the argument on the reuse path.
/// Recording it turns "asked to play into a different window" from a silent
/// render-into-a-dead-window into an error — the coupling between
/// inv::CHILD and PLAYER is otherwise asserted nowhere and split across two
/// files.
static PLAYER_WID: AtomicIsize = AtomicIsize::new(0);
// The popout PiP runs as its OWN mpv instance, separate from the in-app
// PLAYER — so tearing down the in-app player (inv::close/stop) can't kill it.
static POPOUT: Mutex<Option<Player>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Status-poll instrumentation (plan 011).
//
// mpv_status runs every 500ms as a SYNC command, which on Windows means it
// executes inside WebView2's callback — on the UI thread. Each property read
// below takes the PLAYER mutex and does an FFI round trip plus two heap
// allocations, and track_list/chapter_list issue one per FIELD per entry. The
// open question this answers with numbers instead of arithmetic: what does
// one poll actually cost, and how much of it is the static track/chapter data
// being re-read twice a second for a file whose tracks cannot change?
//
// Cost of the instrument itself: one relaxed atomic per property read and
// three Instant::elapsed per poll. It stays compiled in — the report is only
// built when asked for, and a counter that is only true in a special build is
// a counter you cannot ask a user to run.

/// Every get_property call, from anywhere. The poll's own segment timings say
/// how long; this says how many.
static PROP_READS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Default)]
pub struct StatusPerf {
    pub calls: u64,
    pub props: u64,
    pub scalars_us: u64,
    pub tracks_us: u64,
    pub chapters_us: u64,
    pub total_us: u64,
    pub max_us: u64,
    /// Polls that took longer than one 60Hz frame. A sync command that
    /// overruns a frame on the UI thread is a dropped frame's worth of jank.
    pub over_16ms: u64,
}

static PERF: Mutex<StatusPerf> = Mutex::new(StatusPerf {
    calls: 0,
    props: 0,
    scalars_us: 0,
    tracks_us: 0,
    chapters_us: 0,
    total_us: 0,
    max_us: 0,
    over_16ms: 0,
});

/// Fold one mpv_status call into the accumulator.
pub fn perf_record(scalars_us: u64, tracks_us: u64, chapters_us: u64, total_us: u64) {
    let Ok(mut p) = PERF.lock() else { return };
    p.calls += 1;
    p.scalars_us += scalars_us;
    p.tracks_us += tracks_us;
    p.chapters_us += chapters_us;
    p.total_us += total_us;
    p.max_us = p.max_us.max(total_us);
    if total_us > 16_000 {
        p.over_16ms += 1;
    }
    p.props = PROP_READS.load(Ordering::Relaxed);
}

/// Read the accumulator; `reset` zeroes it so a report covers a known window.
pub fn perf_snapshot(reset: bool) -> StatusPerf {
    let Ok(mut p) = PERF.lock() else {
        return StatusPerf::default();
    };
    let out = *p;
    if reset {
        *p = StatusPerf::default();
        PROP_READS.store(0, Ordering::Relaxed);
    }
    out
}

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
        // KEYS, not just the OSC bar. `osc` is a Lua script, so if it does
        // not load there is no control of any kind on this window — and
        // libmpv defaults BOTH of these to no, so mpv's own keybinds were
        // dead here even though its bar was asked for. With them, 9 and 0
        // move the volume, m mutes, space pauses, arrows seek, f goes
        // fullscreen: the popout stops being a window you can only watch.
        set("input-default-bindings", "yes");
        set("input-vo-keyboard", "yes");
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
    //
    // THE GUARD IS HELD ACROSS THE QUIT, and that is the whole point of the
    // binding. Taking the handle out and releasing the lock first left a
    // window where the watcher — which can reach SHUTDOWN on its own, from
    // a ✕ or a `q` — locked POPOUT, saw None, decided the close was not
    // ours, and ran terminate_destroy on the very handle being commanded
    // here. Microseconds wide, but play_wid calls this on EVERY in-app
    // tune, so closing the PiP and clicking a channel together is enough.
    //
    // Holding it makes the watcher block until `quit` has returned. No
    // deadlock: quit only queues the shutdown, it does not wait for the
    // watcher, and the watcher takes this same lock only after wait_event
    // has already returned.
    let mut g = POPOUT.lock().unwrap();
    let taken = g.take();
    if let (Some(p), Some(l)) = (taken, LIB.get()) {
        unsafe {
            let cmd = CString::new("quit").unwrap();
            let args = [cmd.as_ptr(), std::ptr::null()];
            (l.command)(p.0, args.as_ptr());
        }
    }
    drop(g);
}

/// Render into an existing child window (`--wid`) instead of mpv's own —
/// the in-app player: native video in a child HWND at the bottom of the
/// z-order (inv.rs), under the transparent UI webview.
///
/// Create the in-app player ONCE, bound to `wid`, and keep it for the life of
/// the process (plan 012 phase 1).
///
/// `wid` is an INIT-ONLY option: a handle renders into the window it was
/// initialized against and cannot be repointed. That is why the child window
/// became permanent too (inv.rs) — the two lifetimes are married.
///
/// Before this, every tune destroyed the instance and built a new one, which
/// cost a full `terminate_destroy` (blocking until the demuxer and network
/// threads unwound) plus create plus initialize, synchronously, on the UI
/// thread, before `loadfile` was even queued. Stremio's shell — same stack,
/// WebView2 + mpv + Rust — creates its handle once and issues `loadfile` per
/// video; see plans/012-player-events.md.
///
/// A no-op once the player exists, so it is cheap to call on every play.
fn ensure_player(wid: isize) -> Result<(), String> {
    // lib() does not touch PLAYER, but resolve it before locking anyway so
    // the guard is held across as little as possible.
    let l = lib()?;
    let mut g = PLAYER.lock().unwrap();
    if g.is_some() {
        let bound = PLAYER_WID.load(Ordering::Relaxed);
        if bound != wid {
            return Err(format!(
                "player is bound to window {bound}, cannot re-target to {wid}"
            ));
        }
        return Ok(());
    }
    let t0 = std::time::Instant::now();
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
        set("audio-channels", "stereo");
        set("terminal", "no");
        // Explicit, not load-bearing: libmpv already defaults idle=yes, so
        // this documents the requirement rather than creating it. The
        // requirement is real — without idle, a `stop` or a file reaching its
        // end shuts the core down and the next loadfile has nothing to load
        // into, which would make the persistent instance a one-shot player.
        set("idle", "yes");
        // KEEP THE VO ALIVE BETWEEN FILES, painting black.
        //
        // This is what replaces the old "destroy the window and make a fresh
        // SS_BLACKRECT STATIC" trick. With a persistent window, the moment
        // between unloading one stream and the next one's first frame has to
        // be filled by SOMETHING: the top-level window is transparent and the
        // frontend holds a clip hole open while tuning, so an unpainted child
        // is a hole straight through to the desktop — which is exactly what a
        // channel switch flashed. mpv's own idle window is black, so letting
        // it keep the VO is both the fix and the idiomatic answer.
        set("force-window", "yes");
        if (l.initialize)(h) < 0 {
            (l.terminate_destroy)(h);
            return Err("mpv_initialize failed".into());
        }
        *g = Some(Player(h));
        PLAYER_WID.store(wid, Ordering::Relaxed);
    }
    // DROP THE GUARD before reading a property: get_property takes the same
    // PLAYER lock, so asking while still holding it deadlocks.
    drop(g);
    // Which libmpv did the loader actually find? Once per PROCESS now. It
    // used to print from inv::open, whose "once per open" was true only
    // while every open built a new instance — after v0.8.168 that fired on
    // every channel switch to report a value that can no longer change.
    if let Some(v) = get_property("mpv-version") {
        println!("[mpv] {v}");
    }
    // Once per process now, not once per tune.
    println!("[mpv-timing] create+init {}ms (once)", t0.elapsed().as_millis());
    Ok(())
}

/// Per-FILE state, reset on every load.
///
/// A fresh instance used to reset these for free, and the frontend leans on
/// it — TheaterOverlay: "a fresh mpv instance per stream means the real rate
/// resets to 1 on every switch". With one persistent instance nothing resets
/// itself, so a 1.5x VOD would hand 1.5x to the next live channel, and the
/// previous file's track choice would leak into a file that has different
/// tracks. Reproduce the old defaults explicitly; the frontend re-applies
/// remembered preferences afterwards, exactly as it did before.
fn reset_per_file() {
    // SHADERS TOO. glsl-shaders/glsl-shader-opts are set at runtime by
    // mpv_frost/mpv_blur for the Settings glass and are neither init options
    // nor cleared by anything else — a fresh instance per stream used to drop
    // them for free, so a persistent one carries the last frost chain into
    // the next stream. Restoring the old default here is the whole job of
    // this function.
    set_prop("glsl-shaders", "");
    set_prop("glsl-shader-opts", "");
    // PAUSE FIRST, and never remove it. mpv reports core-idle="yes" while
    // paused, and mpv_status reads core-idle to decide whether the first
    // frame has landed — so an instance that is still paused from the last
    // file can never report `presenting`, the clip hole stays shut, loading
    // never clears, and the tune watchdog declares a perfectly healthy
    // stream dead. On VOD it then burns the auto-failover stepping through
    // every remaining source, which is exactly what "no VOD loads, it just
    // buffers until the error" looked like. TheaterOverlay's togglePlay
    // carries the same warning for the same reason.
    //
    // A fresh instance per stream reset this for free. Nothing does now.
    set_prop("pause", "no");
    set_prop("speed", "1");
    set_prop("aid", "auto");
    set_prop("sid", "auto");
}

/// Start `url` in the in-app player, creating the player on first use.
pub fn play_wid(url: &str, wid: isize) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    ensure_player(wid)?;
    // One provider connection at a time is the app-wide invariant, and it was
    // enforced per-CALLER before: popout_open tears the in-app player down,
    // play_popout defends against a stale popout, and StreamScreen calls
    // popout_stop — while LiveScreen has no popped state at all. So the
    // reverse edge was missing: pop out a live channel (whose stated purpose
    // is browsing the EPG), click any channel in the guide — the intended
    // next action — and both instances ran. Double audio, two connections,
    // and an outright failed tune on a max_connections=1 line. Enforcing it
    // HERE keeps it structural. Safe against deadlock: PLAYER and POPOUT are
    // independent mutexes and stop_popout drops POPOUT's before the quit.
    stop_popout();
    let t_ready = t0.elapsed();
    reset_per_file();
    // `loadfile <url> replace` — replace is the default, stated for the
    // reader. This is the same call reload_live() has always made, which is
    // why the load path itself is proven rather than new.
    {
        let g = PLAYER.lock().unwrap();
        let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) else {
            return Err("no player".into());
        };
        unsafe {
            let load = CString::new("loadfile").unwrap();
            let curl = CString::new(url).map_err(|_| "url has a null byte")?;
            let mode = CString::new("replace").unwrap();
            let args = [
                load.as_ptr(),
                curl.as_ptr(),
                mode.as_ptr(),
                std::ptr::null(),
            ];
            if (l.command)(p.0, args.as_ptr()) < 0 {
                return Err("loadfile failed".into());
            }
        }
    }
    // `queued` is loadfile RETURNING, not the stream being open: mpv opens it
    // on its own thread, so anything after this is probe and network and
    // shows up as the delay to first frame, not here. Teardown is gone from
    // this line on purpose — there isn't one any more.
    println!(
        "[mpv-timing] ready {}ms  queued {}ms",
        t_ready.as_millis(),
        t0.elapsed().as_millis(),
    );
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
    both("mute", if muted { "yes" } else { "no" });
}

/// Set a property on whichever player is actually playing.
///
/// Volume and mute reached PLAYER only, so while popped out they did
/// NOTHING: the PiP is a second mpv handle in POPOUT, and the inline one
/// is stopped. To the user it is one volume control, so it has to reach one
/// of two handles without knowing which.
///
/// The two locks are taken in SEPARATE statements, not together in one
/// expression, so neither is held while the other is acquired. Each is held
/// across a property set, which is a fast call into libmpv, and never
/// across a destroy — that is the pattern that races the watcher.
fn both(name: &str, value: &str) {
    let (Ok(k), Ok(v)) = (CString::new(name), CString::new(value)) else {
        return;
    };
    let Some(l) = LIB.get() else { return };
    if let Some(p) = PLAYER.lock().unwrap().as_ref() {
        unsafe { (l.set_property_string)(p.0, k.as_ptr(), v.as_ptr()) };
    }
    if let Some(p) = POPOUT.lock().unwrap().as_ref() {
        unsafe { (l.set_property_string)(p.0, k.as_ptr(), v.as_ptr()) };
    }
}

/// Volume on mpv's 0..100 scale (can exceed 100, but the UI sends 0..100).
pub fn set_volume(vol: i64) {
    both("volume", &vol.to_string());
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
    // UNPAUSE FIRST. This is the tune watchdog's silent recovery as well as
    // the user's go-live button, and mpv reports core-idle="yes" while
    // paused — so reloading a paused player can never reach `presenting`,
    // the watchdog's own recovery can never clear `loading`, and it retries
    // until it declares a live stream dead. Reachable by pausing, then
    // having the stream die under you. Deliberately NOT a full
    // reset_per_file: this reloads the SAME file, so the user's audio and
    // subtitle choices must survive it.
    set_prop("pause", "no");
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

/// Unload whatever is playing, keeping the instance alive for the next load.
///
/// **THE PROVIDER CONNECTION MUST BE RELEASED HERE.** This is the single
/// point the app's one-connection-at-a-time invariant now rests on, and it is
/// not a stylistic rule: a `max_connections=1` line outright fails to tune
/// when a second stream is open (see play_wid). While the instance was
/// destroyed per switch, the connection went with it and nothing had to be
/// deliberate. Now it does.
///
/// mpv's `stop` unloads the file, which tears down that file's demuxer and
/// stream layer, and the socket closes with it. VERIFIED on a real provider
/// (v0.8.172): after stopping, the sidebar's n/m badge drops to 0. If that
/// ever stops being true, the fix is contained to THIS function — swap the
/// `stop` command for `shutdown()` and take the teardown cost back on
/// switches only. Nothing else in the app needs to know.
pub fn unload() {
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
            let cmd = CString::new("stop").unwrap();
            let args = [cmd.as_ptr(), std::ptr::null()];
            (l.command)(p.0, args.as_ptr());
        }
    }
}

/// Tear the instance down for good. Process exit, not stream switching —
/// switching uses `unload`.
///
/// Taken in its own statement so the guard DROPS before the destroy. In an
/// `if let` scrutinee the temporary lives to the end of the block, so the
/// mutex was held across terminate_destroy, which blocks until the core,
/// demuxer and network threads unwind — hundreds of ms on a live stream.
/// stop_popout already does it this way; the two disagreed.
///
/// Reached only through `inv::destroy`, which is not wired to an exit hook
/// yet — see its comment. It is also the documented fallback if `unload`
/// turns out not to release the provider connection.
#[allow(dead_code)]
pub fn shutdown() {
    let taken = PLAYER.lock().unwrap().take();
    if let (Some(p), Some(l)) = (taken, LIB.get()) {
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
    // Clamped like chapter_list, and for the same reason it gives: a
    // broken mux can report absurdity, and this issues FIVE property reads
    // per entry on the UI thread every 500ms while the overlay polls.
    let count = count.min(128);
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
/// `set_prop` for the diagnostic command. Same function, exported, so the
/// A/B path cannot drift from the one the app itself uses.
pub fn set_prop_pub(name: &str, value: &str) {
    set_prop(name, value);
}

/// `get_property` for the diagnostic command, for the same reason.
pub fn get_prop_pub(name: &str) -> Option<String> {
    get_property(name)
}

fn set_prop(name: &str, value: &str) {
    // BUILT BEFORE THE LOCK, and not unwrapped. `value` reaches here from
    // the frontend (mpv_track's id), so an interior NUL panics — and a sync
    // command runs inside WebView2's extern "system" callback, where an
    // unwind across the FFI boundary aborts the process rather than failing
    // the call. Doing it before the lock also means a bad value cannot
    // poison the mutex and take every later mpv command with it.
    let (Ok(k), Ok(v)) = (CString::new(name), CString::new(value)) else {
        return;
    };
    let g = PLAYER.lock().unwrap();
    if let (Some(p), Some(l)) = (g.as_ref(), LIB.get()) {
        unsafe {
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
/// Used by the inverted player's region frost (lib.rs `mpv_frost`), and by
/// the dormant whole-picture `mpv_blur` beside it.
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
    PROP_READS.fetch_add(1, Ordering::Relaxed);
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
