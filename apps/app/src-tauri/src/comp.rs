// The composition player (Windows only): native mpv renders into a child HWND
// (true 4K60), and a transparent composition-hosted WebView2 (the React
// TheaterOverlay) is composited over it via a topmost DirectComposition target —
// one window, controls-on-video, no readback. Mouse/keyboard are forwarded in,
// and the overlay drives mpv + window state back over a postMessage bridge.

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
use std::sync::Mutex;
use windows::core::Interface;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::core::{IUnknown, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_POINTER, LPARAM, LRESULT, POINT, RECT, WPARAM};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2CompositionController,
    ICoreWebView2Controller, ICoreWebView2Controller2, ICoreWebView2Environment,
    ICoreWebView2Environment3, ICoreWebView2WebMessageReceivedEventArgs, COREWEBVIEW2_COLOR,
    COREWEBVIEW2_MOUSE_EVENT_KIND, COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE,
    COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOUBLE_CLICK,
    COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN, COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
    COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN, COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP,
    COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE, COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN,
    COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS,
};
use webview2_com::{
    AddScriptToExecuteOnDocumentCreatedCompletedHandler,
    CreateCoreWebView2CompositionControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler, WebMessageReceivedEventHandler,
};
// Production only: the composition webview runs in its own WebView2 environment
// with no Tauri asset protocol, so it can't reach tauri.localhost. We intercept
// its requests and serve the embedded frontend ourselves (see serve_asset).
#[cfg(not(debug_assertions))]
use webview2_com::WebResourceRequestedEventHandler;
#[cfg(not(debug_assertions))]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2WebResourceRequestedEventArgs, ICoreWebView2WebResourceResponse,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
};
#[cfg(not(debug_assertions))]
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, CreateWindowExW, DefWindowProcW, SetWindowLongPtrW, SetWindowPos,
    DestroyWindow, GWLP_WNDPROC, HTCLIENT, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    SW_HIDE, ShowWindow, WINDOW_EX_STYLE, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_NCHITTEST, WM_RBUTTONDOWN,
    WM_RBUTTONUP, WS_CHILD, WS_VISIBLE,
};

// Injected into the composition webview before navigation. Exposes the same
// `window.overlayApi` the TheaterOverlay already targets (from the Electron era),
// backed by WebView2's postMessage channel. Posts `ready` so Rust can push meta.
const OVERLAY_BRIDGE_JS: &str = r#"(function(){
  if(!window.chrome||!window.chrome.webview)return;
  var post=function(m){window.chrome.webview.postMessage(JSON.stringify(m));};
  var metaCbs=[];var lastMeta=null;
  var loadingCbs=[];var lastLoading=true;
  var keyCbs=[];
  var timeCbs=[];var lastTime=null;
  var tracksCbs=[];var lastTracks=null;
  window.chrome.webview.addEventListener('message',function(e){
    var msg; try{msg=JSON.parse(e.data);}catch(_){return;}
    if(msg&&msg.type==='meta'){lastMeta=msg.meta;metaCbs.slice().forEach(function(cb){try{cb(lastMeta);}catch(_){}})}
    if(msg&&msg.type==='loading'){lastLoading=!!msg.loading;loadingCbs.slice().forEach(function(cb){try{cb(lastLoading);}catch(_){}})}
    if(msg&&msg.type==='key'){keyCbs.slice().forEach(function(cb){try{cb(msg.key);}catch(_){}})}
    if(msg&&msg.type==='time'){lastTime={pos:msg.pos,dur:msg.dur};timeCbs.slice().forEach(function(cb){try{cb(lastTime);}catch(_){}})}
    if(msg&&msg.type==='tracks'){lastTracks={audio:msg.audio,subs:msg.subs};tracksCbs.slice().forEach(function(cb){try{cb(lastTracks);}catch(_){}})}
  });
  window.overlayApi={
    close:function(){post({type:'close'});},
    setPause:function(p){post({type:'setPause',paused:!!p});},
    setMute:function(m){post({type:'setMute',muted:!!m});},
    setVolume:function(v){post({type:'setVolume',vol:v});},
    seek:function(d){post({type:'seek',delta:d});},
    seekTo:function(p){post({type:'seekTo',pos:p});},
    selectAudio:function(id){post({type:'selectAudio',id:String(id)});},
    selectSub:function(id){post({type:'selectSub',id:String(id)});},
    setSpeed:function(s){post({type:'setSpeed',speed:s});},
    expand:function(){post({type:'expand'});},
    collapse:function(){post({type:'collapse'});},
    fullscreen:function(){post({type:'fullscreen'});},
    exitFullscreen:function(){post({type:'exitFullscreen'});},
    popout:function(){post({type:'popout'});},
    panel:function(){post({type:'panel'});},
    setMouseIgnore:function(ig){post({type:'setMouseIgnore',ignore:!!ig});},
    getMeta:function(){return Promise.resolve(lastMeta);},
    onMeta:function(cb){metaCbs.push(cb);return function(){metaCbs=metaCbs.filter(function(x){return x!==cb;});};},
    getLoading:function(){return lastLoading;},
    onLoading:function(cb){loadingCbs.push(cb);return function(){loadingCbs=loadingCbs.filter(function(x){return x!==cb;});};},
    onKey:function(cb){keyCbs.push(cb);return function(){keyCbs=keyCbs.filter(function(x){return x!==cb;});};},
    getTime:function(){return lastTime;},
    onTime:function(cb){timeCbs.push(cb);return function(){timeCbs=timeCbs.filter(function(x){return x!==cb;});};},
    getTracks:function(){return lastTracks;},
    onTracks:function(cb){tracksCbs.push(cb);return function(){tracksCbs=tracksCbs.filter(function(x){return x!==cb;});};}
  };
  post({type:'ready'});
})();"#;

