//! The external subtitles of a Jellyfin stream, and when mpv is given them
//! (plan 027, batch 4d).
//!
//! A Jellyfin item can carry subtitle files beside the video (`Movie.en.srt`).
//! mpv cannot see them: it is handed the direct stream, one URL. So after the
//! file has loaded each subtitle is added with mpv's own `sub-add`, by URL,
//! with the title and language the server gave it. `jf.rs` makes the lines (it
//! alone knows the signed-in server, and builds every URL itself from a stream
//! it has checked, so the page names no address); this file is what mpv is
//! told and when.
//!
//! WHY AFTER THE LOAD AND NOT WITH IT. `loadfile`'s per-file options are not
//! used anywhere in this app on purpose (mpv.rs `reset_per_file`: 0.38 changed
//! the command's arguments). `sub-add` is a command that takes each argument
//! whole (the address, a flag, a title, a language), so no list separator can
//! split an address, and it carries the title and language a track list shows.
//!
//! WHY `auto` AND NOT `select`. The track is added and mpv's own default
//! choice may take it (a language the user set, a default or forced flag); it
//! is not forced on for everyone who plays the file. The player's remembered
//! subtitle language (TheaterOverlay) is applied on top as for any track.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

/// The most subtitles one stream is given.
pub const MAX_LINES: usize = 16;
/// The largest subtitle index (`Subtitles/{index}/Stream.srt`) that is asked
/// for. A server numbers its streams from 0 and a file does not hold a
/// thousand.
pub const MAX_INDEX: u32 = 999;

const TITLE_MAX: usize = 80;
const TITLE_FALLBACK: &str = "Subtitles";

/// How often the load is looked at, and how long it is waited for before the
/// subtitles are given up on. A stream that has not opened in this long is
/// one the player has failed on, and the subtitles would have no file to join.
pub const POLL_MS: u64 = 200;
pub const GIVE_UP_MS: u64 = 45_000;

/// One subtitle to add: where it is, and what to call it.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// The subtitle file's address on the signed-in server. Carries no
    /// credential: the route needs none (plans/027-api-facts.md #12), and a
    /// server that wants the token for a stream has it in the player's header.
    pub url: String,
    pub title: String,
    /// An ISO 639 code as the server gave it (`eng`), for mpv's `slang`
    /// matching and the player's remembered language.
    pub lang: Option<String>,
}

/// A name the track list can show: printable characters only, runs of white
/// space as one space, and not long. Never empty (mpv would show the URL).
pub fn clean_title(raw: &str) -> String {
    let flat: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let cut: String = flat.chars().take(TITLE_MAX).collect();
    if cut.is_empty() {
        TITLE_FALLBACK.to_string()
    } else {
        cut
    }
}

/// A language code mpv can match: letters and `-`, two to eight of them, in
/// lower case. Anything else is no language at all rather than a wrong one.
pub fn clean_lang(raw: &str) -> Option<String> {
    let t = raw.trim();
    let ok = (2..=8).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-');
    ok.then(|| t.to_ascii_lowercase())
}

/// The `sub-add` command for a line: `sub-add <url> auto <title> [<lang>]`, one
/// argument each. mpv takes arguments whole, so a title with a comma, a colon
/// or a quote in it is the title.
pub fn args(line: &Line) -> Vec<String> {
    let mut a = vec![
        "sub-add".to_string(),
        line.url.clone(),
        "auto".to_string(),
        line.title.clone(),
    ];
    if let Some(l) = &line.lang {
        a.push(l.clone());
    }
    a
}

/// What to do about a file whose subtitles are waiting to be added.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// Look again in a moment.
    Wait,
    /// The file is loaded: add them.
    Add,
    /// Nothing to add them to any more.
    Stop,
}

