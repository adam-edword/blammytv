//! The log file BlammyTV keeps, and the end of it read back (plan 025, P4b).
//!
//! tauri-plugin-log writes the file (lib.rs `log_plugin`): `blammytv.log` in
//! the app's log folder, in a release build and a dev one alike. At about 1 MB
//! the plugin renames it to `blammytv_<date>.log` and starts a new one, and
//! keeps that one old file and no more (`RotationStrategy::KeepSome(1)`; its
//! `KeepOne` keeps NONE, it deletes the full file). The date is UTC and written
//! year first, so the newest old file is the last by name.
//!
//! This is the reading half, for Settings → App → Copy Diagnostics: the last
//! lines, with the old file's end first when the new one is short, as it is
//! just after a rotation or a first launch. Only lines leave here. The folder's
//! path does not: it has the user's name in it.
//!
//! It also cleans what the page sends to be written (`app_log`): one line, and
//! no more than the page could have meant.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// The file's name without its extension: the plugin adds `.log`, and
/// `_<date>.log` when it rotates.
pub const STEM: &str = "blammytv";

/// How big the file may get before the plugin rotates it. About a megabyte of
/// lines is some ten thousand, which is a long session.
pub const MAX_BYTES: u64 = 1_000_000;

/// The most lines one request is answered with, whatever it asked for.
pub const TAIL_MAX: usize = 1000;

/// The most of one file that is read. The plugin keeps a file near MAX_BYTES,
/// so this is only for a file that rotation failed to keep down.
const READ_MAX: u64 = 2 * MAX_BYTES;

/// The longest a line from the page is written, in characters.
const LINE_MAX: usize = 2000;

/// The file being written now.
pub fn current(dir: &Path) -> PathBuf {
    dir.join(format!("{STEM}.log"))
}

/// The file the plugin rotated the current one into, if there is one: the
/// newest `blammytv_<date>.log`. A `.log.bak` (the plugin's own name for a
/// clash) is not one.
pub fn previous(dir: &Path) -> Option<PathBuf> {
    let prefix = format!("{STEM}_");
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (name.starts_with(&prefix) && name.ends_with(".log")).then(|| (name, e.path()))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, path)| path)
}

/// The last `n` lines of a file, oldest first. Nothing for a file that is not
/// there or cannot be read: a missing log is an empty one, to the page.
///
/// Only the end of a big file is read, and when that starts partway through a
/// line the piece is dropped. Blank lines are skipped, and the text is read
/// lossily, so a byte that is not UTF-8 costs a character and not the lines
/// after it.
fn last_lines(path: &Path, n: usize) -> Vec<String> {
    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    let Ok(len) = file.metadata().map(|m| m.len()) else {
        return Vec::new();
    };
    let start = len.saturating_sub(READ_MAX);
    if start > 0 && file.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if file.take(READ_MAX).read_to_end(&mut bytes).is_err() && bytes.is_empty() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = text.split('\n');
    if start > 0 {
        lines.next();
    }
    let all: Vec<&str> = lines
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty())
        .collect();
    all[all.len().saturating_sub(n)..]
        .iter()
        .map(|l| l.to_string())
        .collect()
}

/// The last `want` lines of the log, oldest first: the current file's, and
/// when it has fewer than that, the end of the one before it ahead of them.
/// `want` is held to TAIL_MAX. A folder with no log in it answers with none.
pub fn tail(dir: &Path, want: usize) -> Vec<String> {
    let want = want.min(TAIL_MAX);
    if want == 0 {
        return Vec::new();
    }
    let mut lines = last_lines(&current(dir), want);
    if lines.len() < want {
        if let Some(old) = previous(dir) {
            let mut before = last_lines(&old, want - lines.len());
            before.append(&mut lines);
            lines = before;
        }
    }
    lines
}

