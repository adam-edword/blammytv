//! What native will hand to mpv, and nothing else.
//!
//! mpv's `loadfile` takes a path as readily as a URL: a `file:` URL reads
//! the disk, and a UNC path (`\\host\share\x.mkv`) makes Windows offer the
//! user's NTLM hash to another machine. Only the frontend used to say what
//! may be played (`validUrl`, `httpUrl`, Stalker's regex), and the frontend
//! is the layer that ships apart from this binary and can be swapped under
//! it (plan 008). So `inv_open` and `popout_open` ask here, the same way
//! `open_external` already insists on https (X1 of the 0.11.0 audit).
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

/// Ok when `url` is an http or https URL as written. The error never
/// echoes the URL: a stream URL carries the line's credentials.
///
/// "As written" is the point of the second test. A URL parser drops leading
/// spaces and strips tabs and newlines from anywhere in its input, so the
/// parsed form can be http while the string mpv would be handed is not.
/// Requiring the string itself to start `http://` or `https://` closes that
/// gap; no stream the app opens begins any other way.
pub fn http_only(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "not a URL".to_string())?;
    let scheme = parsed.scheme();
    if !matches!(scheme, "http" | "https") {
        return Err("only http and https urls can be played".into());
    }
    let (bytes, n) = (url.as_bytes(), scheme.len());
    let written = bytes.len() >= n + 3
        && bytes[..n].eq_ignore_ascii_case(scheme.as_bytes())
        && &bytes[n..n + 3] == b"://";
    if !written {
        return Err("only http and https urls can be played".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::http_only;

    #[test]
    fn http_and_https_pass() {
        for ok in [
            "http://host/live/u/p/1.ts",
            "https://host:8443/a.m3u8?token=1",
            "HTTP://HOST/UP.TS",
            "Https://host/x",
            // The multi-view proxy's loopback URLs.
            "http://127.0.0.1:51234/mv/0123456789abcdef0123456789abcdef",
            "http://user:pass@host/live.ts",
        ] {
            assert!(http_only(ok).is_ok(), "refused a stream URL: {ok}");
        }
    }

    #[test]
    fn nothing_else_reaches_mpv() {
        for no in [
            // A file on disk, and a share another machine can ask for a hash.
            "file:///C:/Users/a/secret.mkv",
            "file://evil/share/x.mkv",
            r"\\evil\share\x.mkv",
            "//evil/share/x.mkv",
            r"C:\Users\a\x.mkv",
            "/etc/passwd",
            "x.mkv",
            // Other protocols mpv (through ffmpeg) speaks.
            "ftp://host/x.ts",
            "rtmp://host/live/x",
            "rtsp://host/x",
            "udp://@239.0.0.1:1234",
            "smb://evil/share/x.mkv",
            "data:text/plain,hello",
            // Not a URL at all.
            "",
            "not a url",
            "http://",
            // A parser would read these as http; mpv would be handed
            // something else.
            " http://host/x.ts",
            "\thttp://host/x.ts",
            "ht\ntp://host/x.ts",
            "http\n://host/x.ts",
            "\u{0}http://host/x.ts",
        ] {
            assert!(http_only(no).is_err(), "let through: {no:?}");
        }
    }

    #[test]
    fn the_error_never_echoes_the_url() {
        for url in [
            "file:///C:/Users/secret-name/x.mkv",
            "rtmp://user:hunter2@host/live/x",
            "not a url with hunter2 in it",
        ] {
            let e = http_only(url).unwrap_err();
            assert!(!e.contains("hunter2") && !e.contains("secret-name"), "{e}");
        }
    }
}
