// The Mac's video surface for the in-app player, the counterpart of inv.rs:
// an NSOpenGLView at the BOTTOM of the window's content view, under the
// transparent webview (the frontend cuts a hole where the video shows
// through), and libmpv draws into it through its render API. mpv has no
// `--wid` on macOS (DOCS/man/options.rst lists X11, win32 and Android), and
// the render API offers OpenGL or software only (include/mpv/render.h), so
// OpenGL it is. Apple deprecated it; IINA still ships on it.
//
// Same three calls as inv.rs (open, set_rect, close), same contract: rects are
// PHYSICAL px from the window's top-left, and everything here runs on the main
// thread (lib.rs hops there). The view is made once and lives for the process.

#![cfg(target_os = "macos")]
#![allow(deprecated)]

use libloading::Library;
use objc2::rc::Retained;
use objc2::runtime::AnyClass;
use objc2::{msg_send, MainThreadMarker, Message};
use objc2_app_kit::{
    NSColor, NSOpenGLPFAAccelerated, NSOpenGLPFADoubleBuffer, NSOpenGLPFAOpenGLProfile, NSOpenGLPixelFormat,
    NSOpenGLProfileVersion3_2Core, NSOpenGLView, NSView, NSWindow, NSWindowOrderingMode,
};
use objc2_foundation::{NSNumber, NSPoint, NSRect, NSSize, NSString};
use std::ffi::{c_char, c_int, c_void, CStr};
use std::ptr::{null_mut, NonNull};
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::OnceLock;

static VIEW: AtomicPtr<NSOpenGLView> = AtomicPtr::new(null_mut());
static WINDOW: AtomicPtr<NSWindow> = AtomicPtr::new(null_mut());
/// The mpv_render_context, made once by `attach` and kept for the process.
static CTX: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
/// A draw is already queued for the main thread; mpv's update callback fires
/// from its own threads, often several times a frame.
static PENDING: AtomicBool = AtomicBool::new(false);

// libmpv's render API (include/mpv/render.h, render_gl.h).
#[repr(C)]
struct Param {
    kind: c_int,
    data: *mut c_void,
}
#[repr(C)]
struct InitParams {
    get_proc_address: extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    ctx: *mut c_void,
}
#[repr(C)]
struct Fbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
}
const PARAM_API_TYPE: c_int = 1;
const PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const PARAM_OPENGL_FBO: c_int = 3;
const PARAM_FLIP_Y: c_int = 4;
const PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;

struct Render {
    create: unsafe extern "C" fn(*mut *mut c_void, *mut c_void, *mut Param) -> c_int,
    set_update_callback: unsafe extern "C" fn(*mut c_void, extern "C" fn(*mut c_void), *mut c_void),
    update: unsafe extern "C" fn(*mut c_void) -> u64,
    render: unsafe extern "C" fn(*mut c_void, *mut Param) -> c_int,
    report_swap: unsafe extern "C" fn(*mut c_void),
}

fn render_api() -> Result<&'static Render, String> {
    static API: OnceLock<Render> = OnceLock::new();
    if let Some(r) = API.get() {
        return Ok(r);
    }
    let lib = crate::mpv::libmpv().ok_or("libmpv is not loaded")?;
    unsafe {
        let sym = |name: &[u8]| -> Result<*const c_void, String> {
            lib.get::<*const c_void>(name)
                .map(|s| *s)
                .map_err(|e| format!("this libmpv has no render API ({}): {e}", String::from_utf8_lossy(name)))
        };
        let r = Render {
            create: std::mem::transmute(sym(b"mpv_render_context_create\0")?),
            set_update_callback: std::mem::transmute(sym(b"mpv_render_context_set_update_callback\0")?),
            update: std::mem::transmute(sym(b"mpv_render_context_update\0")?),
            render: std::mem::transmute(sym(b"mpv_render_context_render\0")?),
            report_swap: std::mem::transmute(sym(b"mpv_render_context_report_swap\0")?),
        };
        let _ = API.set(r);
    }
    Ok(API.get().unwrap())
}

/// libmpv does not link GL; it asks for each function by name.
extern "C" fn get_proc_address(_: *mut c_void, name: *const c_char) -> *mut c_void {
    static GL: OnceLock<Option<Library>> = OnceLock::new();
    let gl = GL.get_or_init(|| unsafe {
        Library::new("/System/Library/Frameworks/OpenGL.framework/OpenGL").ok()
    });
    let Some(gl) = gl else { return null_mut() };
    let name = unsafe { CStr::from_ptr(name) }.to_bytes_with_nul();
    unsafe { gl.get::<*mut c_void>(name).map_or(null_mut(), |s| *s) }
}

