//! The header a Jellyfin stream asks mpv to send, and what native does with it
//! (plan 027, batch 3).
//!
//! A Jellyfin server may serve a stream only to a request that carries the
//! session's token (12.2 does not, plans/027-api-facts.md #2, but an older or
//! stricter one may). The token is never in the URL: the page, a log line and
//! an error all see the URL. It goes to mpv as `http-header-fields`, an option
//! mpv reads as a LIST split at commas, so the header must have none (a comma
//! splits it in two and the open fails; measured on mpv 0.37). `jf.rs` makes
//! the line (`auth_header_for`); this file is what mpv may be set to.
//!
//! WHAT IS CHECKED HERE, as `mpvagent` checks the User-Agent, because native
//! says what mpv may be given and the page can be swapped under it: the line
//! is one `Authorization: MediaBrowser Token="..."` header, printable ASCII, no
//! comma, and not long (`clean`).
//!
//! WHAT MPV GETS. The in-app player is ONE mpv for the life of the process and
//! `http-header-fields` is an option of the whole player, not of a file. Set
//! for a Jellyfin stream it would be on the next file too: a live channel on
//! the next click would be sent the Jellyfin token. So it is put back, to
//! mpv's own empty list, before every file that has none of its own
//! (`before_load`). Measured on mpv 0.37 through libmpv's
//! `mpv_set_property_string`: the header set before `loadfile` is the header
//! of that file's requests; an empty string reads back as an empty list and
//! the next request carries none.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

/// The longest a line may be: `Authorization: MediaBrowser Token="` and a token
/// of at most 256 characters, with room.
pub const MAX_LEN: usize = 320;

const START: &str = "Authorization: MediaBrowser Token=\"";

/// Whether `line` is the one header native will set: nothing but the token
/// form, with a token of the characters Jellyfin's are made of.
pub fn clean(line: &str) -> bool {
    let Some(rest) = line.strip_prefix(START) else {
        return false;
    };
    let Some(token) = rest.strip_suffix('"') else {
        return false;
    };
    line.len() <= MAX_LEN
        && (8..=256).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// What mpv's `http-header-fields` is set to before a file loads, or None to
/// leave it alone.
///
///  - A line: that line, if `clean`. Always, so a file is never opened with
///    another file's header. One that is not clean is treated as none.
///  - None, after a file that had one (`changed`): the empty string, mpv's own
///    empty list.
///  - None, and nothing has been changed: None. An app that never plays a
///    Jellyfin file never has the option touched.
pub fn before_load(wanted: Option<&str>, changed: bool) -> Option<String> {
    match wanted.filter(|w| clean(w)) {
        Some(w) => Some(w.to_string()),
        None if changed => Some(String::new()),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = "Authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\"";

    #[test]
    fn the_one_header_is_clean() {
        assert!(clean(LINE));
        assert!(clean("Authorization: MediaBrowser Token=\"abc-DEF_123.45\""));
    }

    #[test]
    fn nothing_else_is_a_header_mpv_is_given() {
        for bad in [
            "",
            "Authorization: MediaBrowser Token=\"\"",
            "Authorization: MediaBrowser Token=\"short\"",
            // a comma splits mpv's list in two
            "Authorization: MediaBrowser Client=\"BlammyTV\", Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\"",
            "Authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\",X-Evil: 1",
            "Authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\"\r\nX-Evil: 1",
            "Authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a6%\"",
            "X-Emby-Token: 7f3a9c01d2e44b6f8a15c0e9b2d34a67",
            "authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\"",
            "Authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\" ",
            " Authorization: MediaBrowser Token=\"7f3a9c01d2e44b6f8a15c0e9b2d34a67\"",
        ] {
            assert!(!clean(bad), "{bad:?}");
        }
        let long = format!("Authorization: MediaBrowser Token=\"{}\"", "a".repeat(257));
        assert!(!clean(&long));
        let longest = format!("Authorization: MediaBrowser Token=\"{}\"", "a".repeat(256));
        assert!(clean(&longest));
    }

    #[test]
    fn a_file_with_a_header_gets_it_whatever_came_before() {
        assert_eq!(before_load(Some(LINE), false), Some(LINE.to_string()));
        assert_eq!(before_load(Some(LINE), true), Some(LINE.to_string()));
    }

    #[test]
    fn the_next_file_without_one_gets_the_header_put_back_to_empty() {
        assert_eq!(before_load(None, true), Some(String::new()));
    }

    #[test]
    fn an_app_that_never_plays_a_jellyfin_file_never_touches_the_option() {
        assert_eq!(before_load(None, false), None);
    }

    #[test]
    fn a_header_that_is_not_clean_is_none_and_never_set() {
        let bad = "X-Evil: 1";
        assert_eq!(before_load(Some(bad), false), None);
        // after a file that had one it is put back, not replaced by the bad one
        assert_eq!(before_load(Some(bad), true), Some(String::new()));
    }
}