// The host the production overlay loads from. Its requests are intercepted and
// served from the app's embedded frontend (see serve_asset). Any host works
// since nothing actually resolves it over the network.
#[cfg(not(debug_assertions))]
const OVERLAY_HOST: &str = "blammytv.localhost";

/// The URL the composition webview navigates to in a packaged build. In dev the
/// overlay loads from the Vite server (the `overlay_url` passed from JS); in
/// production there's no dev server, so we load the embedded frontend via a
/// virtual host whose requests `serve_asset` fulfils.
#[cfg(not(debug_assertions))]
fn overlay_prod_url() -> String {
    format!("http://{OVERLAY_HOST}/?overlay=1&composited=1")
}

/// Strip a full request URI down to the asset path (leading `/`, no query) so it
/// can be looked up in the embedded frontend (e.g.
/// `http://blammytv.localhost/assets/x.js?v=1` → `/assets/x.js`).
#[cfg(not(debug_assertions))]
fn asset_path_from_uri(uri: &str) -> String {
    let after_scheme = uri.split_once("://").map_or(uri, |(_, rest)| rest);
    let path = match after_scheme.find('/') {
        Some(i) => &after_scheme[i..],
        None => "/",
    };
    path.split(['?', '#']).next().unwrap_or("/").to_string()
}

/// Build a WebView2 response for `uri` from the app's embedded frontend, or
/// `None` if there's no such asset. This is what lets the standalone composition
/// webview load the React overlay without a Tauri asset protocol of its own.
#[cfg(not(debug_assertions))]
fn serve_asset(
    env: &ICoreWebView2Environment,
    uri: &str,
) -> Option<ICoreWebView2WebResourceResponse> {
    let app = crate::APP.get()?;
    let asset = app.asset_resolver().get(asset_path_from_uri(uri))?;
    let headers = HSTRING::from(format!("Content-Type: {}\r\n", asset.mime_type));
    let reason = HSTRING::from("OK");
    unsafe {
        let stream = SHCreateMemStream(Some(&asset.bytes))?;
        env.CreateWebResourceResponse(
            &stream,
            200,
            PCWSTR(reason.as_ptr()),
            PCWSTR(headers.as_ptr()),
        )
        .ok()
    }
}

// Step 3: native mpv in a child window, with the composition WebView2 over it.
// mpv child HWND (true 4K60 HDR) is the bottom layer; the topmost DComp target
// composites the transparent webview (controls) over it — the real Telly player.
struct Theater {
    _device: ID3D11Device,
    _dcomp: IDCompositionDevice,
    _target: IDCompositionTarget,
    _root: IDCompositionVisual,
    _wv_visual: IDCompositionVisual,
    _child: isize,
    _controller: Option<ICoreWebView2Controller>,
    _comp_controller: Option<ICoreWebView2CompositionController>,
}
unsafe impl Send for Theater {}
static THEATER: Mutex<Option<Theater>> = Mutex::new(None);