/// mpv's thread, not ours: only queue the draw.
extern "C" fn on_update(_: *mut c_void) {
    if PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    match crate::APP.get() {
        Some(app) => {
            if app.run_on_main_thread(draw).is_err() {
                PENDING.store(false, Ordering::Release);
            }
        }
        None => PENDING.store(false, Ordering::Release),
    }
}

fn view<'a>() -> Option<&'a NSOpenGLView> {
    unsafe { VIEW.load(Ordering::Acquire).as_ref() }
}

/// Paint mpv's current frame into the view. Main thread.
fn draw() {
    PENDING.store(false, Ordering::Release);
    let (Some(view), Ok(r)) = (view(), render_api()) else {
        return;
    };
    let ctx = CTX.load(Ordering::Acquire);
    let Some(gl) = view.openGLContext() else {
        return;
    };
    if ctx.is_null() {
        return;
    }
    unsafe {
        gl.makeCurrentContext();
        // Whether there is a NEW frame does not matter: a resize repaints too.
        (r.update)(ctx);
        let px = view.convertRectToBacking(view.bounds()).size;
        let mut fbo = Fbo { fbo: 0, w: px.width as c_int, h: px.height as c_int, internal_format: 0 };
        let mut flip: c_int = 1;
        // The main thread must not wait for a frame's due time.
        let mut block: c_int = 0;
        let mut params = [
            Param { kind: PARAM_OPENGL_FBO, data: &mut fbo as *mut Fbo as *mut c_void },
            Param { kind: PARAM_FLIP_Y, data: &mut flip as *mut c_int as *mut c_void },
            Param { kind: PARAM_BLOCK_FOR_TARGET_TIME, data: &mut block as *mut c_int as *mut c_void },
            Param { kind: 0, data: null_mut() },
        ];
        (r.render)(ctx, params.as_mut_ptr());
        gl.flushBuffer();
        (r.report_swap)(ctx);
    }
}

/// Called by mpv::ensure_player right after mpv_initialize, on the main thread:
/// hand the freshly made mpv handle a render context bound to the view's GL
/// context. Once per process, like the player.
pub fn attach(mpv: *mut c_void) -> Result<(), String> {
    let r = render_api()?;
    let view = view().ok_or("no video view")?;
    let gl = view.openGLContext().ok_or("the video view has no OpenGL context")?;
    gl.makeCurrentContext();
    let mut api = *b"opengl\0";
    let mut init = InitParams { get_proc_address, ctx: null_mut() };
    let mut params = [
        Param { kind: PARAM_API_TYPE, data: api.as_mut_ptr() as *mut c_void },
        Param { kind: PARAM_OPENGL_INIT_PARAMS, data: &mut init as *mut InitParams as *mut c_void },
        Param { kind: 0, data: null_mut() },
    ];
    let mut ctx: *mut c_void = null_mut();
    let rc = unsafe { (r.create)(&mut ctx, mpv, params.as_mut_ptr()) };
    if rc < 0 || ctx.is_null() {
        return Err(format!("mpv_render_context_create failed ({rc})"));
    }
    CTX.store(ctx, Ordering::Release);
    unsafe { (r.set_update_callback)(ctx, on_update, null_mut()) };
    Ok(())
}

/// A physical-px rect from the PAGE's top-left, as the view's frame: points,
/// from the content view's bottom-left. The page does not start at the content
/// view's top: the window's title bar strip (32pt here) is over the content
/// and the web view is sized to what is left, `contentLayoutRect`. Counting
/// from the content view's top put the video 32pt too high.
fn frame(x: i32, y: i32, w: u32, h: u32) -> Option<NSRect> {
    let window = unsafe { WINDOW.load(Ordering::Acquire).as_ref() }?;
    let scale = window.backingScaleFactor();
    let page = window.contentLayoutRect();
    let (x, y, w, h) = (x as f64 / scale, y as f64 / scale, w as f64 / scale, h as f64 / scale);
    let top = page.origin.y + page.size.height;
    Some(NSRect::new(NSPoint::new(page.origin.x + x, top - y - h), NSSize::new(w, h)))
}

