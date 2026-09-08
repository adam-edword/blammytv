// Inverted-layer player — the Telly arrangement, spike-proven in v0.1.115
// and THE architecture since v0.1.132: the mpv child sits at the BOTTOM of
// the main window's z-order and the transparent UI webview renders ABOVE it
// (the frontend cuts a clip-path hole where the video shows through). The
// old comp.rs overlay subsystem this superseded was deleted at the v0.2.0
// milestone; player chrome is plain React in the main webview.

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};

use crate::mpv::SLOTS;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, WINDOW_EX_STYLE, WINDOW_STYLE, WS_CHILD, WS_VISIBLE,
};

/// Where a tile sits, in PHYSICAL px in window-client coords.
///
/// Four loose numbers threaded through three functions is what pushed `open`
/// past clippy's argument limit once a slot joined them, and they were
/// always one value anyway.
#[derive(Clone, Copy)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// One child window per player slot: the 2x2 multiview grid, and slot 0 on
/// its own for ordinary single-stream playback.
///
/// Each is a separate HWND parked at the bottom of the z-order, exactly as
/// the one child always was, because `wid` is an init-only mpv option and an
/// instance is married to its window for life. A tile is therefore a WINDOW
/// plus an INSTANCE, and neither half can be recycled into another tile.
static CHILDREN: [AtomicIsize; SLOTS] = [
    AtomicIsize::new(0),
    AtomicIsize::new(0),
    AtomicIsize::new(0),
    AtomicIsize::new(0),
];

/// Open the video child at the given rect (PHYSICAL px, window-client
/// coords), parked at the bottom of the z-order, and start mpv into it.
/// Flip present model (the quality path — the spike confirmed it composites
/// under the webview). UI thread only.
pub fn open(
    slot: usize,
    parent: isize,
    at: Rect,
    url: &str,
    // VOD resume point in seconds. mpv applies it as it opens the file, so
    // nothing is decoded from 0:00 first. None for live and for a fresh start.
    start: Option<f64>,
) -> Result<(), String> {
    if slot >= SLOTS {
        return Err(format!("slot {slot} does not exist"));
    }
    let child = ensure_child(slot, parent, at)?;
    if let Err(e) = crate::mpv::play_wid(slot, url, child, start) {
        // Leave the window in place — it is the mpv instance's permanent
        // render target now. Just make sure nothing is holding a stream.
        //
        // THIS SLOT ONLY. The failed tile releases what it was holding; the
        // other three are playing and a failure in one is not a reason to
        // stop them.
        crate::mpv::unload_slot(slot);
        return Err(e);
    }
    Ok(())
}

/// The child window is created ONCE and lives for the process (plan 012
/// phase 1). It cannot be recycled per play any more: `wid` is an init-only
/// mpv option, so the persistent player is bound to this exact HWND for its
/// whole life — destroying it would leave mpv rendering into nothing.
/// Repositioning is `set_rect`'s job and always was.
fn ensure_child(slot: usize, parent: isize, at: Rect) -> Result<isize, String> {
    let existing = CHILDREN[slot].load(Ordering::SeqCst);
    if existing != 0 {
        // Re-pin: a play can arrive at a different rect than the last one
        // left behind (theater vs mini, a resize while stopped).
        set_rect(slot, at);
        return Ok(existing);
    }
    let Rect { x, y, w, h } = at;
    unsafe {
        let parent = HWND(parent as *mut c_void);
        // SS_BLACKRECT (0x4): the static paints itself SOLID BLACK. A bare
        // STATIC has no background brush of its own, and with the top-level
        // window transparent, what fills it before mpv's first frame is
        // machine-dependent — some DWM/driver combos erased it to NOTHING,
        // showing the desktop straight through the clip hole while a
        // channel tuned (seen on a user install; dev machines showed the
        // benign control-gray instead). Black is also the right loading
        // color for a video surface.
        const SS_BLACKRECT: WINDOW_STYLE = WINDOW_STYLE(0x0000_0004);
        let child = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            windows::core::w!("STATIC"),
            windows::core::w!(""),
            WS_CHILD | WS_VISIBLE | SS_BLACKRECT,
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
        // STORED BEFORE THE PLAY, and it must stay stored even if the play
        // fails.
        //
        // play_wid can fail — a missing or incompatible libmpv-2.dll,
        // mpv_create, mpv_initialize, loadfile — and returning with the
        // window created but the slot still 0 used to orphan it: nothing could
        // reach it afterwards, so every retry left another visible black
        // child parked at its old rect at the bottom of the z-order. That is
        // exactly the path a broken libmpv install walks, and the frontend
        // retries. Recording it here means the NEXT attempt reuses this
        // window rather than making a second one.
        CHILDREN[slot].store(child.0 as isize, Ordering::SeqCst);
        Ok(child.0 as isize)
    }
}

/// Follow the slot box (scroll/resize/theater/fullscreen — the frontend's
/// rAF drives this, same contract as comp::set_rect). Re-pins to the bottom
/// of the z-order on every move. UI thread only.
pub fn set_rect(slot: usize, at: Rect) {
    if slot >= SLOTS {
        return;
    }
    let child = CHILDREN[slot].load(Ordering::SeqCst);
    if child == 0 {
        return;
    }
    let Rect { x, y, w, h } = at;
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

/// Stop playback and release the provider connection, KEEPING the window and
/// the mpv instance for the next play. Safe to call idly. UI thread only.
///
/// The window stays because the persistent player is bound to it by the
/// init-only `wid` option, and it stays VISIBLE on purpose. Hiding it here
/// was the first attempt and it flashed the desktop on every channel switch:
/// InvertedPlayer's effect is keyed on the url, so switching runs this
/// cleanup and then immediately re-opens a clip hole while the next stream
/// tunes — with the child hidden and the top-level window transparent, that
/// hole showed the desktop. mpv holds the surface black between files
/// instead (`force-window=yes`, see ensure_player). With no hole open, a
/// black child at the bottom of the z-order is invisible anyway.
///
/// `mpv::unload` is where the connection is actually released — read its
/// comment before changing this.
///
/// Stops EVERY slot, because this is the app's "stop playing". Closing one
/// tile of a grid is `close_slot`.
pub fn close() {
    crate::mpv::unload();
}

/// Stop one tile, leaving the rest of the grid playing. Its window stays,
/// for the same init-only `wid` reason `close` gives.
pub fn close_slot(slot: usize) {
    crate::mpv::unload_slot(slot);
}

/// Process teardown: destroy the instance and the window for good. NOT for
/// stream switching — that is `close`.
///
/// NOT WIRED YET, deliberately. The app bootstraps with a bare
/// `.run(context())` and has no exit hook; adding one means restructuring to
/// `.build()?.run(|_, RunEvent::Exit| …)`, which is a change to how the whole
/// app starts and does not belong in the same commit as the player
/// lifetime. Process exit closes the sockets regardless — this exists so the
/// teardown path is written down and callable the moment that hook lands.
#[allow(dead_code)]
pub fn destroy() {
    crate::mpv::shutdown();
    for slot in &CHILDREN {
        let child = slot.swap(0, Ordering::SeqCst);
        if child != 0 {
            unsafe {
                let _ = DestroyWindow(HWND(child as *mut c_void));
            }
        }
    }
}
