//! Popping a film or an episode out to VLC (plan 032).
//!
//! WHAT. `vlc.exe` is started on the source URL, with the title, the
//! playlist's User-Agent and the resume position, and with VLC's own web
//! interface switched on, bound to 127.0.0.1 on a random port behind a random
//! password. BlammyTV asks that interface for the position every few seconds
//! and tells the page (`vlc-progress`, `{ pos, len, state }`), so Continue
//! Watching, resume and Trakt keep working from the app side.
//!
//! FINDING VLC. VLC's installer (extras/package/win32/NSIS/vlc.win32.nsi.in)
//! writes three values under `HKLM\Software\VideoLAN\VLC`: `InstallDir` (the
//! folder), `Version`, and the default value (the full path of `vlc.exe`). A
//! 32-bit VLC on a 64-bit Windows writes them under the 32-bit view
//! (WOW6432Node). Both views are tried, then the default Program Files
//! folders. `find` takes the registry read and the existence check as inputs,
//! so the host crate tests it with fakes.
//!
//! THE LOG. Never the URL, its query, the password or the whole argv: a stream
//! URL carries the line's login. `describe` is the one line that may be
//! logged, and it holds an origin only (`mvproxy::origin_of`), as mvproxy.rs
//! and rec.rs do.
//!
//! THE SESSION. One at a time. A new launch replaces the tracking of the old
//! one, and does not touch the old VLC window: that belongs to the person.
//! Quitting BlammyTV leaves VLC open for the same reason.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests;
//! lib.rs pulls in tauri and cannot be built on Linux.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// The error the page matches to say "VLC isn't installed".
pub const NOT_INSTALLED: &str = "vlc not installed";

/// Which registry view a VLC lives in: the 64-bit one, or the 32-bit one
/// (WOW6432Node) a 32-bit VLC writes to.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum View {
    Native,
    Wow32,
}

/// The `vlc.exe` to start, or None. `registry` reads a value under
/// `HKLM\Software\VideoLAN\VLC` in a view (`None` is the default value) and
/// `exists` says whether a file is there, so an entry left behind by an
/// uninstall is skipped. `roots` are the Program Files folders to try last.
pub fn find(
    registry: impl Fn(View, Option<&str>) -> Option<String>,
    exists: impl Fn(&Path) -> bool,
    roots: &[PathBuf],
) -> Option<PathBuf> {
    let mut tries: Vec<PathBuf> = Vec::new();
    for view in [View::Native, View::Wow32] {
        if let Some(dir) = registry(view, Some("InstallDir")) {
            tries.push(PathBuf::from(dir).join("vlc.exe"));
        }
        if let Some(exe) = registry(view, None) {
            tries.push(PathBuf::from(exe));
        }
    }
    for root in roots {
        tries.push(root.join("VideoLAN").join("VLC").join("vlc.exe"));
    }
    tries.into_iter().find(|p| exists(p))
}

/// `find` against this machine.
pub fn find_installed() -> Option<PathBuf> {
    let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    find(registry_read, |p| p.is_file(), &roots)
}

#[cfg(not(windows))]
fn registry_read(_: View, _: Option<&str>) -> Option<String> {
    None
}

/// A string value of `HKLM\SOFTWARE\VideoLAN\VLC`, in one view.
#[cfg(windows)]
fn registry_read(view: View, name: Option<&str>) -> Option<String> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6432KEY,
        RRF_SUBKEY_WOW6464KEY,
    };
    let flags = RRF_RT_REG_SZ
        | match view {
            View::Native => RRF_SUBKEY_WOW6464KEY,
            View::Wow32 => RRF_SUBKEY_WOW6432KEY,
        };
    let name: Option<Vec<u16>> = name.map(|n| n.encode_utf16().chain(Some(0)).collect());
    let value = name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr()));
    let key = w!("SOFTWARE\\VideoLAN\\VLC");
    let mut bytes = 0u32;
    // The first call asks for the size, the second reads into a buffer of it.
    let sized = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key,
            value,
            flags,
            None,
            None,
            Some(&mut bytes),
        )
    };
    if sized.is_err() || bytes == 0 {
        return None;
    }
    let mut buf = vec![0u16; (bytes as usize).div_ceil(2)];
    let read = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key,
            value,
            flags,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
    };
    if read.is_err() {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let s = String::from_utf16_lossy(&buf[..end]);
    (!s.is_empty()).then_some(s)
}