// Original WNDPROC of the mpv child, saved when we subclass it to forward input.
static ORIG_WNDPROC: AtomicIsize = AtomicIsize::new(0);

// Bumped per theater open; the loader poll thread exits when it's superseded.
static LOADER_GEN: AtomicU64 = AtomicU64::new(0);

// Forward a keyboard shortcut (captured by the main webview, which holds focus)
// into the overlay, which owns the player UI + drives mpv. UI thread only.
pub fn post_key(key: &str) {
    let esc = key.replace('\\', "\\\\").replace('"', "\\\"");
    post_overlay(&format!("{{\"type\":\"key\",\"key\":\"{esc}\"}}"));
}

// Post a JSON message into the composition overlay (UI thread only).
fn post_overlay(msg: &str) {
    // Clone the controller out and drop the lock before the COM calls.
    let ctrl = THEATER
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s._controller.clone());
    if let Some(c) = ctrl {
        unsafe {
            if let Ok(wv) = c.CoreWebView2() {
                let m = HSTRING::from(msg);
                let _ = wv.PostWebMessageAsString(PCWSTR(m.as_ptr()));
            }
        }
    }
}

// Hide the overlay's loader once mpv is actually presenting (core-idle == no),
// or after a timeout. Runs off-thread; posts back on the UI thread.
fn spawn_loader_watch() {
    let gen = LOADER_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        for _ in 0..120 {
            std::thread::sleep(std::time::Duration::from_millis(150));
            if LOADER_GEN.load(Ordering::SeqCst) != gen {
                return; // superseded by a newer open
            }
            if crate::mpv::get_property("core-idle").as_deref() == Some("no") {
                break;
            }
        }
        if LOADER_GEN.load(Ordering::SeqCst) == gen {
            crate::run_on_main(|| post_overlay("{\"type\":\"loading\",\"loading\":false}"));
        }
    });
}

// Build the {type:'tracks', audio, subs} message from mpv's track list.
fn tracks_json() -> String {
    let mut audio = Vec::new();
    let mut subs = Vec::new();
    for t in crate::mpv::track_list() {
        let label = if !t.title.is_empty() {
            t.title.clone()
        } else if !t.lang.is_empty() {
            t.lang.clone()
        } else {
            format!("Track {}", t.id)
        };
        let entry = serde_json::json!({
            "id": t.id, "label": label, "lang": t.lang, "selected": t.selected,
        });
        match t.kind.as_str() {
            "audio" => audio.push(entry),
            "sub" => subs.push(entry),
            _ => {}
        }
    }
    serde_json::json!({ "type": "tracks", "audio": audio, "subs": subs }).to_string()
}

// Poll mpv's playback position + duration (for the VOD scrubber) and the track
// list (audio/sub selectors), pushing each to the overlay when it changes. Runs
// until a newer open/teardown bumps the generation. Live streams report no
// usable duration, so no time is posted there.
fn spawn_time_watch() {
    let gen = LOADER_GEN.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut last_tracks = String::new();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if LOADER_GEN.load(Ordering::SeqCst) != gen {
                return; // superseded by a newer open or a teardown
            }
            let pos = crate::mpv::get_property("time-pos").and_then(|s| s.parse::<f64>().ok());
            let dur = crate::mpv::get_property("duration").and_then(|s| s.parse::<f64>().ok());
            if let (Some(p), Some(d)) = (pos, dur) {
                if p.is_finite() && d.is_finite() && d > 0.0 {
                    crate::run_on_main(move || {
                        post_overlay(&format!("{{\"type\":\"time\",\"pos\":{p},\"dur\":{d}}}"));
                    });
                }
            }
            let tj = tracks_json();
            if tj != last_tracks {
                last_tracks = tj.clone();
                crate::run_on_main(move || post_overlay(&tj));
            }
        }
    });
}

// Clip the mpv child to a rounded rectangle (physical-px corner radius) so the
// native video matches the rounded preview box; radius 0 = sharp (theater).
unsafe fn round_child(child: HWND, w: u32, h: u32, radius: i32) {
    let d = (radius * 2).max(0);
    let rgn = CreateRoundRectRgn(0, 0, w as i32 + 1, h as i32 + 1, d, d);
    let _ = SetWindowRgn(child, Some(rgn), true);
}