/// Open the video view at the given rect, under the webview, and start mpv
/// into it. `parent` is the NSWindow. Main thread.
#[allow(clippy::too_many_arguments)]
pub fn open(
    parent: isize,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    url: &str,
    start: Option<f64>,
    live: Option<bool>,
    user_agent: Option<&str>,
) -> Result<(), String> {
    ensure_view(parent, x, y, w, h)?;
    // Any non-zero id: the render API has no window id to bind (ensure_player).
    if let Err(e) = crate::mpv::play_wid(url, 1, start, live, user_agent) {
        crate::mpv::unload();
        return Err(e);
    }
    Ok(())
}

/// The video shows through a hole in the page, so neither the window nor the
/// web view may paint an opaque background. Tauri does this itself under
/// `macOSPrivateApi`; doing it here keeps that setting (and the `tauri`
/// feature it needs in Cargo.toml) out of the shared config. `drawsBackground`
/// is the key wry sets, and WKWebView answers to it.
fn clear_backgrounds(window: &NSWindow, content: &NSView) {
    window.setOpaque(false);
    window.setBackgroundColor(Some(&NSColor::clearColor()));
    let no = NSNumber::new_bool(false);
    let key = NSString::from_str("drawsBackground");
    let mut found = 0;
    // wry's is a subclass of WKWebView (WryWebView), so ask by kind, and it
    // may sit inside a host view, so look all the way down.
    let web = AnyClass::get(c"WKWebView");
    let mut todo: Vec<Retained<NSView>> = vec![content.retain()];
    while let Some(view) = todo.pop() {
        let is_web: bool = web.is_some_and(|c| unsafe { msg_send![&*view, isKindOfClass: c] });
        if is_web {
            unsafe { let _: () = msg_send![&*view, setValue: &*no, forKey: &*key]; }
            found += 1;
        }
        todo.extend(view.subviews().iter());
    }
    log::info!("[mac] cleared the window background and {found} web view(s)'s");
    if found == 0 {
        let names: Vec<String> = content
            .subviews()
            .iter()
            .map(|v| v.class().name().to_string_lossy().into_owned())
            .collect();
        log::warn!("[mac] no web view under the content view; its subviews: {names:?}");
    }
}

/// Make the view and the player before anyone presses play. The view starts
/// 1x1; the first `open` sizes it. Main thread.
pub fn warm_up(parent: isize) -> Result<(), String> {
    ensure_view(parent, 0, 0, 1, 1)?;
    crate::mpv::warm_up()
}

fn ensure_view(parent: isize, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    if view().is_some() {
        set_rect(x, y, w, h);
        return Ok(());
    }
    let mtm = MainThreadMarker::new().ok_or("the video view is made on the main thread")?;
    WINDOW.store(parent as *mut NSWindow, Ordering::Release);
    let window = unsafe { &*(parent as *const NSWindow) };
    let content = window.contentView().ok_or("the window has no content view")?;
    let rect = frame(x, y, w, h).ok_or("no window")?;
    // Core profile 3.2: the oldest mpv's GL renderer accepts. Double buffered.
    let attrs: [u32; 5] = [
        NSOpenGLPFAOpenGLProfile,
        NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFADoubleBuffer,
        NSOpenGLPFAAccelerated,
        0,
    ];
    let format = unsafe {
        NSOpenGLPixelFormat::initWithAttributes(
            mtm.alloc(),
            NonNull::new_unchecked(attrs.as_ptr() as *mut u32),
        )
    }
    .ok_or("no OpenGL 3.2 pixel format")?;
    let view = NSOpenGLView::initWithFrame_pixelFormat(mtm.alloc(), rect, Some(&format))
        .ok_or("could not make the video view")?;
    view.setWantsBestResolutionOpenGLSurface(true);
    clear_backgrounds(window, &content);
    // BELOW every sibling, so the webview stays on top.
    let as_view: &NSView = &view;
    content.addSubview_positioned_relativeTo(as_view, NSWindowOrderingMode::Below, None);
    VIEW.store(Retained::into_raw(view), Ordering::Release);
    Ok(())
}

/// Follow the slot box. Main thread.
pub fn set_rect(x: i32, y: i32, w: u32, h: u32) {
    let (Some(view), Some(rect)) = (view(), frame(x, y, w, h)) else {
        return;
    };
    view.setFrame(rect);
    if let (Some(gl), Some(mtm)) = (view.openGLContext(), MainThreadMarker::new()) {
        gl.update(mtm);
    }
    draw();
}

/// Stop playback and release the provider connection, keeping the view and
/// the mpv instance for the next play (the same reasoning as inv.rs).
pub fn close() {
    crate::mpv::unload();
}