/// What a launch is asked for, and the web interface it is given.
#[derive(Clone)]
pub struct Launch {
    pub url: String,
    pub title: String,
    pub user_agent: Option<String>,
    /// Seconds to start at. Under one second is the start.
    pub start: Option<f64>,
    pub port: u16,
    pub password: String,
}

/// VLC's arguments, one entry each. They go to `Command::args`, which hands
/// them to the process as they are: no shell reads them, so there is nothing
/// to escape. The URL is refused unless it is http or https as written, and
/// the User-Agent unless it is one `mpvagent::clean` accepts. The error never
/// says what either was.
pub fn args(l: &Launch) -> Result<Vec<String>, String> {
    crate::mpvurl::http_only(&l.url)?;
    let agent = crate::mpvagent::clean(l.user_agent.clone())?;
    let mut a = Vec::new();
    if let Some(agent) = agent {
        a.push(format!("--http-user-agent={agent}"));
    }
    let title: String = l
        .title
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    let title = title.trim();
    if !title.is_empty() {
        a.push(format!("--meta-title={title}"));
    }
    if let Some(s) = l.start.filter(|s| s.is_finite() && *s >= 1.0) {
        a.push(format!("--start-time={}", s.floor() as u64));
    }
    // Its own VLC even when the person's prefers one instance: handed to a
    // VLC already open, the web interface below would never start.
    a.push("--no-one-instance".into());
    a.push("--extraintf=http".into());
    a.push("--http-host=127.0.0.1".into());
    a.push(format!("--http-port={}", l.port));
    a.push(format!("--http-password={}", l.password));
    // Last, so nothing in it can be read as an option: it starts http:// or
    // https:// (checked above).
    a.push(l.url.clone());
    Ok(a)
}

/// The one line about a launch that may be logged: where it points, whether it
/// has a start, and the port. No path, query, login, User-Agent or password.
pub fn describe(l: &Launch) -> String {
    format!(
        "{} start={} port={}",
        crate::mvproxy::origin_of(&l.url),
        l.start.is_some_and(|s| s >= 1.0),
        l.port
    )
}

/// A port nobody has. Bound and let go, so another process can take it before
/// VLC does; the odds are small and the failure is a poller that never hears
/// back and gives up.
fn free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn random_password() -> Result<String, String> {
    let mut raw = [0u8; 16];
    getrandom::fill(&mut raw).map_err(|e| format!("no randomness: {e}"))?;
    Ok(raw.iter().map(|b| format!("{b:02x}")).collect())
}

/// What the page is told, every few seconds.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Progress {
    /// Seconds into the film.
    pub pos: f64,
    /// Its length in seconds, 0 when VLC has none.
    pub len: f64,
    /// "playing", "paused", "stopped", or "gone" once VLC no longer answers.
    pub state: String,
}

/// `status.json` as VLC's web interface sends it: `time` and `length` in whole
/// seconds, `state` one of three words. None for anything else.
fn parse_status(body: &[u8]) -> Option<Progress> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    let state = v.get("state")?.as_str()?;
    if !matches!(state, "playing" | "paused" | "stopped") {
        return None;
    }
    let secs = |k: &str| v.get(k).and_then(|n| n.as_f64()).unwrap_or(0.0).max(0.0);
    Some(Progress {
        pos: secs("time"),
        len: secs("length"),
        state: state.into(),
    })
}

async fn fetch(client: &reqwest::Client, port: u16, password: &str) -> Option<Progress> {
    let res = client
        .get(format!("http://127.0.0.1:{port}/requests/status.json"))
        // VLC's web interface: an empty user, the password.
        .basic_auth("", Some(password))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    parse_status(&res.bytes().await.ok()?)
}

/// How the poller paces itself.
#[derive(Clone, Copy)]
pub struct Timing {
    /// Between two questions.
    pub every: Duration,
    /// How long VLC has to start answering before an unanswered question
    /// counts. Once it has answered, they count from then on.
    pub grace: Duration,
    /// Unanswered questions in a row after which VLC is gone.
    pub max_fails: u32,
}

