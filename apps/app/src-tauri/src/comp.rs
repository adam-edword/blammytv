// The Telly-way composition spike (Windows only).
//
// Step 1: prove DirectComposition can put a GPU layer over the Tauri window.
// We make a composition swapchain, clear it to a semi-transparent blue, and show
// it via a DComp target on the window HWND. If a blue tint appears over the app,
// the DComp foundation works — next we swap the colour for the WebView2 visual
// (transparent, controls) and an mpv child window beneath it.

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;
use windows::core::Interface;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView,
    ID3D11Texture2D, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_PREMULTIPLIED, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory2, IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_CREATE_FACTORY_FLAGS,
    DXGI_PRESENT, DXGI_SCALING_STRETCH, DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
    DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::core::{IUnknown, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_POINTER, LPARAM, LRESULT, POINT, RECT, WPARAM};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2CompositionController,
    ICoreWebView2Controller, ICoreWebView2Controller2, ICoreWebView2Environment,
    ICoreWebView2Environment3, ICoreWebView2WebMessageReceivedEventArgs, COREWEBVIEW2_COLOR,
    COREWEBVIEW2_MOUSE_EVENT_KIND,
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
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, CreateWindowExW, DefWindowProcW, SetWindowLongPtrW, SetWindowPos,
    DestroyWindow, GWLP_WNDPROC, HTCLIENT, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE,
    ShowWindow, WINDOW_EX_STYLE, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_MOUSEMOVE, WM_NCHITTEST, WM_RBUTTONDOWN, WM_RBUTTONUP, WS_CHILD, WS_VISIBLE,
};

// Injected into the composition webview before navigation. Exposes the same
// `window.overlayApi` the TheaterOverlay already targets (from the Electron era),
// backed by WebView2's postMessage channel. Posts `ready` so Rust can push meta.
const OVERLAY_BRIDGE_JS: &str = r#"(function(){
  if(!window.chrome||!window.chrome.webview)return;
  var post=function(m){window.chrome.webview.postMessage(JSON.stringify(m));};
  var metaCbs=[];var lastMeta=null;
  window.chrome.webview.addEventListener('message',function(e){
    var msg; try{msg=JSON.parse(e.data);}catch(_){return;}
    if(msg&&msg.type==='meta'){lastMeta=msg.meta;metaCbs.slice().forEach(function(cb){try{cb(lastMeta);}catch(_){}})}
  });
  window.overlayApi={
    close:function(){post({type:'close'});},
    setPause:function(p){post({type:'setPause',paused:!!p});},
    setMute:function(m){post({type:'setMute',muted:!!m});},
    setVolume:function(v){post({type:'setVolume',vol:v});},
    seek:function(d){post({type:'seek',delta:d});},
    setMouseIgnore:function(ig){post({type:'setMouseIgnore',ignore:!!ig});},
    getMeta:function(){return Promise.resolve(lastMeta);},
    onMeta:function(cb){metaCbs.push(cb);return function(){metaCbs=metaCbs.filter(function(x){return x!==cb;});};}
  };
  post({type:'ready'});
})();"#;

// Keep the COM objects alive (else the composition vanishes when they drop).
struct Comp {
    _device: ID3D11Device,
    _context: ID3D11DeviceContext,
    _swap: IDXGISwapChain1,
    _dcomp: IDCompositionDevice,
    _target: IDCompositionTarget,
    _visual: IDCompositionVisual,
}
// Created + used only on the UI thread; the Mutex just keeps it alive.
unsafe impl Send for Comp {}
static COMP: Mutex<Option<Comp>> = Mutex::new(None);

