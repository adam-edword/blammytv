//! What the player settings may ask mpv for, and nothing else.
//!
//! Settings → Playback has Audio Channels, Subtitle Size and the pop-out's
//! size and corner, and the player's Delay keys move the subtitle delay. All
//! of them reach mpv through here, so the layer that owns the invariant checks
//! them: the frontend ships apart from this binary and can be swapped under it
//! (two-tier updates), the way `mpvurl` is asked about every URL.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

/// mpv's own default, which is what Automatic is. v0.11.21 stopped forcing
/// stereo, and this is the way it runs unless a person picks otherwise.
pub const DEFAULT_AUDIO: &str = "auto-safe";

/// A text subtitle at its own size.
pub const DEFAULT_SUB_SCALE: f64 = 1.0;

/// The layouts Settings offers (Automatic, Stereo, 5.1, 7.1) and what each
/// asks mpv for. A fixed list and not whatever `--audio-channels` parses,
/// which takes a comma list of speaker names and so would take a layout
/// nobody can get out of in Settings.
///
/// 5.1 and 7.1 say what the speakers can take, not what every film is made
/// into, so they are LISTS: a stereo film stays stereo and a 5.1 one on 7.1
/// speakers stays 5.1. That is mpv's own advice for a receiver
/// (`--audio-channels=7.1,5.1,stereo`, man page, its HDMI warning); a single
/// layout has the decoder remix everything to it. Stereo stays one layout on
/// purpose: it is the downmix.
const AUDIO_CHANNELS: [(&str, &str); 4] = [
    (DEFAULT_AUDIO, DEFAULT_AUDIO),
    ("stereo", "stereo"),
    ("5.1", "5.1,stereo"),
    ("7.1", "7.1,5.1,stereo"),
];

/// What to give mpv for a Settings value, or None for anything the app does
/// not offer. The answer is a static string and not the input, so what
/// reaches mpv is always one of ours.
pub fn audio_channels(v: &str) -> Option<&'static str> {
    AUDIO_CHANNELS.iter().find(|(k, _)| *k == v).map(|(_, m)| *m)
}

/// The least and the most `sub-scale` Settings asks for. Settings' four sizes
/// sit inside it (0.8 to 1.5); mpv itself takes 0 to 100, and a subtitle at
/// either end of that is not one anybody can read.
const SUB_SCALE_MIN: f64 = 0.5;
const SUB_SCALE_MAX: f64 = 2.0;

/// The scale to give mpv, kept inside the range. None for NaN and infinity,
/// which have no size to clamp to.
pub fn sub_scale(v: f64) -> Option<f64> {
    v.is_finite().then(|| v.clamp(SUB_SCALE_MIN, SUB_SCALE_MAX))
}

/// The most one press of a delay key moves the subtitles. mpv's own step is
/// 0.1; this bound is for a frontend that sends something else.
const SUB_DELAY_STEP_MAX: f64 = 5.0;

/// A delay to one decimal, the way mpv's own keys step it. Rounded so that
/// ten steps of 0.1 read 1.0 and not 0.9999999999999999, and so that coming
/// back to zero reads 0 and not -0.
pub fn tenth(x: f64) -> f64 {
    // `+ 0.0` is what turns -0 into 0: a small negative rounds to -0, and -0
    // plus 0 is 0.
    (x * 10.0).round() / 10.0 + 0.0
}

/// The delay after moving `current` by `delta`. None when either is not a
/// number, or the move is more than a step may be: nothing changes then.
pub fn sub_delay_next(current: f64, delta: f64) -> Option<f64> {
    if !current.is_finite() || !delta.is_finite() || delta.abs() > SUB_DELAY_STEP_MAX {
        return None;
    }
    Some(tenth(current + delta))
}

/// `autofit` for the pop-out: how much of the screen it takes. Large is what
/// it always was. Anything unknown, or nothing (a frontend from before the
/// setting), is large.
pub fn popout_autofit(size: Option<&str>) -> &'static str {
    match size {
        Some("small") => "25%",
        Some("medium") => "35%",
        _ => "50%",
    }
}