/// The grace is 45 seconds because a cold VLC can take 30 to 40 before its web
/// interface binds (antivirus scanning the first launch, a slow disk), and one
/// that is given up on is never followed again.
pub const TIMING: Timing = Timing {
    every: Duration::from_secs(5),
    grace: Duration::from_secs(45),
    max_fails: 3,
};

/// Ask VLC's web interface until the process exits, it stops answering, or
/// `replaced` says a newer launch has taken over (then silently: the page
/// would take a last word from the old one to be the new one's). Ends with
/// state "gone" and the last position VLC gave while playing or paused, which
/// is the one to keep: a finished film reads "stopped" at 0.
pub async fn track(
    client: reqwest::Client,
    port: u16,
    password: String,
    timing: Timing,
    replaced: impl Fn() -> bool,
    mut exited: impl FnMut() -> bool,
    emit: impl Fn(&Progress),
) {
    let started = Instant::now();
    let mut last = Progress {
        pos: 0.0,
        len: 0.0,
        state: "gone".into(),
    };
    let (mut answered, mut fails) = (false, 0u32);
    loop {
        if replaced() {
            return;
        }
        if exited() {
            break;
        }
        let got = fetch(&client, port, &password).await;
        if replaced() {
            return;
        }
        match got {
            Some(p) => {
                answered = true;
                fails = 0;
                emit(&p);
                if p.state != "stopped" {
                    last = p;
                }
            }
            None if answered || started.elapsed() >= timing.grace => {
                fails += 1;
                if fails >= timing.max_fails {
                    break;
                }
            }
            None => {}
        }
        tokio::time::sleep(timing.every).await;
    }
    emit(&Progress {
        state: "gone".into(),
        ..last
    });
}

/// The launches so far. A poller whose number is not the latest has been
/// replaced.
static LATEST: AtomicU64 = AtomicU64::new(0);

/// A VLC that has been started, ready to be followed.
pub struct Started {
    n: u64,
    child: std::process::Child,
    port: u16,
    password: String,
}

/// Start VLC on `url`. Errors are short strings the page can show or match:
/// `NOT_INSTALLED`, or a word on what was refused. Nothing in one holds the
/// URL. Takes over the tracking from any launch before it.
pub fn launch(
    url: String,
    title: String,
    user_agent: Option<String>,
    start: Option<f64>,
) -> Result<Started, String> {
    let l = Launch {
        url,
        title,
        user_agent,
        start,
        port: free_port()?,
        password: random_password()?,
    };
    // Refused before VLC is looked for, so a bad URL says so on a machine
    // that has none.
    let argv = args(&l)?;
    let exe = find_installed().ok_or_else(|| NOT_INSTALLED.to_string())?;
    let child = std::process::Command::new(&exe)
        .args(&argv)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("vlc did not start: {}", e.kind()))?;
    log::info!("[vlc] started {}", describe(&l));
    Ok(Started {
        n: LATEST.fetch_add(1, Ordering::SeqCst) + 1,
        child,
        port: l.port,
        password: l.password,
    })
}