pub fn color_test(hwnd: isize, w: u32, h: u32) -> Result<(), String> {
    unsafe {
        let hwnd = HWND(hwnd as *mut c_void);

        // D3D11 device (BGRA support is required for DComp).
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
        let context = context.ok_or("no d3d11 context")?;

        let dxgi_device: IDXGIDevice =
            device.cast().map_err(|e| format!("cast IDXGIDevice: {e}"))?;
        let factory: IDXGIFactory2 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0))
            .map_err(|e| format!("CreateDXGIFactory2: {e}"))?;

        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: w.max(1),
            Height: h.max(1),
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
            ..Default::default()
        };
        let swap: IDXGISwapChain1 = factory
            .CreateSwapChainForComposition(&device, &desc, None)
            .map_err(|e| format!("CreateSwapChainForComposition: {e}"))?;

        // Clear the back buffer to semi-transparent blue and present.
        let back: ID3D11Texture2D = swap.GetBuffer(0).map_err(|e| format!("GetBuffer: {e}"))?;
        let mut rtv: Option<ID3D11RenderTargetView> = None;
        device
            .CreateRenderTargetView(&back, None, Some(&mut rtv))
            .map_err(|e| format!("CreateRenderTargetView: {e}"))?;
        let rtv = rtv.ok_or("no rtv")?;
        // Premultiplied: rgb already scaled by alpha (0.5).
        context.ClearRenderTargetView(&rtv, &[0.0, 0.2, 0.5, 0.5]);
        swap.Present(1, DXGI_PRESENT(0))
            .ok()
            .map_err(|e| format!("Present: {e}"))?;

        // DirectComposition: target on the HWND (topmost) → visual → swapchain.
        let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi_device)
            .map_err(|e| format!("DCompositionCreateDevice: {e}"))?;
        let target: IDCompositionTarget = dcomp
            .CreateTargetForHwnd(hwnd, true)
            .map_err(|e| format!("CreateTargetForHwnd: {e}"))?;
        let visual: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("CreateVisual: {e}"))?;
        visual
            .SetContent(&swap)
            .map_err(|e| format!("SetContent: {e}"))?;
        target
            .SetRoot(&visual)
            .map_err(|e| format!("SetRoot: {e}"))?;
        dcomp.Commit().map_err(|e| format!("Commit: {e}"))?;

        *COMP.lock().unwrap() = Some(Comp {
            _device: device,
            _context: context,
            _swap: swap,
            _dcomp: dcomp,
            _target: target,
            _visual: visual,
        });
    }
    Ok(())
}

// Step 2: a composition-hosted WebView2 (transparent) as a DComp visual, over a
// semi-transparent blue layer. If the page floats over the blue with the blue
// showing through its transparent areas — the Telly architecture is proven.
struct WebState {
    _device: ID3D11Device,
    _context: ID3D11DeviceContext,
    _swap: IDXGISwapChain1,
    _dcomp: IDCompositionDevice,
    _target: IDCompositionTarget,
    _root: IDCompositionVisual,
    _color: IDCompositionVisual,
    _wv_visual: IDCompositionVisual,
    _controller: Option<ICoreWebView2Controller>,
}
unsafe impl Send for WebState {}
static WEB: Mutex<Option<WebState>> = Mutex::new(None);

