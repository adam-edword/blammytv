//! The User-Agent a playlist asks for, and what native does with it (plan 025,
//! P5).
//!
//! Some providers only answer the app they sell: a panel that checks the agent
//! on the channel list checks it on the stream. A playlist can carry one
//! (Settings → Sources → a playlist → Advanced), the page sends it with the
//! stream it opens, and every request native makes for that stream sends it:
//! mpv's own (the in-app player and the pop-out), the multi-view proxy's, and
//! the probe that says why a file would not open. Without one nothing here
//! does anything, and every request is the one it always was.
//!
//! WHAT IS CHECKED HERE, because the page ships apart from this binary and can
//! be swapped under it (plan 008), as `mpvurl` is asked about every URL and
//! `mpvprefs` about every setting: the agent is printable ASCII and not long
//! (`clean`). Printable ASCII is what every server reads the same way, and it
//! keeps a line break, and a header of someone else's making, out of a request.
//!
//! WHAT MPV GETS, and why it is more than "set it". The in-app player is ONE
//! mpv for the life of the process, and `user-agent` is an option of the whole
//! player, not of a file. Set for one playlist's channel, it would be on the
//! next playlist's too. So the value mpv started with is kept and put back
//! before every file that has no agent of its own (`before_load`). Measured on
//! mpv 0.37: it starts with `libmpv`, readable as the property, a property
//! set before `loadfile` is the agent of that file, and an empty one is an
//! empty header and not the default, which is why "put back" is a value and
//! never a blank.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

use reqwest::header::HeaderValue;

/// The longest an agent may be. The page's limit is the same (lib/userAgent.ts).
pub const MAX_LEN: usize = 300;

/// What libmpv sends when nobody has said (stream/network.c `.useragent`). The
/// player reads the real value when it starts; this is for a read that fails,
/// and the reason a file with no agent of its own does not go out with none.
pub const MPV_DEFAULT: &str = "libmpv";

/// The agent a command was given, ready to use: trimmed, and None for none.
/// An agent that is not printable ASCII, or is over MAX_LEN, is refused, and
/// the error never says what it was.
pub fn clean(raw: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = raw else { return Ok(None) };
    let t = raw.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > MAX_LEN || !t.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        return Err("not a User-Agent the app offers".into());
    }
    Ok(Some(t.to_string()))
}

/// What mpv's `user-agent` is set to before a file loads, or None to leave it
/// alone.
///
///  - An agent: that agent. Always, so a file is never opened with another
///    file's.
///  - None, or a blank, after a file that had one (`changed`): what mpv started
///    with, or its default if that could not be read. A playlist without an
///    agent never inherits another's.
///  - None, and nothing has been changed: None. A playlist with no agent, on
///    an app where no playlist has one, never has the property touched, so it
///    is mpv exactly as it was.
pub fn before_load(
    wanted: Option<&str>,
    started_with: Option<&str>,
    changed: bool,
) -> Option<String> {
    let wanted = wanted.map(str::trim).filter(|w| !w.is_empty());
    match wanted {
        Some(w) => Some(w.to_string()),
        None if changed => Some(started_with.unwrap_or(MPV_DEFAULT).to_string()),
        None => None,
    }
}