/// `geometry` for the pop-out, or None to leave it centred, which is what it
/// always did. The position alone, in X11 form: a sign puts the offset from
/// the left or top (+) or the right or bottom (-), 24 pixels in. mpv sizes the
/// window from `autofit` first and then places it, and takes the position
/// without a size (options/m_option.c, parse_geometry_str).
pub fn popout_geometry(corner: Option<&str>) -> Option<&'static str> {
    match corner {
        Some("top-left") => Some("+24+24"),
        Some("top-right") => Some("-24+24"),
        Some("bottom-left") => Some("+24-24"),
        Some("bottom-right") => Some("-24-24"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_layout_settings_offers_asks_mpv_for_up_to_it() {
        assert_eq!(audio_channels("auto-safe"), Some("auto-safe"));
        assert_eq!(audio_channels("stereo"), Some("stereo"));
        assert_eq!(audio_channels("5.1"), Some("5.1,stereo"));
        assert_eq!(audio_channels("7.1"), Some("7.1,5.1,stereo"));
    }

    #[test]
    fn any_other_layout_is_refused() {
        for no in [
            "quadraphonic",
            "auto",
            "mono",
            "5.0",
            "6.1",
            "2",
            "6",
            "7.1,5.1,stereo",
            "stereo,5.1",
            "fl-fr-lfe",
            "Stereo",
            "AUTO-SAFE",
            " stereo",
            "stereo ",
            "stereo\0",
            "",
            "help",
        ] {
            assert_eq!(audio_channels(no), None, "accepted {no:?}");
        }
    }

    #[test]
    fn a_subtitle_size_inside_the_range_is_kept() {
        for v in [0.5, 0.8, 1.0, 1.25, 1.5, 2.0] {
            assert_eq!(sub_scale(v), Some(v), "changed {v}");
        }
    }

    #[test]
    fn a_subtitle_size_outside_the_range_is_clamped_to_it() {
        assert_eq!(sub_scale(0.0), Some(0.5));
        assert_eq!(sub_scale(0.49), Some(0.5));
        assert_eq!(sub_scale(-3.0), Some(0.5));
        assert_eq!(sub_scale(2.01), Some(2.0));
        assert_eq!(sub_scale(100.0), Some(2.0));
        assert_eq!(sub_scale(f64::MAX), Some(2.0));
        assert_eq!(sub_scale(f64::MIN), Some(0.5));
    }

    #[test]
    fn a_subtitle_size_that_is_not_a_number_is_refused() {
        for no in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(sub_scale(no), None, "accepted {no}");
        }
    }

    #[test]
    fn the_defaults_are_ones_the_checks_accept() {
        assert_eq!(audio_channels(DEFAULT_AUDIO), Some(DEFAULT_AUDIO));
        assert_eq!(sub_scale(DEFAULT_SUB_SCALE), Some(DEFAULT_SUB_SCALE));
    }

    #[test]
    fn a_delay_steps_by_a_tenth_and_reads_back_a_tenth() {
        assert_eq!(sub_delay_next(0.0, 0.1), Some(0.1));
        assert_eq!(sub_delay_next(0.1, 0.1), Some(0.2));
        // 0.1 + 0.2 is 0.30000000000000004 in floating point.
        assert_eq!(sub_delay_next(0.1, 0.2), Some(0.3));
        assert_eq!(sub_delay_next(0.3, -0.1), Some(0.2));
        assert_eq!(sub_delay_next(1.0, -2.5), Some(-1.5));
    }

    #[test]
    fn ten_steps_of_a_tenth_make_a_second() {
        let mut d = 0.0;
        for _ in 0..10 {
            d = sub_delay_next(d, 0.1).unwrap();
        }
        assert_eq!(d, 1.0);
    }

    #[test]
    fn coming_back_to_zero_is_zero_and_not_minus_zero() {
        let z = sub_delay_next(0.1, -0.1).unwrap();
        assert_eq!(z, 0.0);
        assert!(z.is_sign_positive(), "read -0");
        assert_eq!(format!("{z}"), "0");
        assert_eq!(tenth(-0.04), 0.0);
        assert!(tenth(-0.04).is_sign_positive());
    }

    #[test]
    fn a_step_larger_than_five_seconds_or_not_a_number_moves_nothing() {
        assert_eq!(sub_delay_next(0.0, 5.0), Some(5.0));
        assert_eq!(sub_delay_next(0.0, -5.0), Some(-5.0));
        for no in [5.1, -5.1, 60.0, f64::MAX, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(sub_delay_next(0.0, no), None, "moved by {no}");
        }
        assert_eq!(sub_delay_next(f64::NAN, 0.1), None);
        assert_eq!(sub_delay_next(f64::INFINITY, 0.1), None);
    }

    #[test]
    fn the_popout_takes_a_quarter_a_third_or_half_the_screen() {
        assert_eq!(popout_autofit(Some("small")), "25%");
        assert_eq!(popout_autofit(Some("medium")), "35%");
        assert_eq!(popout_autofit(Some("large")), "50%");
    }

    #[test]
    fn an_unknown_size_or_none_is_the_half_it_always_was() {
        for v in [None, Some(""), Some("huge"), Some("Small"), Some("25%"), Some("50%")] {
            assert_eq!(popout_autofit(v), "50%", "sized by {v:?}");
        }
    }

    #[test]
    fn each_corner_is_a_position_alone_24_pixels_in() {
        assert_eq!(popout_geometry(Some("top-left")), Some("+24+24"));
        assert_eq!(popout_geometry(Some("top-right")), Some("-24+24"));
        assert_eq!(popout_geometry(Some("bottom-left")), Some("+24-24"));
        assert_eq!(popout_geometry(Some("bottom-right")), Some("-24-24"));
    }

    #[test]
    fn the_centre_an_unknown_corner_and_none_leave_it_centred() {
        for v in [
            None,
            Some("center"),
            Some("centre"),
            Some(""),
            Some("top"),
            Some("Top-Left"),
            Some("+24+24"),
            Some("0:0"),
        ] {
            assert_eq!(popout_geometry(v), None, "placed by {v:?}");
        }
    }

    /// mpv reads a geometry as [W[xH]][{+-}X{+-}Y]: a position with no size
    /// in front of it. Every string this file hands out is that shape, so the
    /// parse that takes it (parse_geometry_str) takes nothing else with it.
    #[test]
    fn every_geometry_is_a_sign_and_a_number_twice() {
        for c in ["top-left", "top-right", "bottom-left", "bottom-right"] {
            let g = popout_geometry(Some(c)).unwrap();
            let b = g.as_bytes();
            assert_eq!(b.len(), 6, "{g}");
            assert!(b[0] == b'+' || b[0] == b'-', "{g}");
            assert!(b[1].is_ascii_digit() && b[2].is_ascii_digit(), "{g}");
            assert!(b[3] == b'+' || b[3] == b'-', "{g}");
            assert!(b[4].is_ascii_digit() && b[5].is_ascii_digit(), "{g}");
        }
    }

    #[test]
    fn each_corner_is_a_different_place() {
        let all: Vec<_> = ["top-left", "top-right", "bottom-left", "bottom-right"]
            .iter()
            .map(|c| popout_geometry(Some(c)).unwrap())
            .collect();
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }
}