/// A line from the page, fit to be ONE line of the file. Every control
/// character, a line break among them, becomes a space, so a line cannot end
/// early and begin another that looks like ours, and one that is far too long
/// is cut and says so. Trimmed; empty when there is nothing in it.
pub fn clean_line(raw: &str) -> String {
    let flat: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let flat = flat.trim();
    match flat.char_indices().nth(LINE_MAX) {
        Some((cut, _)) => format!("{}…", flat[..cut].trim_end()),
        None => flat.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own for one test, gone when it is dropped.
    struct Dir(PathBuf);
    impl Dir {
        fn new(tag: &str) -> Dir {
            let d = std::env::temp_dir()
                .join(format!("blammytv-logtail-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            Dir(d)
        }
        fn put(&self, name: &str, text: &str) {
            std::fs::write(self.0.join(name), text).unwrap();
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// `first..=last`, one a line, as the log writes them.
    fn numbered(first: usize, last: usize) -> String {
        (first..=last).map(|n| format!("line {n}\n")).collect()
    }
    fn lines(from: &[&str]) -> Vec<String> {
        from.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_last_n_lines_of_the_current_file_oldest_first() {
        let d = Dir::new("last-n");
        d.put("blammytv.log", &numbered(1, 10));
        assert_eq!(tail(&d.0, 3), lines(&["line 8", "line 9", "line 10"]));
        assert_eq!(tail(&d.0, 10).len(), 10);
        assert_eq!(tail(&d.0, 10)[0], "line 1");
    }

    #[test]
    fn a_short_file_is_all_there_is_when_there_is_no_old_one() {
        let d = Dir::new("short-alone");
        d.put("blammytv.log", &numbered(1, 3));
        assert_eq!(tail(&d.0, 200), lines(&["line 1", "line 2", "line 3"]));
    }

    #[test]
    fn a_short_file_is_made_up_from_the_end_of_the_old_one() {
        let d = Dir::new("old-file");
        d.put("blammytv_2026-10-11_09-00-00.log", &numbered(1, 10));
        d.put("blammytv.log", &numbered(11, 12));
        assert_eq!(
            tail(&d.0, 5),
            lines(&["line 8", "line 9", "line 10", "line 11", "line 12"]),
        );
    }

    #[test]
    fn a_file_that_has_enough_does_not_reach_for_the_old_one() {
        let d = Dir::new("enough");
        d.put("blammytv_2026-10-11_09-00-00.log", "old a\nold b\n");
        d.put("blammytv.log", &numbered(1, 5));
        assert_eq!(tail(&d.0, 3), lines(&["line 3", "line 4", "line 5"]));
        // Exactly as many as asked for is enough too.
        assert_eq!(tail(&d.0, 5).first().map(String::as_str), Some("line 1"));
    }

    #[test]
    fn the_newest_old_file_is_the_one_before() {
        let d = Dir::new("newest");
        d.put("blammytv_2026-10-09_09-00-00.log", "older\n");
        d.put("blammytv_2026-10-11_09-00-00.log", "newer\n");
        d.put("blammytv.log", "now\n");
        assert_eq!(tail(&d.0, 3), lines(&["newer", "now"]));
        assert_eq!(
            previous(&d.0).and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())),
            Some("blammytv_2026-10-11_09-00-00.log".to_string()),
        );
    }

    #[test]
    fn a_backup_file_or_another_programs_log_is_not_the_one_before() {
        let d = Dir::new("not-ours");
        d.put("blammytv_2026-10-11_09-00-00.log.bak", "a backup\n");
        d.put("app.log", "an older name\n");
        d.put("blammytv.log", "now\n");
        assert!(previous(&d.0).is_none());
        assert_eq!(tail(&d.0, 5), lines(&["now"]));
    }

    #[test]
    fn a_current_file_that_has_not_been_written_yet_gives_the_old_one() {
        let d = Dir::new("fresh");
        d.put("blammytv_2026-10-11_09-00-00.log", &numbered(1, 4));
        assert_eq!(tail(&d.0, 2), lines(&["line 3", "line 4"]));
    }

    #[test]
    fn no_file_and_no_folder_are_no_lines() {
        let d = Dir::new("missing");
        assert!(tail(&d.0, 200).is_empty());
        assert!(tail(&d.0.join("not-there"), 200).is_empty());
        assert!(previous(&d.0.join("not-there")).is_none());
    }

    #[test]
    fn asking_for_none_is_none_and_asking_for_a_lot_is_held_to_the_most() {
        let d = Dir::new("bounds");
        d.put("blammytv.log", &numbered(1, TAIL_MAX + 50));
        assert!(tail(&d.0, 0).is_empty());
        let got = tail(&d.0, usize::MAX);
        assert_eq!(got.len(), TAIL_MAX);
        assert_eq!(got.last().map(String::as_str), Some(format!("line {}", TAIL_MAX + 50).as_str()));
    }

    #[test]
    fn blank_lines_and_a_windows_line_end_are_not_lines() {
        let d = Dir::new("blank");
        d.put("blammytv.log", "one\r\n\r\n   \ntwo\r\n");
        assert_eq!(tail(&d.0, 10), lines(&["one", "two"]));
    }

    #[test]
    fn a_last_line_the_writer_has_not_finished_is_still_a_line() {
        let d = Dir::new("unfinished");
        d.put("blammytv.log", "one\ntwo");
        assert_eq!(tail(&d.0, 10), lines(&["one", "two"]));
    }

    #[test]
    fn a_byte_that_is_not_utf8_costs_a_character_and_not_the_lines_after_it() {
        let d = Dir::new("lossy");
        std::fs::write(d.0.join("blammytv.log"), b"one\ncaf\xE9 two\nthree\n").unwrap();
        let got = tail(&d.0, 10);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0], "one");
        assert!(got[1].starts_with("caf") && got[1].ends_with(" two"));
        assert_eq!(got[2], "three");
    }

    #[test]
    fn a_file_over_the_read_limit_is_read_from_its_end_and_never_starts_partway_through_a_line() {
        let d = Dir::new("big");
        // Whole lines of 100 bytes, and past READ_MAX, then a last line that
        // is not 100 bytes, so the window's start falls inside a line (47
        // bytes of the way into it) and not on the edge of one.
        let n = (READ_MAX as usize / 100) + 500;
        let mut text = String::with_capacity(n * 100 + 64);
        for i in 0..n {
            text.push_str(&format!("{i:05}{}\n", "y".repeat(94)));
        }
        text.push_str(&format!("{}\n", "x".repeat(46)));
        d.put("blammytv.log", &text);
        let got = last_lines(&current(&d.0), usize::MAX);
        let (last, whole) = got.split_last().unwrap();
        assert_eq!(last, &"x".repeat(46));
        assert!(whole.iter().all(|l| l.len() == 99), "a line was cut");
        // The window holds 19,999 whole lines and the part of one before
        // them, which is dropped.
        assert_eq!(whole.len(), 19_999);
        assert_eq!(whole.last().map(|l| &l[..5]), Some("20499"));
        // And `tail` of that file is the same end, held to its most.
        let t = tail(&d.0, usize::MAX);
        assert_eq!(t.len(), TAIL_MAX);
        assert_eq!(t.last(), Some(last));
    }

    #[test]
    fn a_line_from_the_page_is_one_line() {
        assert_eq!(clean_line("a\nb\r\nc\td"), "a b  c d");
        assert_eq!(clean_line("  padded  "), "padded");
        assert_eq!(clean_line("\u{0}\u{7}x\u{1b}[31m"), "x [31m");
        assert_eq!(clean_line("\n\n"), "");
        assert_eq!(clean_line(""), "");
    }

    #[test]
    fn a_line_from_the_page_that_forges_one_of_ours_cannot() {
        let forged = clean_line("fine\n[2026-10-12][10:00:00][app_lib::mvproxy][ERROR] not us");
        assert!(!forged.contains('\n'));
        assert!(forged.starts_with("fine "));
    }

    #[test]
    fn a_line_from_the_page_is_cut_at_the_most_and_says_so() {
        let long = "z".repeat(LINE_MAX + 50);
        let cut = clean_line(&long);
        assert_eq!(cut.chars().count(), LINE_MAX + 1);
        assert!(cut.ends_with('…'));
        // At the limit exactly it is whole.
        assert_eq!(clean_line(&"z".repeat(LINE_MAX)).chars().count(), LINE_MAX);
        // Counted in characters, so a multi-byte one is never split.
        let wide = "é".repeat(LINE_MAX + 5);
        assert_eq!(clean_line(&wide).chars().count(), LINE_MAX + 1);
    }
}
