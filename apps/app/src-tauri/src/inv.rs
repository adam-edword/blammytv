// Inverted-layer player — the Telly arrangement, spike-proven in v0.1.115
// and THE architecture since v0.1.132: the mpv child sits at the BOTTOM of
// the main window's z-order and the transparent UI webview renders ABOVE it
// (the frontend cuts a clip-path hole where the video shows through). The
// old comp.rs overlay subsystem this superseded was deleted at the v0.2.0
// milestone; player chrome is plain React in the main webview.

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, WINDOW_EX_STYLE, WS_CHILD, WS_VISIBLE,
};

static CHILD: AtomicIsize = AtomicIsize::new(0);

/// Open the video child at the given rect (PHYSICAL px, window-client
/// coords), parked at the bottom of the z-order, and start mpv into it.
/// Flip present model (the quality path — the spike confirmed it composites
/// under the webview). UI thread only.
pub fn open(
    parent: isize,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    url: &str,
) -> Result<(), String> {
    close();
    unsafe {
        let parent = HWND(parent as *mut c_void);
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
        let _ = SetWindowPos(
            child,
            Some(HWND_BOTTOM),
            x,
            y,
            w as i32,
            h as i32,
            SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
        crate::mpv::play_wid(url, child.0 as isize, false, 0.0)?;
        CHILD.store(child.0 as isize, Ordering::SeqCst);
    }
    // One line of ground truth for the upgrade question: which libmpv did
    // the loader actually find? (Terminal-visible, once per open.)
    if let Some(v) = crate::mpv::get_property("mpv-version") {
        println!("[mpv] {v}");
    }
    Ok(())
}

/// Follow the slot box (scroll/resize/theater/fullscreen — the frontend's
/// rAF drives this, same contract as comp::set_rect). Re-pins to the bottom
/// of the z-order on every move. UI thread only.
pub fn set_rect(x: i32, y: i32, w: u32, h: u32) {
    let child = CHILD.load(Ordering::SeqCst);
    if child == 0 {
        return;
    }
    unsafe {
        let _ = SetWindowPos(
            HWND(child as *mut c_void),
            Some(HWND_BOTTOM),
            x,
            y,
            w as i32,
            h as i32,
            SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
    }
}

/// Stop playback and drop the child. Safe to call idly. UI thread only.
pub fn close() {
    crate::mpv::stop();
    let child = CHILD.swap(0, Ordering::SeqCst);
    if child != 0 {
        unsafe {
            let _ = DestroyWindow(HWND(child as *mut c_void));
        }
    }
}
