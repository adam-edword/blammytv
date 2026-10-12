//! What Settings → App shows that only native knows (plan 025, P4a): About's
//! versions, and What's new's notes.
//!
//! Both are text that goes to the page to be SHOWN, nothing else. So both are
//! cleaned here, once, before they leave:
//!
//!   - a version is one short token. Never a path, a URL or a user name: a
//!     string that carries a separator, or a space, or is not made of the
//!     characters a version is made of, is not sent at all (the row is simply
//!     not shown);
//!   - a note is the release's own words, from an unsigned file that came over
//!     the network. It is capped and stripped of control characters, and the
//!     page draws it as text and never as HTML.
//!
//! The notes of a staged frontend bundle wait on disk beside the bundle, in the
//! hot channel's folder (frontend.rs), one file per version. They are not in
//! `active.json`: that record decides what is served, and text from the network
//! has no business in it. Nothing here is read by `should_stage` or by
//! `resolve`.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! frontend.rs and lib.rs cannot be built on Linux.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// What `about_versions` answers with. Every field is optional and left out
/// when it is not known, so a page asking an older or a partly working native
/// shows the rows it got and no others.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Versions {
    /// This native build (Cargo's version), which is not the frontend's: the
    /// two ship apart.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native: Option<String>,
    /// mpv's own, from its `mpv-version` property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mpv: Option<String>,
    /// The FFmpeg inside mpv, from its `ffmpeg-version` property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg: Option<String>,
    /// The ffmpeg multi-view converts HEVC with: its own file, not mpv's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundled_ffmpeg: Option<String>,
    /// Which Vulkan loader the player runs against (mpvvulkan.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vulkan: Option<String>,
}

/// The most characters of a version that is passed on. Longer is cut, not
/// refused: a distribution's build string can be long, and it is still a
/// version.
const VERSION_MAX: usize = 64;

/// A version string fit to show, or None when what mpv or ffmpeg said is not
/// one. Takes the first line, cuts it at the copyright notice some of them
/// carry, drops a leading "mpv ", and checks what is left is made of the
/// characters a version is made of: letters, digits and `. - + _ ~`. A path,
/// a URL or a name has a separator or a space in it, and fails that.
pub fn version_text(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line.split("Copyright").next().unwrap_or(line).trim();
    let line = line.strip_prefix("mpv ").unwrap_or(line).trim();
    let line: String = line.chars().take(VERSION_MAX).collect();
    let fits = !line.is_empty()
        && line
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_' | '~'));
    fits.then_some(line)
}

/// The version out of the first line `ffmpeg -version` prints:
/// `ffmpeg version N-118163-g0f7dc5dbc3-20241030 Copyright (c) 2000-2024 ...`
/// is `N-118163-g0f7dc5dbc3-20241030`. None when that line is not that shape,
/// as when the file is not ffmpeg.
pub fn ffmpeg_version(banner: &str) -> Option<String> {
    let rest = banner.trim().strip_prefix("ffmpeg version ")?;
    version_text(rest.split_whitespace().next()?)
}

// ---------------------------------------------------------------- notes

/// The most characters of a note that is kept. A release's notes are a few
/// lines; this is for a file that is not.
const NOTES_MAX: usize = 2000;

/// A note fit to hand to the page: line endings made `\n`, every other control
/// character dropped, trimmed, and cut at NOTES_MAX characters. It stays plain
/// text, with its Markdown in it: the page strips the headings and draws the
/// rest as text.
pub fn clean_notes(raw: &str) -> String {
    let text: String = raw
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .map(|c| if c == '\t' { ' ' } else { c })
        .filter(|c| *c == '\n' || !c.is_control())
        .take(NOTES_MAX)
        .collect();
    text.trim().to_string()
}

/// Where a staged version's notes wait. A leading dot, so that no version
/// string can name it (a version's parts are never empty: frontend.rs
/// `valid_version`), and a folder of staged bundles has nothing it could be
/// mistaken for.
fn notes_path(root: &Path, version: &str) -> PathBuf {
    root.join(format!(".notes-{version}"))
}