pub fn webview_test(hwnd: isize, w: u32, h: u32) -> Result<(), String> {
    unsafe {
        let hwnd = HWND(hwnd as *mut c_void);

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
        let context = context.ok_or("no d3d11 context")?;

        let dxgi_device: IDXGIDevice =
            device.cast().map_err(|e| format!("cast IDXGIDevice: {e}"))?;
        let factory: IDXGIFactory2 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0))
            .map_err(|e| format!("CreateDXGIFactory2: {e}"))?;

        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: w.max(1),
            Height: h.max(1),
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            AlphaMode: DXGI_ALPHA_MODE_PREMULTIPLIED,
            ..Default::default()
        };
        let swap: IDXGISwapChain1 = factory
            .CreateSwapChainForComposition(&device, &desc, None)
            .map_err(|e| format!("CreateSwapChainForComposition: {e}"))?;
        let back: ID3D11Texture2D = swap.GetBuffer(0).map_err(|e| format!("GetBuffer: {e}"))?;
        let mut rtv: Option<ID3D11RenderTargetView> = None;
        device
            .CreateRenderTargetView(&back, None, Some(&mut rtv))
            .map_err(|e| format!("CreateRenderTargetView: {e}"))?;
        context.ClearRenderTargetView(&rtv.ok_or("no rtv")?, &[0.0, 0.15, 0.4, 0.5]);
        swap.Present(1, DXGI_PRESENT(0))
            .ok()
            .map_err(|e| format!("Present: {e}"))?;

        let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi_device)
            .map_err(|e| format!("DCompositionCreateDevice: {e}"))?;
        let target: IDCompositionTarget = dcomp
            .CreateTargetForHwnd(hwnd, true)
            .map_err(|e| format!("CreateTargetForHwnd: {e}"))?;
        let root: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("root visual: {e}"))?;
        let color: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("color visual: {e}"))?;
        color
            .SetContent(&swap)
            .map_err(|e| format!("color SetContent: {e}"))?;
        root.AddVisual(&color, false, None)
            .map_err(|e| format!("AddVisual color: {e}"))?;
        let wv_visual: IDCompositionVisual =
            dcomp.CreateVisual().map_err(|e| format!("wv visual: {e}"))?;
        root.AddVisual(&wv_visual, true, &color)
            .map_err(|e| format!("AddVisual wv: {e}"))?;
        target.SetRoot(&root).map_err(|e| format!("SetRoot: {e}"))?;
        dcomp.Commit().map_err(|e| format!("Commit: {e}"))?;

        // Async: create the composition WebView2 and connect it to wv_visual.
        let dcomp_cb = dcomp.clone();
        let wv_visual_cb = wv_visual.clone();
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
                    let env = env.ok_or_else(|| {
                        windows::core::Error::new(E_POINTER, "no environment")
                    })?;
                    let env3: ICoreWebView2Environment3 = env.cast()?;
                    let dcomp2 = dcomp_cb.clone();
                    let wv2 = wv_visual_cb.clone();
                    env3.CreateCoreWebView2CompositionController(
                        hwnd,
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
                                let html = HSTRING::from(
                                    "<!doctype html><body style='margin:0;background:transparent'>\
                                     <div style='margin:120px auto;width:540px;height:220px;border-radius:16px;\
                                     background:rgba(220,30,60,0.92);color:#fff;font:700 28px sans-serif;\
                                     display:flex;align-items:center;justify-content:center'>\
                                     COMPOSITION WEBVIEW \u{2705}</div></body>",
                                );
                                wv.NavigateToString(PCWSTR(html.as_ptr()))?;
                                let _ = dcomp2.Commit();
                                if let Some(s) = WEB.lock().unwrap().as_mut() {
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

        *WEB.lock().unwrap() = Some(WebState {
            _device: device,
            _context: context,
            _swap: swap,
            _dcomp: dcomp,
            _target: target,
            _root: root,
            _color: color,
            _wv_visual: wv_visual,
            _controller: None,
        });
    }
    Ok(())
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
pub fn set_rect(x: i32, y: i32, w: u32, h: u32) {
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

// Diagnostic: embed mpv in a child window only — no DComp, no webview. If video
// appears, mpv-in-`--wid` works and the issue is purely the composition layering;
// if the React app still shows, mpv isn't rendering into the child at all.
pub fn mpv_child(hwnd: isize, w: u32, h: u32, url: &str) -> Result<(), String> {
    unsafe {
        let parent = HWND(hwnd as *mut c_void);
        let child = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            windows::core::w!("STATIC"),
            windows::core::w!(""),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            w as i32,
            h as i32,
            Some(parent),
            None,
            None,
            None,
        )
        .map_err(|e| format!("CreateWindowExW: {e}"))?;
        let _ = SetWindowPos(
            child,
            Some(HWND_TOP),
            0,
            0,
            w as i32,
            h as i32,
            SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
        crate::mpv::play_wid(url, child.0 as isize, false)?;
        *THEATER.lock().unwrap() = None; // drop any prior composition
    }
    Ok(())
}

pub fn theater(
    hwnd: isize,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    url: &str,
    overlay_url: &str,
    meta_json: &str,
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
        // Subclass the child so we can forward mouse input to the (HWND-less)
        // composition webview. Saves the original proc to chain to.
        let proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT = theater_wndproc;
        let prev = SetWindowLongPtrW(child, GWLP_WNDPROC, proc as usize as isize);
        ORIG_WNDPROC.store(prev, Ordering::SeqCst);

        crate::mpv::play_wid(url, child.0 as isize, false)?;

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
                                                    crate::emit_comp_closed();
                                                }
                                                _ => {}
                                            }
                                            Ok(())
                                        },
                                    )),
                                    &mut token,
                                )?;

                                // Load the real app in overlay mode (TheaterOverlay),
                                // transparent over the mpv layer.
                                let nav = HSTRING::from(overlay2.as_str());
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
    Ok(())
}