/// Whether it is time to add the subtitles of `wanted`, from what the player
/// says now. `path` is the file the player has (None when idle), `tracks` its
/// track count (None until it has one), `waited_ms` how long this has waited,
/// and `superseded` that another file has been loaded since (or the player
/// stopped). Added only to the file they belong to, and only once the file has
/// opened far enough to have tracks: a `sub-add` before that has no file to
/// join.
pub fn next_step(path: Option<&str>, wanted: &str, tracks: Option<u32>, waited_ms: u64, superseded: bool) -> Step {
    if superseded || waited_ms > GIVE_UP_MS {
        return Step::Stop;
    }
    if path == Some(wanted) && tracks.unwrap_or(0) > 0 {
        Step::Add
    } else {
        Step::Wait
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "http://192.168.1.50:8096/Videos/7acf01459a4fb0ba75583ff9c88ca080/7acf01459a4fb0ba75583ff9c88ca080/Subtitles/0/Stream.srt";

    #[test]
    fn a_title_is_one_printable_line_and_never_empty() {
        assert_eq!(clean_title("English - SUBRIP - External"), "English - SUBRIP - External");
        assert_eq!(clean_title("  a \t b\n\nc  "), "a b c");
        assert_eq!(clean_title("bell\u{7}here\u{0}"), "bell here");
        assert_eq!(clean_title(""), "Subtitles");
        assert_eq!(clean_title(" \n "), "Subtitles");
    }

    #[test]
    fn a_title_is_cut_by_characters_not_bytes() {
        let long = "é".repeat(200);
        let t = clean_title(&long);
        assert_eq!(t.chars().count(), TITLE_MAX);
        assert!(t.chars().all(|c| c == 'é'));
    }

    #[test]
    fn a_language_is_letters_and_a_dash_or_nothing() {
        assert_eq!(clean_lang("eng").as_deref(), Some("eng"));
        assert_eq!(clean_lang(" ENG ").as_deref(), Some("eng"));
        assert_eq!(clean_lang("pt-BR").as_deref(), Some("pt-br"));
        for bad in ["", "e", "english-us-xx", "en g", "e1n", "e,n", "en;fr", "../x"] {
            assert_eq!(clean_lang(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_command_is_sub_add_with_auto_and_one_argument_each() {
        let line = Line { url: URL.into(), title: "English, SDH: \"full\"".into(), lang: Some("eng".into()) };
        assert_eq!(
            args(&line),
            vec!["sub-add", URL, "auto", "English, SDH: \"full\"", "eng"]
        );
    }

    #[test]
    fn no_language_is_no_fifth_argument() {
        let line = Line { url: URL.into(), title: "Subtitles".into(), lang: None };
        assert_eq!(args(&line), vec!["sub-add", URL, "auto", "Subtitles"]);
    }

    #[test]
    fn the_flag_is_auto_never_select() {
        let line = Line { url: URL.into(), title: "x".into(), lang: Some("eng".into()) };
        let a = args(&line);
        assert_eq!(a[2], "auto");
        assert!(!a.iter().any(|x| x == "select"));
    }

    #[test]
    fn they_wait_for_their_own_file_to_have_tracks() {
        // Idle, loading another file, or this one before it has any tracks.
        assert_eq!(next_step(None, URL, None, 0, false), Step::Wait);
        assert_eq!(next_step(Some("http://other/x"), URL, Some(3), 0, false), Step::Wait);
        assert_eq!(next_step(Some(URL), URL, None, 0, false), Step::Wait);
        assert_eq!(next_step(Some(URL), URL, Some(0), 100, false), Step::Wait);
        // Loaded.
        assert_eq!(next_step(Some(URL), URL, Some(2), 400, false), Step::Add);
    }

    #[test]
    fn they_stop_when_another_file_came_or_nothing_opened() {
        assert_eq!(next_step(Some(URL), URL, Some(2), 0, true), Step::Stop);
        assert_eq!(next_step(None, URL, None, 0, true), Step::Stop);
        assert_eq!(next_step(None, URL, None, GIVE_UP_MS, false), Step::Wait);
        assert_eq!(next_step(None, URL, None, GIVE_UP_MS + 1, false), Step::Stop);
        // Even a file that loaded at the last moment is superseded by the clock.
        assert_eq!(next_step(Some(URL), URL, Some(2), GIVE_UP_MS + 1, false), Step::Stop);
    }
}