/// The header the proxy and the open probe add to a request, or None for the
/// client's own User-Agent. A blank is none; so is anything a header cannot
/// hold, which `clean` has already refused.
pub fn header_value(agent: Option<&str>) -> Option<HeaderValue> {
    let a = agent?.trim();
    if a.is_empty() {
        return None;
    }
    HeaderValue::from_str(a).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AGENT: &str = "TestApp/9.1 (Provider Check)";

    #[test]
    fn nothing_and_blank_are_no_agent() {
        assert_eq!(clean(None), Ok(None));
        for blank in ["", "   ", "\t \u{a0}"] {
            assert_eq!(clean(Some(blank.into())), Ok(None), "{blank:?}");
        }
    }

    #[test]
    fn an_agent_is_kept_as_it_was_written_without_the_space_around_it() {
        assert_eq!(clean(Some(AGENT.into())), Ok(Some(AGENT.into())));
        assert_eq!(clean(Some(format!("  {AGENT}\t"))), Ok(Some(AGENT.into())));
        let longest = "a".repeat(MAX_LEN);
        assert_eq!(clean(Some(longest.clone())), Ok(Some(longest)));
    }

    #[test]
    fn what_a_header_cannot_hold_is_refused() {
        let too_long = "a".repeat(MAX_LEN + 1);
        for bad in [
            "a\nb",
            "a\r\nX-Evil: 1",
            "tab\there",
            "nul\u{0}x",
            "del\u{7f}x",
            "caf\u{e9}",
            "emoji \u{1f600}",
            too_long.as_str(),
        ] {
            assert!(clean(Some(bad.into())).is_err(), "let through: {bad:?}");
        }
    }

    #[test]
    fn the_refusal_never_says_what_the_agent_was() {
        let e = clean(Some("hunter2\r\nX-Evil: 1".into())).unwrap_err();
        assert!(!e.contains("hunter2") && !e.contains("Evil"), "{e}");
    }

    #[test]
    fn mpv_gets_the_agent_it_was_asked_for() {
        // Whatever it started with, and whether or not an agent was set before.
        for (started, changed) in [
            (Some("libmpv"), false),
            (Some("libmpv"), true),
            (None, false),
            (None, true),
        ] {
            assert_eq!(
                before_load(Some(AGENT), started, changed),
                Some(AGENT.into())
            );
        }
        assert_eq!(
            before_load(Some("  padded  "), None, false),
            Some("padded".into())
        );
    }

    #[test]
    fn mpv_is_left_alone_when_nobody_has_asked_for_an_agent() {
        assert_eq!(before_load(None, Some("libmpv"), false), None);
        assert_eq!(before_load(None, None, false), None);
    }

    #[test]
    fn a_blank_agent_is_no_agent() {
        for blank in ["", "   ", "\t"] {
            assert_eq!(
                before_load(Some(blank), Some("libmpv"), false),
                None,
                "{blank:?}"
            );
            assert_eq!(
                before_load(Some(blank), Some("libmpv"), true),
                Some("libmpv".into()),
                "{blank:?}"
            );
        }
    }

    #[test]
    fn a_playlist_without_one_gets_back_what_mpv_started_with_after_another_set_its_own() {
        // The persistent player: one playlist's agent is set, the next
        // playlist has none. What mpv started with goes back, not a blank.
        assert_eq!(
            before_load(None, Some("libmpv"), true),
            Some("libmpv".into())
        );
        assert_eq!(
            before_load(None, Some("Custom/2"), true),
            Some("Custom/2".into())
        );
        // A read that failed at the start falls back on the default.
        assert_eq!(before_load(None, None, true), Some(MPV_DEFAULT.into()));
        // And never an empty string, which mpv sends as an empty header.
        assert_ne!(before_load(None, Some("libmpv"), true), Some(String::new()));
    }

    #[test]
    fn the_proxy_and_the_probe_send_the_agent_as_a_header() {
        let v = header_value(Some(AGENT)).unwrap();
        assert_eq!(v.to_str().unwrap(), AGENT);
        assert_eq!(
            header_value(Some("  padded ")).unwrap().to_str().unwrap(),
            "padded"
        );
    }

    #[test]
    fn and_nothing_when_there_is_no_agent() {
        assert!(header_value(None).is_none());
        assert!(header_value(Some("")).is_none());
        assert!(header_value(Some("   ")).is_none());
        // What a header cannot hold is none, not a panic. (What a header CAN hold
        // and the app does not offer, such as "café", is `clean`'s to refuse,
        // and has been before anything gets here.)
        assert!(header_value(Some("a\r\nb")).is_none());
        assert!(header_value(Some("a\u{0}b")).is_none());
    }
}
