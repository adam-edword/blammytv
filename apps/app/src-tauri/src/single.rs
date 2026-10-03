//! One copy of the app per Windows session (audit NA1).
//!
//! A second launch used to run the whole startup beside the first. Two things
//! break when it does. Trakt's refresh token is single-use: the second copy
//! loads the token the first just spent, its refresh gets a 400, and
//! `refresh_locked` clears the vault, so Trakt signs out. And `context()`
//! calls `frontend::resolve()`, which arms the hot channel's boot sentinel
//! for a staged bundle; a copy that exits without reaching `frontend_ready`
//! leaves it armed, and two of those quarantine a good bundle (plan 016 N1's
//! two-failure rule).
//!
//! `tauri-plugin-single-instance` was built and taken out: it acts in its
//! plugin `setup`, and `.run(context())` evaluates `context()` first, so the
//! second copy has already armed the sentinel by then. This check runs
//! before any of that, as the first thing `run()` does.
//!
//! The signal is a named mutex that nobody owns: its existence is the answer,
//! so any thread can give it up by closing the handle (`release`). A second
//! copy finds the name taken, brings the first one's window forward and
//! returns from `run()`.

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use windows::core::{BOOL, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, SetLastError, ERROR_ALREADY_EXISTS, HANDLE, HWND, LPARAM, NO_ERROR,
};
use windows::Win32::System::Threading::{
    CreateMutexW, GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};

/// The mutex's name: `identifier` in tauri.conf.json under `Local\`, the
/// session's own namespace, so a second signed-in user gets their own copy as
/// before. A test holds this to the config.
const MUTEX_NAME: &str = "Local\\com.blammytv.app.single-instance";

/// The main window's title: `app.windows[0].title` in tauri.conf.json. Nothing
/// sets a title at runtime. A test holds this to the config.
const MAIN_TITLE: &str = "BlammyTV";

/// The mutex handle, kept for the life of the process. 0 = nothing claimed (a
/// dev build, or `release` already ran). An isize so a static can hold it, as
/// inv.rs does with its child window.
static HELD: AtomicIsize = AtomicIsize::new(0);

/// What Windows said about the name.
enum Claimed {
    /// Nobody had it. The handle is ours to keep.
    First(HANDLE),
    /// Another copy holds it.
    Taken,
    /// The call failed outright. Can't tell, so the caller carries on.
    Unknown,
}

/// Ask for the named mutex, not initially owned. A name that already exists
/// still returns a valid handle, with ERROR_ALREADY_EXISTS as the last error,
/// which has to be read before anything else can overwrite it. The last error
/// is cleared first, so a stale one from earlier can never read as a second
/// copy: that would keep the app from starting at all.
fn create(name: &str) -> Claimed {
    let name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { SetLastError(NO_ERROR) };
    let handle = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) };
    let exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    match handle {
        Ok(h) if exists => {
            // Closed at once: a refusal must not keep the name alive.
            let _ = unsafe { CloseHandle(h) };
            Claimed::Taken
        }
        Ok(h) => Claimed::First(h),
        Err(_) => Claimed::Unknown,
    }
}

/// Call first in `run()`, before `tauri::Builder` and so before `context()`.
/// Returns true when this is the only copy (or Windows can't say) and startup
/// should go on. Returns false when another copy runs: its window has been
/// brought forward and the caller returns, with nothing else having run.
///
/// Release builds only. A dev build (`pnpm tauri dev`) claims nothing and
/// checks nothing, so it runs beside the installed app as it always has.
pub fn claim() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    match create(MUTEX_NAME) {
        Claimed::First(h) => {
            HELD.store(h.0 as isize, Ordering::SeqCst);
            true
        }
        Claimed::Taken => {
            hand_off();
            false
        }
        Claimed::Unknown => true,
    }
}

/// Give the name up. `app.restart()` spawns the new process before this one
/// has exited, so without this the new copy would find the name taken, hand
/// off to a window that is closing, and exit: applying an update would close
/// the app instead of restarting it. Call it immediately before every
/// `app.restart()`. Nothing to do where nothing was claimed.
pub fn release() {
    let held = HELD.swap(0, Ordering::SeqCst);
    if held != 0 {
        let _ = unsafe { CloseHandle(HANDLE(held as *mut c_void)) };
    }
}

/// Is this window the first copy's main window? Visible, titled exactly like
/// ours, in another process, and that process runs a file with our file name
/// (compared case-insensitively). The title alone would match an Explorer
/// window on a folder called BlammyTV; the file name alone would match the
/// PiP. `image` looks the process's file up, and only runs once the cheaper
/// tests have passed.
fn is_first_copys_window(
    visible: bool,
    title: &str,
    pid: u32,
    own_pid: u32,
    image: impl FnOnce() -> Option<String>,
    own_image: &str,
) -> bool {
    visible
        && title == MAIN_TITLE
        && pid != own_pid
        && image().is_some_and(|theirs| {
            file_name(&theirs).to_lowercase() == file_name(own_image).to_lowercase()
        })
}

/// The last part of a Windows path. Splits on `/` too, so the tests need no
/// Windows to read a path.
fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

/// What the window search carries through EnumWindows.
struct Search {
    own_pid: u32,
    own_image: String,
    found: Option<HWND>,
}

/// Find the first copy's window and bring it forward. No window (the first
/// copy is still starting, or is closing) is fine: the caller exits anyway.
fn hand_off() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut search = Search {
        own_pid: unsafe { GetCurrentProcessId() },
        own_image: exe.to_string_lossy().into_owned(),
        found: None,
    };
    // Stopping the walk early makes EnumWindows report an error. Nothing to
    // do with it either way.
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
    if let Some(hwnd) = search.found {
        bring_forward(hwnd);
    }
}

unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam.0 as *mut Search);
    let visible = IsWindowVisible(hwnd).as_bool();
    // MAIN_TITLE is 8 characters; a longer title is cut short and still
    // can't equal it.
    let mut text = [0u16; 64];
    let len = GetWindowTextW(hwnd, &mut text).max(0) as usize;
    let title = String::from_utf16_lossy(&text[..len]);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if is_first_copys_window(
        visible,
        &title,
        pid,
        search.own_pid,
        || image_path(pid),
        &search.own_image,
    ) {
        search.found = Some(hwnd);
        return false.into();
    }
    true.into()
}

/// The full path of the file a process runs. None for a process we can't ask
/// about (an elevated one, say).
fn image_path(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let asked = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        asked.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Restore only a minimised window: restoring a maximised one un-maximises
/// it. This process was just launched by the user, so Windows lets it take
/// the foreground; where it can't, nothing breaks.
fn bring_forward(hwnd: HWND) {
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const OURS: &str = r"C:\Users\adam\AppData\Local\BlammyTV\BlammyTV.exe";

    /// A window with every test passing, then one thing changed per case.
    fn first_copys_window(visible: bool, title: &str, pid: u32, image: Option<&str>) -> bool {
        is_first_copys_window(visible, title, pid, 100, || image.map(String::from), OURS)
    }

    #[test]
    fn the_first_copys_main_window_qualifies() {
        assert!(first_copys_window(true, "BlammyTV", 200, Some(OURS)));
    }

    #[test]
    fn the_file_name_is_compared_without_case_and_without_the_folder() {
        // A different install folder, and a different case: still ours.
        assert!(first_copys_window(
            true,
            "BlammyTV",
            200,
            Some(r"D:\Apps\blammytv\BLAMMYTV.EXE"),
        ));
    }

    #[test]
    fn a_window_that_is_not_visible_does_not() {
        assert!(!first_copys_window(false, "BlammyTV", 200, Some(OURS)));
    }

    #[test]
    fn the_pip_does_not() {
        // Our file name, our process family, but not the main window's title.
        assert!(!first_copys_window(
            true,
            "BlammyTV \u{2014} Popout",
            200,
            Some(OURS),
        ));
    }

    #[test]
    fn an_explorer_window_on_a_folder_called_blammytv_does_not() {
        // The title matches; the process is not ours.
        assert!(!first_copys_window(
            true,
            "BlammyTV",
            300,
            Some(r"C:\Windows\explorer.exe"),
        ));
    }

    #[test]
    fn this_process_does_not() {
        assert!(!first_copys_window(true, "BlammyTV", 100, Some(OURS)));
    }

    #[test]
    fn a_process_that_cannot_be_asked_does_not() {
        assert!(!first_copys_window(true, "BlammyTV", 200, None));
    }

    #[test]
    fn a_title_that_only_starts_with_ours_does_not() {
        assert!(!first_copys_window(true, "BlammyTV2", 200, Some(OURS)));
        assert!(!first_copys_window(true, "blammytv", 200, Some(OURS)));
    }

    #[test]
    fn the_process_is_only_asked_once_the_cheap_tests_pass() {
        let asked = Cell::new(false);
        let ask = || {
            asked.set(true);
            Some(String::from(OURS))
        };
        assert!(!is_first_copys_window(
            false, "BlammyTV", 200, 100, ask, OURS
        ));
        assert!(!asked.get());
        let ask = || {
            asked.set(true);
            Some(String::from(OURS))
        };
        assert!(is_first_copys_window(true, "BlammyTV", 200, 100, ask, OURS));
        assert!(asked.get());
    }

    #[test]
    fn file_name_reads_either_kind_of_slash() {
        assert_eq!(file_name(r"C:\a\b\BlammyTV.exe"), "BlammyTV.exe");
        assert_eq!(file_name("/a/b/BlammyTV.exe"), "BlammyTV.exe");
        assert_eq!(file_name("BlammyTV.exe"), "BlammyTV.exe");
    }

    /// The two constants are copies of config values; if the config moves,
    /// this says so instead of the guard quietly matching nothing.
    #[test]
    fn the_constants_match_tauri_conf_json() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let id = conf["identifier"].as_str().unwrap();
        assert_eq!(MUTEX_NAME, format!("Local\\{id}.single-instance"));
        assert_eq!(
            MAIN_TITLE,
            conf["app"]["windows"][0]["title"].as_str().unwrap()
        );
    }

    /// Tests run as a debug build, which claims nothing.
    #[cfg(debug_assertions)]
    #[test]
    fn a_dev_build_claims_nothing_and_release_is_then_a_no_op() {
        assert!(claim());
        assert_eq!(HELD.load(Ordering::SeqCst), 0);
        release();
    }

    /// The Win32 behaviour the guard leans on, against a name of its own: a
    /// second asker is refused while the first holds the name, and gets it
    /// once the first has closed its handle (what `release` does).
    #[test]
    fn a_name_is_taken_until_its_holder_closes_the_handle() {
        let name = format!("Local\\blammytv-single-test-{}", std::process::id());
        let Claimed::First(first) = create(&name) else {
            panic!("a fresh name was not ours");
        };
        assert!(matches!(create(&name), Claimed::Taken));
        let _ = unsafe { CloseHandle(first) };
        let Claimed::First(again) = create(&name) else {
            panic!("the name stayed taken after its holder closed the handle");
        };
        let _ = unsafe { CloseHandle(again) };
    }
}