// winuser.h WM_MOUSELEAVE (not surfaced under WindowsAndMessaging in windows-rs).
const WM_MOUSELEAVE: u32 = 0x02A3;

fn mouse_kind(msg: u32) -> Option<COREWEBVIEW2_MOUSE_EVENT_KIND> {
    Some(match msg {
        WM_MOUSEMOVE => COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
        WM_LBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
        WM_LBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
        WM_LBUTTONDBLCLK => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOUBLE_CLICK,
        WM_RBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN,
        WM_RBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP,
        WM_MBUTTONDOWN => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN,
        WM_MBUTTONUP => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP,
        WM_MOUSELEAVE => COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE,
        _ => return None,
    })
}

// Subclass proc on the mpv child window: forward mouse to the composition
// controller (which otherwise receives no input), then chain to the original.
unsafe extern "system" fn theater_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // STATIC controls report HTTRANSPARENT, which sends the mouse to the parent
    // instead of us — claim the client area so we actually receive mouse messages.
    if msg == WM_NCHITTEST {
        return LRESULT(HTCLIENT as isize);
    }
    // Scroll over the player = volume (we only get the wheel while hovering the
    // child, so the EPG keeps its own scroll). Route through the key handler.
    if msg == WM_MOUSEWHEEL {
        let delta = ((wparam.0 >> 16) & 0xFFFF) as u16 as i16;
        post_key(if delta > 0 { "ArrowUp" } else { "ArrowDown" });
        return LRESULT(0);
    }
    // Ask for a WM_MOUSELEAVE so we can forward a LEAVE when the cursor exits —
    // else the webview's :hover (the mini border) sticks on after the mouse leaves.
    if msg == WM_MOUSEMOVE {
        let mut tme = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE,
            hwndTrack: hwnd,
            dwHoverTime: 0,
        };
        let _ = TrackMouseEvent(&mut tme);
    }
    if let Some(kind) = mouse_kind(msg) {
        // Clone out + drop the lock before SendMouseInput, which can re-enter
        // this proc (cursor updates) and would otherwise deadlock the Mutex.
        let cc = THEATER
            .lock()
            .ok()
            .and_then(|g| g.as_ref().and_then(|s| s._comp_controller.clone()));
        if let Some(cc) = cc {
            let x = (lparam.0 & 0xFFFF) as i16 as i32;
            let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
            let vkeys = COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS((wparam.0 & 0xFFFF) as i32);
            let _ = cc.SendMouseInput(kind, vkeys, 0, POINT { x, y });
        }
    }
    let orig = ORIG_WNDPROC.load(Ordering::SeqCst);
    if orig != 0 {
        let prev: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT =
            std::mem::transmute(orig);
        CallWindowProcW(Some(prev), hwnd, msg, wparam, lparam)
    } else {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

// Full teardown of the current theater: stop mpv, close the webview, destroy the
// child window, and release the DComp target (so a fresh open can re-target the
// HWND — Windows allows only one DComp target per window). UI-thread only. Run at
// the start of every open so reopen / channel-switch always rebuild cleanly.
// Reposition/resize the live layer (mpv child + webview visual + controller) to a
// new rect — keeps the native preview aligned with its in-app box, and powers the
// expand-to-fullscreen resize. UI-thread only.
pub fn set_rect(x: i32, y: i32, w: u32, h: u32, radius: i32) {
    if let Some(s) = THEATER.lock().unwrap().as_ref() {
        unsafe {
            let child = HWND(s._child as *mut c_void);
            let _ = SetWindowPos(
                child,
                Some(HWND_TOP),
                x,
                y,
                w as i32,
                h as i32,
                SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
            round_child(child, w, h, radius);
            let _ = s._wv_visual.SetOffsetX2(x as f32);
            let _ = s._wv_visual.SetOffsetY2(y as f32);
            if let Some(c) = s._controller.as_ref() {
                let _ = c.SetBounds(RECT {
                    left: 0,
                    top: 0,
                    right: w as i32,
                    bottom: h as i32,
                });
            }
            let _ = s._dcomp.Commit();
        }
    }
}

pub fn close_theater() {
    // Bump the generation so the loader / time poll threads exit.
    LOADER_GEN.fetch_add(1, Ordering::SeqCst);
    crate::mpv::stop();
    let prev = THEATER.lock().unwrap().take();
    if let Some(t) = prev {
        unsafe {
            if let Some(c) = t._controller.as_ref() {
                let _ = c.Close();
            }
            let child = HWND(t._child as *mut c_void);
            let _ = DestroyWindow(child);
        }
        // `t` drops here: releases the DComp target + visuals + device + webview.
    }
    ORIG_WNDPROC.store(0, Ordering::SeqCst);
}

pub fn theater(
    hwnd: isize,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    radius: i32,
    url: &str,
    overlay_url: &str,
    meta_json: &str,
    start: f64,
) -> Result<(), String> {
    // Tear down any previous theater first so we can re-target the HWND and don't
    // leak the old mpv child / webview (also makes channel-switch a clean rebuild).
    close_theater();
    unsafe {
        let parent = HWND(hwnd as *mut c_void);

        // Child window for mpv to render into (sits above the Tauri webview),
        // positioned at the layer rect (the in-app preview box, or full window).
        let child = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            windows::core::w!("STATIC"),
            windows::core::w!(""),
            WS_CHILD | WS_VISIBLE,
            x,
            y,
            w as i32,
            h as i32,
            Some(parent),
            None,
            None,
            None,
        )
        .map_err(|e| format!("CreateWindowExW: {e}"))?;
        // Force the mpv child above Tauri's own webview (which wry keeps raised),
        // else it stays occluded and the React app shows through instead of video.
        let _ = SetWindowPos(
            child,
            Some(HWND_TOP),
            x,
            y,
            w as i32,
            h as i32,
            SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
        round_child(child, w, h, radius);
        // Subclass the child so we can forward mouse input to the (HWND-less)
        // composition webview. Saves the original proc to chain to.
        let proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT = theater_wndproc;
        let prev = SetWindowLongPtrW(child, GWLP_WNDPROC, proc as usize as isize);
        ORIG_WNDPROC.store(prev, Ordering::SeqCst);

        crate::mpv::play_wid(url, child.0 as isize, false, start)?;

        // D3D11 device just for DComp.
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let mut level = D3D_FEATURE_LEVEL::default();
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut level),
            Some(&mut context),
        )
        .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
        let device = device.ok_or("no d3d11 device")?;
        let dxgi_device: IDXGIDevice =
            device.cast().map_err(|e| format!("cast IDXGIDevice: {e}"))?;

        let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi_device)
            .map_err(|e| format!("DCompositionCreateDevice: {e}"))?;
        let target: IDCompositionTarget = dcomp
            .CreateTargetForHwnd(parent, true)
            .map_err(|e| format!("CreateTargetForHwnd: {e}"))?;
        let root: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("root visual: {e}"))?;
        let wv_visual: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("wv visual: {e}"))?;
        root.AddVisual(&wv_visual, true, None)
            .map_err(|e| format!("AddVisual: {e}"))?;
        // Position the webview visual at the layer rect (matches the mpv child).
        let _ = wv_visual.SetOffsetX2(x as f32);
        let _ = wv_visual.SetOffsetY2(y as f32);
        target.SetRoot(&root).map_err(|e| format!("SetRoot: {e}"))?;
        dcomp.Commit().map_err(|e| format!("Commit: {e}"))?;

        let dcomp_cb = dcomp.clone();
        let wv_cb = wv_visual.clone();
        // Owned copies so the async handlers (which outlive this call) can use them.
        let overlay_owned = overlay_url.to_string();
        // The message the overlay receives on `ready` — wraps the channel meta JSON.
        let meta_msg = format!(
            "{{\"type\":\"meta\",\"meta\":{}}}",
            if meta_json.trim().is_empty() {
                "null"
            } else {
                meta_json
            }
        );
        let userdata = HSTRING::from(
            std::env::temp_dir()
                .join("blammytv-wv2")
                .to_string_lossy()
                .to_string(),
        );
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            PCWSTR(userdata.as_ptr()),
            None,
            &CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
                move |_hr, env: Option<ICoreWebView2Environment>| {
                    let env =
                        env.ok_or_else(|| windows::core::Error::new(E_POINTER, "no environment"))?;
                    let env3: ICoreWebView2Environment3 = env.cast()?;
                    let dcomp2 = dcomp_cb.clone();
                    let wv2 = wv_cb.clone();
                    let overlay2 = overlay_owned.clone();
                    let meta2 = meta_msg.clone();
                    // Needed in production to build embedded-asset responses for
                    // the overlay (see the WebResourceRequested handler below).
                    #[cfg(not(debug_assertions))]
                    let env_inner = env.clone();
                    env3.CreateCoreWebView2CompositionController(
                        parent,
                        &CreateCoreWebView2CompositionControllerCompletedHandler::create(Box::new(
                            move |_hr, ctrl: Option<ICoreWebView2CompositionController>| {
                                let ctrl = ctrl.ok_or_else(|| {
                                    windows::core::Error::new(E_POINTER, "no controller")
                                })?;
                                let unk: IUnknown = wv2.cast()?;
                                ctrl.SetRootVisualTarget(&unk)?;
                                let c: ICoreWebView2Controller = ctrl.cast()?;
                                c.SetBounds(RECT {
                                    left: 0,
                                    top: 0,
                                    right: w as i32,
                                    bottom: h as i32,
                                })?;
                                if let Ok(c2) = ctrl.cast::<ICoreWebView2Controller2>() {
                                    let _ = c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
                                        A: 0,
                                        R: 0,
                                        G: 0,
                                        B: 0,
                                    });
                                }
                                c.SetIsVisible(true)?;
                                let wv = c.CoreWebView2()?;

                                // Milestone 2 (bridge): inject window.overlayApi
                                // before navigation, then handle its messages.
                                let script = HSTRING::from(OVERLAY_BRIDGE_JS);
                                wv.AddScriptToExecuteOnDocumentCreated(
                                    PCWSTR(script.as_ptr()),
                                    &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                                        Box::new(move |_hr, _id| Ok(())),
                                    ),
                                )?;

                                let meta3 = meta2.clone();
                                // Type inferred from add_WebMessageReceived's signature
                                // (EventRegistrationToken isn't exported under a name).
                                let mut token = Default::default();
                                wv.add_WebMessageReceived(
                                    &WebMessageReceivedEventHandler::create(Box::new(
                                        move |wv_opt: Option<ICoreWebView2>,
                                              args_opt: Option<
                                            ICoreWebView2WebMessageReceivedEventArgs,
                                        >| {
                                            let args = match args_opt {
                                                Some(a) => a,
                                                None => return Ok(()),
                                            };
                                            let mut raw = PWSTR::null();
                                            args.TryGetWebMessageAsString(&mut raw)?;
                                            let text = raw.to_string().unwrap_or_default();
                                            CoTaskMemFree(Some(raw.0 as *const c_void));
                                            let v: serde_json::Value =
                                                match serde_json::from_str(&text) {
                                                    Ok(v) => v,
                                                    Err(_) => return Ok(()),
                                                };
                                            match v.get("type").and_then(|t| t.as_str()) {
                                                Some("ready") => {
                                                    if let Some(wv) = wv_opt.as_ref() {
                                                        let m = HSTRING::from(meta3.as_str());
                                                        let _ = wv.PostWebMessageAsString(
                                                            PCWSTR(m.as_ptr()),
                                                        );
                                                    }
                                                }
                                                Some("setPause") => crate::mpv::set_pause(
                                                    v.get("paused")
                                                        .and_then(|x| x.as_bool())
                                                        .unwrap_or(false),
                                                ),
                                                Some("setMute") => crate::mpv::set_mute(
                                                    v.get("muted")
                                                        .and_then(|x| x.as_bool())
                                                        .unwrap_or(false),
                                                ),
                                                Some("setVolume") => crate::mpv::set_volume(
                                                    v.get("vol")
                                                        .and_then(|x| x.as_f64())
                                                        .unwrap_or(100.0)
                                                        as i64,
                                                ),
                                                Some("seek") => crate::mpv::seek(
                                                    v.get("delta")
                                                        .and_then(|x| x.as_f64())
                                                        .unwrap_or(0.0),
                                                ),
                                                Some("seekTo") => crate::mpv::seek_abs(
                                                    v.get("pos")
                                                        .and_then(|x| x.as_f64())
                                                        .unwrap_or(0.0),
                                                ),
                                                Some("selectAudio") => crate::mpv::set_track(
                                                    "audio",
                                                    v.get("id")
                                                        .and_then(|x| x.as_str())
                                                        .unwrap_or("auto"),
                                                ),
                                                Some("selectSub") => crate::mpv::set_track(
                                                    "sub",
                                                    v.get("id")
                                                        .and_then(|x| x.as_str())
                                                        .unwrap_or("no"),
                                                ),
                                                Some("setSpeed") => crate::mpv::set_speed(
                                                    v.get("speed")
                                                        .and_then(|x| x.as_f64())
                                                        .unwrap_or(1.0),
                                                ),
                                                Some("expand") => crate::emit_comp("comp-expand"),
                                                Some("collapse") => {
                                                    crate::emit_comp("comp-collapse")
                                                }
                                                Some("fullscreen") => {
                                                    crate::emit_comp("comp-fullscreen")
                                                }
                                                Some("exitFullscreen") => {
                                                    crate::emit_comp("comp-exit-fullscreen")
                                                }
                                                Some("popout") => crate::emit_comp("comp-popout"),
                                                Some("panel") => crate::emit_comp("comp-panel"),
                                                Some("close") => {
                                                    // Stop video and drop back to the guide. Hide
                                                    // (don't drop) here — dropping the controller
                                                    // inside its own callback would re-enter; full
                                                    // teardown happens at the next open.
                                                    crate::mpv::stop();
                                                    if let Some(s) =
                                                        THEATER.lock().unwrap().as_ref()
                                                    {
                                                        if let Some(ctrl) = s._controller.as_ref() {
                                                            let _ = ctrl.SetIsVisible(false);
                                                        }
                                                        let child =
                                                            HWND(s._child as *mut c_void);
                                                        let _ = ShowWindow(child, SW_HIDE);
                                                    }
                                                    // Notify React so it drops back
                                                    // to the guide + tears the layer
                                                    // down (via comp_stop).
                                                    crate::emit_comp("comp-closed");
                                                }
                                                _ => {}
                                            }
                                            Ok(())
                                        },
                                    )),
                                    &mut token,
                                )?;

                                // In a packaged build there's no dev server, so
                                // serve the overlay from the embedded frontend:
                                // intercept this webview's requests and answer
                                // them from the app's bundled assets.
                                #[cfg(not(debug_assertions))]
                                {
                                    let env_rr = env_inner.clone();
                                    let mut rr_token = 0i64;
                                    wv.add_WebResourceRequested(
                                        &WebResourceRequestedEventHandler::create(Box::new(
                                            move |_wv,
                                                  args: Option<
                                                ICoreWebView2WebResourceRequestedEventArgs,
                                            >| {
                                                let args = match args {
                                                    Some(a) => a,
                                                    None => return Ok(()),
                                                };
                                                let mut raw = PWSTR::null();
                                                args.Request()?.Uri(&mut raw)?;
                                                let uri = raw.to_string().unwrap_or_default();
                                                CoTaskMemFree(Some(raw.0 as *const c_void));
                                                if let Some(resp) = serve_asset(&env_rr, &uri) {
                                                    args.SetResponse(&resp)?;
                                                }
                                                Ok(())
                                            },
                                        )),
                                        &mut rr_token,
                                    )?;
                                    let filter = HSTRING::from("*");
                                    wv.AddWebResourceRequestedFilter(
                                        PCWSTR(filter.as_ptr()),
                                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                                    )?;
                                }

                                // Load the real app in overlay mode (TheaterOverlay),
                                // transparent over the mpv layer. Dev uses the Vite
                                // URL from JS; production uses the embedded frontend.
                                #[cfg(not(debug_assertions))]
                                let nav_str = {
                                    let _ = &overlay2;
                                    overlay_prod_url()
                                };
                                #[cfg(debug_assertions)]
                                let nav_str = overlay2.clone();
                                let nav = HSTRING::from(nav_str.as_str());
                                wv.Navigate(PCWSTR(nav.as_ptr()))?;
                                let _ = dcomp2.Commit();
                                if let Some(s) = THEATER.lock().unwrap().as_mut() {
                                    s._comp_controller = Some(ctrl);
                                    s._controller = Some(c);
                                }
                                Ok(())
                            },
                        )),
                    )?;
                    Ok(())
                },
            )),
        )
        .map_err(|e| format!("CreateCoreWebView2EnvironmentWithOptions: {e}"))?;

        *THEATER.lock().unwrap() = Some(Theater {
            _device: device,
            _dcomp: dcomp,
            _target: target,
            _root: root,
            _wv_visual: wv_visual,
            _child: child.0 as isize,
            _controller: None,
            _comp_controller: None,
        });
    }
    // Watch for first frame to clear the overlay's loader.
    spawn_loader_watch();
    spawn_time_watch();
    Ok(())
}
