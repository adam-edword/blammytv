//! The file side of Settings → App → Export and Import settings (plan 025,
//! P4c): what the two commands check and read around the file dialogs.
//!
//! The dialogs are tauri-plugin-dialog's, called from Rust in lib.rs
//! (`settings_export`, `settings_import`). The page never names a path: the
//! only place one comes from is the dialog the person is using, so nothing is
//! written or read anywhere they did not pick. A name the page offers is only
//! the dialog's starting suggestion, and is cleaned here (`suggested_name`) so
//! it cannot be anything but a file name.
//!
//! A settings file is small, a few hundred KB at most. It is capped either way
//! at 5 MB, so a stray choice (a video, a disk image) is refused without being
//! read into memory, and a page that went wrong cannot write a file of any
//! size. The cap is the page's to explain: it gets `TOO_BIG`.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

use std::fs::File;
use std::io::Read;
use std::path::Path;

/// The most a settings file may be, to write or to read: 5 MB.
pub const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// What the page is told when the file is over the cap, either way.
pub const TOO_BIG: &str = "too-big";

/// What the page is told when the picked file is not text.
pub const NOT_TEXT: &str = "not-text";

/// What the page is told when it asks to save nothing. The page asks exactly
/// that to find out whether this build has the command at all (an older one
/// answers "not found" instead), so no dialog may open for it.
pub const NOTHING: &str = "refused: nothing to save";

/// The name offered when the page's is empty or all separators.
pub const DEFAULT_NAME: &str = "blammytv-settings.json";

/// The longest stem offered, in characters. The dialog takes any length, but a
/// path with a Windows MAX_PATH ahead of it does not.
const STEM_MAX: usize = 100;

/// Whether `json` is something to save: not empty, and not over the cap.
/// Checked before any dialog opens.
pub fn check_export(json: &str) -> Result<(), String> {
    if json.trim().is_empty() {
        return Err(NOTHING.to_string());
    }
    if json.len() as u64 > MAX_BYTES {
        return Err(TOO_BIG.to_string());
    }
    Ok(())
}

/// A file name for the save dialog to start on, from whatever the page sent:
/// the last piece after any `/` or `\`, without control characters or the ones
/// Windows refuses in a name (`< > : " | ? *`), trimmed, its stem held to
/// STEM_MAX, and ending `.json`. Empty comes out as DEFAULT_NAME.
pub fn suggested_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let cleaned = cleaned.trim();
    // `.json` is ASCII, so lower-casing keeps every length and the cut below
    // lands on a character boundary.
    let stem = if cleaned.to_ascii_lowercase().ends_with(".json") {
        &cleaned[..cleaned.len() - ".json".len()]
    } else {
        cleaned
    };
    let stem: String = stem
        .trim()
        .trim_matches('.')
        .trim()
        .chars()
        .take(STEM_MAX)
        .collect();
    if stem.is_empty() {
        return DEFAULT_NAME.to_string();
    }
    format!("{stem}.json")
}

/// Why a picked file could not be read.
#[derive(Debug, PartialEq)]
pub enum ReadError {
    /// Over the cap.
    TooBig,
    /// Not UTF-8.
    NotText,
    /// The system said no. Its words, which have no path in them.
    Io(String),
}

impl ReadError {
    /// What goes to the page.
    pub fn message(&self) -> String {
        match self {
            ReadError::TooBig => TOO_BIG.to_string(),
            ReadError::NotText => NOT_TEXT.to_string(),
            ReadError::Io(e) => format!("could not read the file: {e}"),
        }
    }
}