/// Follow a started VLC to its end, telling `emit` what it reports.
pub async fn follow(mut s: Started, emit: impl Fn(&Progress)) {
    // Loopback only, and never through a system proxy.
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return;
    };
    let n = s.n;
    track(
        client,
        s.port,
        s.password.clone(),
        TIMING,
        move || LATEST.load(Ordering::SeqCst) != n,
        move || !matches!(s.child.try_wait(), Ok(None)),
        emit,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// No tokio `macros` feature in the app's tree: a runtime by hand, as
    /// mvproxy's tests do.
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    const PW: &str = "s3cret";
    /// base64 of ":s3cret": an empty user and PW.
    const AUTH: &str = "Basic OnMzY3JldA==";
    const URL: &str = "http://user:pass@cdn.example:8080/movie/abc123/film.mkv?token=SECRETQ";

    fn launch_of(url: &str) -> Launch {
        Launch {
            url: url.into(),
            title: "The Film".into(),
            user_agent: None,
            start: None,
            port: 51234,
            password: "pw-8f3a21".into(),
        }
    }

    // ---- the finder ----

    /// A fake registry: (view, value name, value). `None` is the default value.
    type Reg = Vec<(View, Option<&'static str>, &'static str)>;

    fn registry(r: Reg) -> impl Fn(View, Option<&str>) -> Option<String> {
        move |view, name| {
            r.iter()
                .find(|(v, n, _)| *v == view && *n == name)
                .map(|(_, _, value)| value.to_string())
        }
    }

    fn files(have: &'static [&'static str]) -> impl Fn(&Path) -> bool {
        move |p| have.iter().any(|h| Path::new(h) == p)
    }

    #[test]
    fn the_registry_install_dir_is_found() {
        let r: Reg = vec![(View::Native, Some("InstallDir"), "/apps/vlc")];
        let got = find(registry(r), files(&["/apps/vlc/vlc.exe"]), &[]);
        assert_eq!(got, Some(PathBuf::from("/apps/vlc/vlc.exe")));
    }

    #[test]
    fn the_default_value_is_the_exe_itself() {
        let r: Reg = vec![(View::Native, None, "/apps/vlc/vlc.exe")];
        let got = find(registry(r), files(&["/apps/vlc/vlc.exe"]), &[]);
        assert_eq!(got, Some(PathBuf::from("/apps/vlc/vlc.exe")));
    }

    #[test]
    fn the_32_bit_view_is_the_fallback() {
        let r: Reg = vec![(View::Wow32, Some("InstallDir"), "/x86/vlc")];
        let got = find(registry(r), files(&["/x86/vlc/vlc.exe"]), &[]);
        assert_eq!(got, Some(PathBuf::from("/x86/vlc/vlc.exe")));
    }

    #[test]
    fn the_64_bit_view_wins_over_the_32_bit_one() {
        let r: Reg = vec![
            (View::Wow32, None, "/b/vlc.exe"),
            (View::Native, None, "/a/vlc.exe"),
        ];
        let got = find(registry(r), files(&["/a/vlc.exe", "/b/vlc.exe"]), &[]);
        assert_eq!(got, Some(PathBuf::from("/a/vlc.exe")));
    }

    #[test]
    fn program_files_is_the_last_resort() {
        let roots = [PathBuf::from("/pf"), PathBuf::from("/pf86")];
        let got = find(
            registry(vec![]),
            files(&["/pf86/VideoLAN/VLC/vlc.exe"]),
            &roots,
        );
        assert_eq!(got, Some(PathBuf::from("/pf86/VideoLAN/VLC/vlc.exe")));
        let got = find(
            registry(vec![]),
            files(&["/pf/VideoLAN/VLC/vlc.exe", "/pf86/VideoLAN/VLC/vlc.exe"]),
            &roots,
        );
        assert_eq!(got, Some(PathBuf::from("/pf/VideoLAN/VLC/vlc.exe")));
    }

    #[test]
    fn a_registry_entry_left_by_an_uninstall_is_skipped() {
        let r: Reg = vec![(View::Native, None, "/gone/vlc.exe")];
        let roots = [PathBuf::from("/pf")];
        let got = find(registry(r), files(&["/pf/VideoLAN/VLC/vlc.exe"]), &roots);
        assert_eq!(got, Some(PathBuf::from("/pf/VideoLAN/VLC/vlc.exe")));
    }

    #[test]
    fn nothing_installed_finds_nothing() {
        let roots = [PathBuf::from("/pf")];
        assert_eq!(find(registry(vec![]), files(&[]), &roots), None);
    }

    // ---- the arguments ----

    #[test]
    fn the_arguments_are_separate_entries_with_the_url_last() {
        let mut l = launch_of(URL);
        l.user_agent = Some("MyAgent/1.0 (x; y)".into());
        l.title = "Dune: Part Two".into();
        l.start = Some(125.7);
        let a = args(&l).unwrap();
        assert_eq!(
            a,
            vec![
                "--http-user-agent=MyAgent/1.0 (x; y)".to_string(),
                "--meta-title=Dune: Part Two".into(),
                "--start-time=125".into(),
                "--no-one-instance".into(),
                "--extraintf=http".into(),
                "--http-host=127.0.0.1".into(),
                "--http-port=51234".into(),
                "--http-password=pw-8f3a21".into(),
                URL.into(),
            ]
        );
    }

    #[test]
    fn no_agent_and_no_start_leave_their_options_out() {
        for start in [
            None,
            Some(0.0),
            Some(0.9),
            Some(-5.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
        ] {
            let mut l = launch_of(URL);
            l.start = start;
            let a = args(&l).unwrap();
            assert!(
                !a.iter().any(|x| x.starts_with("--start-time")),
                "{start:?}"
            );
            assert!(!a.iter().any(|x| x.starts_with("--http-user-agent")));
        }
        let mut l = launch_of(URL);
        l.user_agent = Some("   ".into());
        assert!(!args(&l)
            .unwrap()
            .iter()
            .any(|x| x.starts_with("--http-user-agent")));
    }

    #[test]
    fn a_start_of_one_second_or_more_is_whole_seconds() {
        for (s, want) in [
            (1.0, "--start-time=1"),
            (59.99, "--start-time=59"),
            (7200.0, "--start-time=7200"),
        ] {
            let mut l = launch_of(URL);
            l.start = Some(s);
            assert!(args(&l).unwrap().contains(&want.to_string()), "{s}");
        }
    }

    #[test]
    fn only_http_and_https_reach_vlc() {
        for no in [
            "file:///C:/Windows/win.ini",
            r"\\host\share\x.mkv",
            "C:\\x.mkv",
            "rtsp://host/x",
            "javascript:alert(1)",
            " http://host/x",
            "--fullscreen",
            "",
        ] {
            assert!(args(&launch_of(no)).is_err(), "let through: {no}");
        }
        for ok in ["http://h/x.mkv", "https://h:8443/x?a=b"] {
            assert!(args(&launch_of(ok)).is_ok(), "{ok}");
        }
    }

    #[test]
    fn a_refusal_never_echoes_the_url() {
        let secret = "ftp://user:hunter2@host/path?token=SECRETQ";
        let e = args(&launch_of(secret)).unwrap_err();
        assert!(
            !e.contains("hunter2") && !e.contains("SECRETQ") && !e.contains("host"),
            "{e}"
        );
    }

    #[test]
    fn an_agent_a_header_cannot_hold_is_refused() {
        let mut l = launch_of(URL);
        l.user_agent = Some("caf\u{e9}\r\nX: y".into());
        let e = args(&l).unwrap_err();
        assert!(!e.contains("caf"), "{e}");
    }

    #[test]
    fn a_title_cannot_carry_control_characters_or_run_long() {
        let mut l = launch_of(URL);
        l.title = "Line\none\u{0}\ttwo".into();
        assert!(args(&l)
            .unwrap()
            .contains(&"--meta-title=Lineonetwo".to_string()));
        l.title = "x".repeat(500);
        let t = args(&l)
            .unwrap()
            .into_iter()
            .find(|a| a.starts_with("--meta-title="))
            .unwrap();
        assert_eq!(t.len(), "--meta-title=".len() + 200);
        l.title = " \n ".into();
        assert!(!args(&l)
            .unwrap()
            .iter()
            .any(|a| a.starts_with("--meta-title")));
        // A title that looks like an option stays inside its own entry.
        l.title = "--fullscreen --no-video".into();
        let a = args(&l).unwrap();
        assert!(a.contains(&"--meta-title=--fullscreen --no-video".to_string()));
        assert!(!a.contains(&"--fullscreen".to_string()));
    }

    // ---- the log ----

    #[test]
    fn the_loggable_line_holds_no_password_and_no_url_path_or_query() {
        let mut l = launch_of(URL);
        l.user_agent = Some("SecretAgent/9".into());
        l.start = Some(300.0);
        let line = describe(&l);
        assert!(line.contains("http://cdn.example:8080"), "{line}");
        for leak in [
            l.password.as_str(),
            "movie",
            "abc123",
            "film.mkv",
            "token",
            "SECRETQ",
            "user",
            "pass",
            "SecretAgent",
            "Film",
            "--http-password",
        ] {
            assert!(!line.contains(leak), "{leak} leaked into: {line}");
        }
        assert!(line.contains("port=51234"), "{line}");
    }

    #[test]
    fn an_unparseable_url_logs_as_such() {
        assert!(describe(&launch_of("not a url")).starts_with("(unparseable)"));
    }

    // ---- the password and the port ----

    #[test]
    fn each_launch_gets_its_own_hex_password() {
        let (a, b) = (random_password().unwrap(), random_password().unwrap());
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn the_port_is_a_free_loopback_one() {
        let p = free_port().unwrap();
        assert!(p > 0);
        std::net::TcpListener::bind(("127.0.0.1", p)).unwrap();
    }

    // ---- reading status.json ----

    #[test]
    fn status_json_is_read_for_time_length_and_state() {
        let body = br#"{"time":61,"length":7200,"state":"playing","position":0.008,"volume":256}"#;
        assert_eq!(
            parse_status(body),
            Some(Progress {
                pos: 61.0,
                len: 7200.0,
                state: "playing".into()
            })
        );
        assert_eq!(
            parse_status(br#"{"time":5,"length":10,"state":"paused"}"#)
                .unwrap()
                .state,
            "paused"
        );
        // VLC 3 on a stopped player: zero time, and a length of zero.
        assert_eq!(
            parse_status(br#"{"time":0,"length":0,"state":"stopped"}"#),
            Some(Progress {
                pos: 0.0,
                len: 0.0,
                state: "stopped".into()
            })
        );
        // A missing time or a negative length reads as zero.
        let p = parse_status(br#"{"length":-1,"state":"playing"}"#).unwrap();
        assert_eq!((p.pos, p.len), (0.0, 0.0));
    }

    #[test]
    fn anything_else_is_not_a_status() {
        for no in [
            &b""[..],
            b"<html>401</html>",
            b"[]",
            br#"{"time":1,"length":2}"#,
            br#"{"time":1,"length":2,"state":"buffering"}"#,
            br#"{"time":1,"length":2,"state":3}"#,
        ] {
            assert_eq!(parse_status(no), None, "{}", String::from_utf8_lossy(no));
        }
    }

    // ---- the poller, against a fake web interface ----

    /// A fake VLC web interface. Answers `/requests/status.json` with `body`
    /// to a request that carries the right Authorization, 401 to the rest,
    /// and stops listening after `budget` requests.
    struct Fake {
        port: u16,
        body: Arc<Mutex<String>>,
        heads: Arc<Mutex<Vec<String>>>,
        task: tokio::task::JoinHandle<()>,
    }

    impl Fake {
        async fn start(body: String, budget: usize) -> Fake {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            Fake::serve(listener, port, body, budget)
        }

        fn serve(listener: TcpListener, port: u16, body: String, budget: usize) -> Fake {
            let body = Arc::new(Mutex::new(body));
            let heads = Arc::new(Mutex::new(Vec::new()));
            let (b, h) = (body.clone(), heads.clone());
            let served = Arc::new(AtomicUsize::new(0));
            let task = tokio::spawn(async move {
                loop {
                    if served.load(Ordering::SeqCst) >= budget {
                        return; // the listener goes with the task
                    }
                    let Ok((mut sock, _)) = listener.accept().await else {
                        return;
                    };
                    served.fetch_add(1, Ordering::SeqCst);
                    let mut head = Vec::new();
                    let mut buf = [0u8; 1024];
                    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                        match sock.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => head.extend_from_slice(&buf[..n]),
                        }
                    }
                    let head = String::from_utf8_lossy(&head).into_owned();
                    let ok = head.starts_with("GET /requests/status.json ")
                        && head
                            .lines()
                            .any(|l| l.eq_ignore_ascii_case(&format!("authorization: {AUTH}")));
                    h.lock().unwrap().push(head);
                    let reply = if ok {
                        let body = b.lock().unwrap().clone();
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                            body.len()
                        )
                    } else {
                        "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"VLC stream\"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".to_string()
                    };
                    let _ = sock.write_all(reply.as_bytes()).await;
                    let _ = sock.shutdown().await;
                }
            });
            Fake {
                port,
                body,
                heads,
                task,
            }
        }
    }

    fn status(time: u32, length: u32, state: &str) -> String {
        format!(r#"{{"time":{time},"length":{length},"state":"{state}","volume":256}}"#)
    }

    fn quick() -> Timing {
        Timing {
            every: Duration::from_millis(15),
            grace: Duration::from_millis(100),
            max_fails: 3,
        }
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    }

    /// Run the poller to its end against `port`, collecting what it emits.
    /// `exited` is asked once before every question.
    async fn collect(
        port: u16,
        password: &str,
        timing: Timing,
        exited: impl FnMut() -> bool,
    ) -> Vec<Progress> {
        let out = Arc::new(Mutex::new(Vec::new()));
        let sink = out.clone();
        tokio::time::timeout(
            Duration::from_secs(10),
            track(
                client(),
                port,
                password.into(),
                timing,
                || false,
                exited,
                move |p| sink.lock().unwrap().push(p.clone()),
            ),
        )
        .await
        .expect("the poller never ended");
        let got = out.lock().unwrap().clone();
        got
    }

    #[test]
    fn playing_then_paused_then_gone_when_the_server_stops_answering() {
        run(async {
            let fake = Fake::start(status(10, 7200, "playing"), 3).await;
            // Two answers, then a third is the last one the fake gives.
            let seen = Arc::new(Mutex::new(Vec::new()));
            let sink = seen.clone();
            let (body, port) = (fake.body.clone(), fake.port);
            let flip = Arc::new(AtomicUsize::new(0));
            let f2 = flip.clone();
            tokio::time::timeout(
                Duration::from_secs(10),
                track(
                    client(),
                    port,
                    PW.into(),
                    quick(),
                    || false,
                    || false,
                    move |p| {
                        sink.lock().unwrap().push(p.clone());
                        if f2.fetch_add(1, Ordering::SeqCst) == 0 {
                            *body.lock().unwrap() =
                                r#"{"time":70,"length":7200,"state":"paused"}"#.to_string();
                        }
                    },
                ),
            )
            .await
            .expect("the poller never ended");
            let got = seen.lock().unwrap().clone();
            let states: Vec<_> = got.iter().map(|p| (p.state.as_str(), p.pos)).collect();
            assert_eq!(
                states,
                vec![
                    ("playing", 10.0),
                    ("paused", 70.0),
                    ("paused", 70.0),
                    ("gone", 70.0)
                ]
            );
            assert_eq!(got.last().unwrap().len, 7200.0);
            assert!(fake
                .heads
                .lock()
                .unwrap()
                .iter()
                .all(|h| h.starts_with("GET /requests/status.json ")));
        });
    }

    #[test]
    fn stopped_is_passed_on_but_gone_keeps_the_last_real_position() {
        run(async {
            let fake = Fake::start(status(6900, 7200, "playing"), 4).await;
            let body = fake.body.clone();
            let n = Arc::new(AtomicUsize::new(0));
            let out = Arc::new(Mutex::new(Vec::new()));
            let sink = out.clone();
            tokio::time::timeout(
                Duration::from_secs(10),
                track(
                    client(),
                    fake.port,
                    PW.into(),
                    quick(),
                    || false,
                    || false,
                    move |p| {
                        sink.lock().unwrap().push(p.clone());
                        if n.fetch_add(1, Ordering::SeqCst) == 0 {
                            // The film ends: VLC reads zero.
                            *body.lock().unwrap() =
                                r#"{"time":0,"length":0,"state":"stopped"}"#.to_string();
                        }
                    },
                ),
            )
            .await
            .unwrap();
            let got = out.lock().unwrap().clone();
            assert_eq!(got[0].state, "playing");
            assert!(got.iter().any(|p| p.state == "stopped" && p.pos == 0.0));
            let end = got.last().unwrap();
            assert_eq!(
                (end.state.as_str(), end.pos, end.len),
                ("gone", 6900.0, 7200.0)
            );
        });
    }

    #[test]
    fn a_wrong_password_never_gets_a_status_and_ends_gone_at_zero() {
        run(async {
            let fake = Fake::start(status(10, 20, "playing"), usize::MAX).await;
            let got = collect(fake.port, "not-the-password", quick(), || false).await;
            assert_eq!(
                got,
                vec![Progress {
                    pos: 0.0,
                    len: 0.0,
                    state: "gone".into()
                }]
            );
            assert!(!fake.heads.lock().unwrap().is_empty(), "never asked");
            fake.task.abort();
        });
    }

    #[test]
    fn the_question_carries_basic_auth_with_an_empty_user() {
        run(async {
            let fake = Fake::start(status(1, 2, "playing"), 1).await;
            let got = collect(fake.port, PW, quick(), || false).await;
            assert_eq!(got[0].state, "playing");
            let heads = fake.heads.lock().unwrap();
            assert!(
                heads[0]
                    .to_ascii_lowercase()
                    .contains(&format!("authorization: {}", AUTH.to_ascii_lowercase())),
                "{}",
                heads[0]
            );
        });
    }

    #[test]
    fn the_process_exiting_ends_it_with_the_last_position() {
        run(async {
            let fake = Fake::start(status(42, 100, "playing"), usize::MAX).await;
            let mut asks = 0;
            let got = collect(fake.port, PW, quick(), move || {
                asks += 1;
                asks > 3
            })
            .await;
            let end = got.last().unwrap();
            assert_eq!(
                (end.state.as_str(), end.pos, end.len),
                ("gone", 42.0, 100.0)
            );
            assert_eq!(got.iter().filter(|p| p.state == "playing").count(), 3);
            fake.task.abort();
        });
    }

    #[test]
    fn a_vlc_that_is_slow_to_start_is_not_counted_against() {
        run(async {
            // The port is held back for longer than max_fails questions take.
            let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = probe.local_addr().unwrap().port();
            drop(probe);
            let timing = Timing {
                every: Duration::from_millis(15),
                grace: Duration::from_secs(5),
                max_fails: 2,
            };
            let late = tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(200)).await;
                let l = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
                Fake::serve(l, port, status(5, 50, "playing"), 2)
            });
            let got = collect(port, PW, timing, || false).await;
            let _late = late.await.unwrap();
            assert_eq!(
                got[0].state, "playing",
                "gave up before VLC was up: {got:?}"
            );
            assert_eq!(got.last().unwrap().state, "gone");
        });
    }

    #[test]
    fn the_grace_outlasts_a_cold_start_of_forty_seconds() {
        assert!(TIMING.grace >= Duration::from_secs(45), "{:?}", TIMING.grace);
        assert_eq!(TIMING.max_fails, 3);
    }

    #[test]
    fn a_vlc_that_never_comes_up_is_gone_once_the_grace_runs_out() {
        run(async {
            let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = probe.local_addr().unwrap().port();
            drop(probe);
            let timing = Timing {
                every: Duration::from_millis(15),
                grace: Duration::from_millis(300),
                max_fails: 2,
            };
            let t = Instant::now();
            let got = collect(port, PW, timing, || false).await;
            assert!(
                t.elapsed() >= Duration::from_millis(300),
                "{:?}",
                t.elapsed()
            );
            assert_eq!(
                got,
                vec![Progress {
                    pos: 0.0,
                    len: 0.0,
                    state: "gone".into()
                }]
            );
        });
    }

    #[test]
    fn a_newer_launch_stops_the_old_poller_without_a_word() {
        run(async {
            let fake = Fake::start(status(9, 90, "playing"), usize::MAX).await;
            let out = Arc::new(Mutex::new(Vec::new()));
            let sink = out.clone();
            let asks = Arc::new(AtomicUsize::new(0));
            let a = asks.clone();
            tokio::time::timeout(
                Duration::from_secs(10),
                track(
                    client(),
                    fake.port,
                    PW.into(),
                    quick(),
                    // Replaced from the third look on.
                    move || a.fetch_add(1, Ordering::SeqCst) >= 4,
                    || false,
                    move |p| sink.lock().unwrap().push(p.clone()),
                ),
            )
            .await
            .unwrap();
            let got = out.lock().unwrap().clone();
            assert!(!got.is_empty());
            assert!(got.iter().all(|p| p.state == "playing"), "{got:?}");
            fake.task.abort();
        });
    }

    #[test]
    fn launching_without_vlc_says_so_and_a_bad_url_says_that_first() {
        // Off Windows there is no VLC to find, so a good URL reaches the
        // finder; on Windows with VLC installed it would start one.
        #[cfg(not(windows))]
        assert_eq!(
            launch("https://h/x.mkv".into(), "t".into(), None, None)
                .err()
                .as_deref(),
            Some(NOT_INSTALLED)
        );
        let e = launch("file:///etc/passwd".into(), "t".into(), None, None)
            .err()
            .unwrap();
        assert_ne!(e, NOT_INSTALLED);
    }
}