/// Keep `notes` for `version`, and forget the notes of any other: one bundle
/// is pending at a time. Best effort, as everything beside the bundle is: a
/// note that can't be written is a note that isn't shown. Empty notes keep
/// nothing.
pub fn write_notes(root: &Path, version: &str, notes: &str) {
    let mine = notes_path(root, version);
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(".notes-") && e.path() != mine {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let notes = clean_notes(notes);
    if notes.is_empty() {
        let _ = std::fs::remove_file(&mine);
        return;
    }
    let _ = std::fs::create_dir_all(root);
    let _ = std::fs::write(&mine, notes);
}

/// The notes kept for `version`, or "" when there are none. Cleaned again on
/// the way out: the file is in a folder the user can open.
pub fn read_notes(root: &Path, version: &str) -> String {
    std::fs::read_to_string(notes_path(root, version))
        .map(|s| clean_notes(&s))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("blammytv-about-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_the_version_out_of_ffmpegs_first_line() {
        // A master build, as BtbN and shinchiro publish them.
        assert_eq!(
            ffmpeg_version(
                "ffmpeg version N-118163-g0f7dc5dbc3-20241030 Copyright (c) 2000-2024 the FFmpeg developers"
            )
            .as_deref(),
            Some("N-118163-g0f7dc5dbc3-20241030")
        );
        // A release.
        assert_eq!(
            ffmpeg_version("ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers")
                .as_deref(),
            Some("7.1")
        );
        // A distribution's, with a plus and a tilde in it.
        assert_eq!(
            ffmpeg_version("ffmpeg version 6.1.1-3ubuntu5+esm1~22.04 Copyright (c) 2000-2023")
                .as_deref(),
            Some("6.1.1-3ubuntu5+esm1~22.04")
        );
    }

    #[test]
    fn a_first_line_that_is_not_ffmpegs_is_no_version() {
        for bad in [
            "",
            "ffmpeg version",
            "ffmpeg version  ",
            "ffmpeg: command not found",
            "ffprobe version 7.1 Copyright",
            "C:\\Program Files\\x\\ffmpeg.exe: not recognized",
        ] {
            assert_eq!(ffmpeg_version(bad), None, "took {bad:?}");
        }
    }

    #[test]
    fn mpvs_string_loses_its_name_and_its_copyright() {
        assert_eq!(
            version_text("mpv 0.41.0-dev-g8aca7b0d5").as_deref(),
            Some("0.41.0-dev-g8aca7b0d5")
        );
        assert_eq!(
            version_text("mpv v0.38.0 Copyright © 2000-2023 mpv/MPlayer/mplayer2 projects")
                .as_deref(),
            Some("v0.38.0")
        );
        // The first line that says anything.
        assert_eq!(
            version_text("\n  \nmpv 0.37.0\nsecond").as_deref(),
            Some("0.37.0")
        );
        // ffmpeg's own, through av_version_info().
        assert_eq!(
            version_text("N-117823-gabcdef").as_deref(),
            Some("N-117823-gabcdef")
        );
        assert_eq!(version_text("7.1.1").as_deref(), Some("7.1.1"));
    }

    #[test]
    fn nothing_that_could_be_a_path_a_url_or_a_name_is_a_version() {
        for bad in [
            "",
            "   ",
            "C:\\Users\\adam\\AppData\\mpv",
            "/home/adam/.config/mpv",
            "https://example.test/mpv",
            "adam@host",
            "mpv 0.41 built by adam",
            "0.41 (custom)",
            "v0.41\u{0}",
        ] {
            assert_eq!(version_text(bad), None, "took {bad:?}");
        }
    }

    #[test]
    fn a_long_version_is_cut_not_refused() {
        let long = "1.".repeat(100);
        let got = version_text(&long).expect("refused a long version");
        assert_eq!(got.chars().count(), VERSION_MAX);
    }

    #[test]
    fn versions_leave_out_what_they_do_not_know() {
        let v = Versions {
            native: Some("0.11.36".into()),
            bundled_ffmpeg: Some("7.1".into()),
            vulkan: Some("Windows' own".into()),
            ..Default::default()
        };
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "native": "0.11.36", "bundledFfmpeg": "7.1", "vulkan": "Windows' own" })
        );
        assert_eq!(
            serde_json::to_value(Versions::default()).unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn a_note_is_plain_text_of_a_bounded_size() {
        assert_eq!(
            clean_notes("  # Big one\r\nLine two\r\n\r\n"),
            "# Big one\nLine two"
        );
        // Control characters go, tabs become spaces, a lone CR is a line.
        assert_eq!(clean_notes("a\u{0}b\u{7}\tc\rd"), "ab c\nd");
        // Markup is left as it is: it is the page that draws it as text.
        assert_eq!(clean_notes("<b>x</b>"), "<b>x</b>");
        assert_eq!(clean_notes(""), "");
        assert_eq!(
            clean_notes(&"x".repeat(NOTES_MAX + 500)).chars().count(),
            NOTES_MAX
        );
    }

    #[test]
    fn notes_are_kept_beside_the_bundle_and_read_back_clean() {
        let root = tmpdir("notes");
        write_notes(&root, "0.11.36", "# New\nA fix");
        assert_eq!(read_notes(&root, "0.11.36"), "# New\nA fix");
        // Another version has none.
        assert_eq!(read_notes(&root, "0.11.37"), "");
        // A new bundle's notes replace the old one's file.
        write_notes(&root, "0.11.37", "Newer");
        assert_eq!(read_notes(&root, "0.11.37"), "Newer");
        assert_eq!(read_notes(&root, "0.11.36"), "", "the old notes were kept");
        // Empty notes keep nothing, and clear what was there for the version.
        write_notes(&root, "0.11.37", "   ");
        assert_eq!(read_notes(&root, "0.11.37"), "");
        assert!(!notes_path(&root, "0.11.37").exists());
        // A file edited by hand is cleaned on the way out.
        std::fs::write(notes_path(&root, "0.11.38"), "ok\u{0}\u{1b}[31m").unwrap();
        assert_eq!(read_notes(&root, "0.11.38"), "ok[31m");
        // A folder that is not there reads as none, and writing makes it.
        let gone = root.join("later");
        assert_eq!(read_notes(&gone, "1.0"), "");
        write_notes(&gone, "1.0", "hi");
        assert_eq!(read_notes(&gone, "1.0"), "hi");
        std::fs::remove_dir_all(&root).ok();
    }
}