/// The file's text, when it is at most `max` bytes. At most `max + 1` bytes are
/// ever read, so a file of any size costs the cap and not its length.
pub fn read_capped(path: &Path, max: u64) -> Result<String, ReadError> {
    let file = File::open(path).map_err(|e| ReadError::Io(e.to_string()))?;
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| ReadError::Io(e.to_string()))?;
    if bytes.len() as u64 > max {
        return Err(ReadError::TooBig);
    }
    String::from_utf8(bytes).map_err(|_| ReadError::NotText)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own for one test, gone when it is dropped.
    struct Dir(std::path::PathBuf);
    impl Dir {
        fn new(tag: &str) -> Dir {
            let d = std::env::temp_dir().join(format!(
                "blammytv-settingsfile-{tag}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            Dir(d)
        }
        fn put(&self, name: &str, bytes: &[u8]) -> std::path::PathBuf {
            let p = self.0.join(name);
            std::fs::write(&p, bytes).unwrap();
            p
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_cap_is_five_megabytes() {
        assert_eq!(MAX_BYTES, 5_242_880);
    }

    #[test]
    fn a_file_at_the_cap_is_read_and_one_byte_over_is_not() {
        let d = Dir::new("edge");
        let at = d.put("at.json", &vec![b'a'; 100]);
        let over = d.put("over.json", &vec![b'a'; 101]);
        assert_eq!(read_capped(&at, 100).map(|s| s.len()), Ok(100));
        assert_eq!(read_capped(&over, 100), Err(ReadError::TooBig));
        // And a file well past it is the same answer, not a read of all of it.
        let far = d.put("far.json", &vec![b'a'; 100_000]);
        assert_eq!(read_capped(&far, 100), Err(ReadError::TooBig));
    }

    #[test]
    fn the_real_cap_refuses_a_file_just_over_five_megabytes() {
        let d = Dir::new("real-cap");
        let at = d.put("at.json", &vec![b' '; MAX_BYTES as usize]);
        let over = d.put("over.json", &vec![b' '; MAX_BYTES as usize + 1]);
        assert_eq!(
            read_capped(&at, MAX_BYTES).map(|s| s.len()),
            Ok(MAX_BYTES as usize)
        );
        assert_eq!(read_capped(&over, MAX_BYTES), Err(ReadError::TooBig));
    }

    #[test]
    fn an_empty_file_is_an_empty_text_and_the_page_decides_what_that_is() {
        let d = Dir::new("empty");
        let p = d.put("empty.json", b"");
        assert_eq!(read_capped(&p, 100), Ok(String::new()));
    }

    #[test]
    fn text_is_returned_as_it_is_with_its_byte_order_mark() {
        let d = Dir::new("bom");
        let p = d.put("bom.json", b"\xEF\xBB\xBF{\"a\":1}");
        assert_eq!(read_capped(&p, 100), Ok("\u{feff}{\"a\":1}".to_string()));
    }

    #[test]
    fn a_file_that_is_not_utf8_is_not_text() {
        let d = Dir::new("binary");
        let p = d.put(
            "movie.mkv",
            &[0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xfe, 0x00, 0x80],
        );
        assert_eq!(read_capped(&p, 100), Err(ReadError::NotText));
    }

    #[test]
    fn a_file_that_is_not_there_is_an_io_error_with_no_path_in_it() {
        let d = Dir::new("missing");
        let p = d.0.join("not-there.json");
        let got = read_capped(&p, 100);
        assert!(matches!(got, Err(ReadError::Io(_))));
        let said = got.unwrap_err().message();
        assert!(said.starts_with("could not read the file: "));
        assert!(
            !said.contains("not-there") && !said.contains("blammytv-settingsfile"),
            "{said}"
        );
    }

    #[test]
    fn what_the_page_is_told_for_each_failure() {
        assert_eq!(ReadError::TooBig.message(), "too-big");
        assert_eq!(ReadError::NotText.message(), "not-text");
    }

    #[test]
    fn nothing_to_save_is_refused_before_any_dialog_and_so_is_too_much() {
        assert_eq!(check_export(""), Err(NOTHING.to_string()));
        assert_eq!(check_export(" \n\t "), Err(NOTHING.to_string()));
        assert_eq!(check_export("{}"), Ok(()));
        let at = "a".repeat(MAX_BYTES as usize);
        let over = "a".repeat(MAX_BYTES as usize + 1);
        assert_eq!(check_export(&at), Ok(()));
        assert_eq!(check_export(&over), Err(TOO_BIG.to_string()));
    }

    #[test]
    fn a_suggested_name_is_a_file_name_ending_json() {
        assert_eq!(
            suggested_name("blammytv-settings-2026-10-12.json"),
            "blammytv-settings-2026-10-12.json"
        );
        assert_eq!(suggested_name("mine"), "mine.json");
        assert_eq!(suggested_name("MINE.JSON"), "MINE.json");
        assert_eq!(suggested_name("a.b.json"), "a.b.json");
    }

    #[test]
    fn a_suggested_name_is_never_a_path() {
        assert_eq!(suggested_name("C:\\Users\\adam\\Desktop\\x.json"), "x.json");
        assert_eq!(suggested_name("../../etc/passwd"), "passwd.json");
        assert_eq!(suggested_name("/var/tmp/"), DEFAULT_NAME);
        assert_eq!(suggested_name("..\\..\\boot.ini"), "boot.ini.json");
    }

    #[test]
    fn a_suggested_name_loses_what_windows_refuses_and_every_control_character() {
        assert_eq!(suggested_name("a<b>c:d\"e|f?g*h.json"), "abcdefgh.json");
        assert_eq!(suggested_name("one\ntwo\u{7}.json"), "onetwo.json");
        assert_eq!(suggested_name("  spaced out  .json"), "spaced out.json");
    }

    #[test]
    fn an_empty_or_all_dots_suggestion_is_the_default() {
        for raw in [
            "", "   ", ".", "...", ".json", " .json", "\n", "<>:|?*", "///",
        ] {
            assert_eq!(suggested_name(raw), DEFAULT_NAME, "{raw:?}");
        }
    }

    #[test]
    fn a_long_suggestion_is_cut_in_the_stem_and_still_ends_json() {
        let got = suggested_name(&format!("{}.json", "x".repeat(300)));
        assert_eq!(got.chars().count(), STEM_MAX + ".json".len());
        assert!(got.ends_with(".json"));
        // Counted in characters, so a multi-byte one is never split.
        let wide = suggested_name(&"é".repeat(300));
        assert_eq!(wide.chars().count(), STEM_MAX + ".json".len());
    }
}
