// One-shot architecture spike: prove the Telly-style LAYER INVERSION — a
// native mpv child parked at the BOTTOM of the z-order with the transparent
// UI webview above it — composites cleanly in our Tauri window. Throwaway:
// delete this module once the inversion ships (or is rejected).
//
// The discovery that motivated it: Desktop Telly's window tree is
// wry/WebView2 + an `mpv` child — our exact stack — with the webview
// enumerated ABOVE the video child (settings-over-video for free). comp.rs
// does the opposite (mpv at HWND_TOP + a second composited overlay webview);
// if this spike holds, that whole subsystem can be replaced. See ROADMAP
// "Layer inversion".

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, WINDOW_EX_STYLE, WS_CHILD, WS_VISIBLE,
};

static CHILD: AtomicIsize = AtomicIsize::new(0);

/// Create the video child UNDER the webview and start mpv into it.
/// `bitblt` mirrors mpv.rs's `composited` flag: `d3d11-flip=no` (bitblt
/// present through DWM) vs mpv's default flip-model swapchain — the spike
/// compares both under the inverted stacking. UI thread only.
pub fn open_under(
    parent: isize,
    w: u32,
    h: u32,
    url: &str,
    bitblt: bool,
) -> Result<(), String> {
    close();
    unsafe {
        let parent = HWND(parent as *mut c_void);
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
        // THE experiment: bottom of the z-order. wry's webview stays above,
        // and its transparent pixels must reveal the video behind them
        // (comp.rs forces the exact opposite with HWND_TOP).
        let _ = SetWindowPos(
            child,
            Some(HWND_BOTTOM),
            0,
            0,
            w as i32,
            h as i32,
            SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
        crate::mpv::play_wid(url, child.0 as isize, bitblt, 0.0)?;
        CHILD.store(child.0 as isize, Ordering::SeqCst);
    }
    Ok(())
}

/// Stop the spike's playback and drop its child window. Safe to call idly.
/// NOTE: mpv is the shared composition PLAYER instance, so this also stops a
/// channel playing in the main window — acceptable for a dev spike. UI
/// thread only.
pub fn close() {
    crate::mpv::stop();
    let child = CHILD.swap(0, Ordering::SeqCst);
    if child != 0 {
        unsafe {
            let _ = DestroyWindow(HWND(child as *mut c_void));
        }
    }
}
