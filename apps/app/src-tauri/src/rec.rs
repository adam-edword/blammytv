//! Recording a live channel to a file (plan 029, Phase 2).
//!
//! WHAT. A channel's bytes go to a `.ts` in the person's Videos folder while
//! they watch something else or nothing at all. It is its own download, apart
//! from the player (plan 029, D1), so a recording outlives a channel switch,
//! Go Live, the watchdog's self-heal and the app closing.
//!
//! HOW. The same fetch Multi-View uses (`mvproxy::open_stream`: Windows' own
//! TLS, the playlist's User-Agent, its redirects and timeouts) feeds ffmpeg's
//! STDIN, `-c copy` into MPEG-TS, as mvconvert.rs feeds it for an HEVC tile. So
//! ffmpeg never sees a URL, and can never print the line's credentials.
//!
//! HLS (`.m3u8`, told apart as the page's `kindOf` does) goes through
//! `mvproxy::open_hls_as`, whose loopback URL is the only thing a second ffmpeg
//! is given. It reads the stream and writes MPEG-TS to its stdout, and Rust
//! feeds that to the same ffmpeg that writes the file. ONE WRITER either way,
//! because ffmpeg's file protocol has no append: a reader that dies and is
//! started again would otherwise start a second file.
//!
//! STOPPING is closing the writer's stdin. ffmpeg finishes what it holds,
//! writes the file out and exits. An app that dies closes the pipe the same
//! way, and MPEG-TS has no index to lose, so the file stays playable either
//! way. A partial file is kept.
//!
//! RECONNECTING. When the provider drops the stream, Rust asks again (1s, 2s,
//! 5s, then every 10s) for up to two minutes, into the same ffmpeg, so one
//! recording is one file. A join lands partway through a packet, and ffmpeg
//! finds its footing again within a packet or two: MEASURED, the output is the
//! same size with the bytes cut to whole packets first, so they are not. ffmpeg
//! is told to close any timestamp jump over a second
//! (`-dts_delta_threshold 1`, `writer_args`) so the timeline stays continuous
//! across an outage. MEASURED on ffmpeg master with a 20s clip and a gap cut
//! out of it: with the default of 10 seconds a 2s and a 5s gap stayed in the
//! timeline as a hole (duration 20s of 18s and 15s of content), a 10s gap did
//! not, which is a policy that depends on how long the outage was. With 1 the
//! durations came out 17.97s and 14.97s. ffmpeg only looks at video and audio
//! for this (ffmpeg_demux.c `ts_discontinuity_process`), so a sparse subtitle
//! stream cannot trip it. `-copyts` would keep every hole.
//!
//! THE INDEX is `recordings.json` in the app's data folder, written whole to a
//! temp file and renamed over the old one. One still marked Recording when the
//! app starts is a recording the app died in, and becomes Partial.
//!
//! KEEPING WINDOWS AWAKE. `SetThreadExecutionState` belongs to the thread that
//! calls it, and ends with that thread, so the call is made by a thread of its
//! own that lives as long as the app (`Awake`), told by a channel.
//!
//! NEVER LOGS A URL. Origins only (mvproxy::origin_of), and ffmpeg's own words
//! with the file's path cut out of them: the path has the user's name in it.
//!
//! Its own file so the host crate (scripts/mvproxy-host) can run its tests with
//! a real ffmpeg; lib.rs pulls in tauri and cannot be built on Linux. Nothing
//! here names tauri: lib.rs hands it a callback for the events.

use std::collections::{HashMap, VecDeque};
use std::fs::OpenOptions;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::{select, Either};
use hyper::body::Bytes;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::watch;

use crate::mvconvert::{self, Said};
use crate::{mpvagent, mpvurl, mvproxy};

const GIB: u64 = 1024 * 1024 * 1024;

/// Under this free on the drive, a recording is not started.
pub const MIN_TO_START: u64 = 2 * GIB;
/// Under this, a running one is stopped and its file kept.
pub const MIN_TO_RUN: u64 = GIB;

/// The most a name's channel and programme parts may be, in characters, so a
/// path stays well under Windows' 260.
const CHANNEL_MAX: usize = 50;
const PROGRAMME_MAX: usize = 70;

/// How long a stream may give no bytes at all before a connection is called
/// dead at the start. The proxy's own read timeout, for the same reason.
const FIRST_BYTES: Duration = Duration::from_secs(20);

/// How long ffmpeg may refuse a write before it counts as hung.
const WRITE_STALL: Duration = Duration::from_secs(30);

/// Why a recording is not Done, in the words the page shows after "Partial" or
/// "Failed". Plain phrases, no full stop: the page wraps them.
pub const APP_CLOSED: &str = "app closed while recording";
pub const STREAM_LOST: &str = "stream lost";
pub const DISK_FULL: &str = "disk full";
pub const CHANNEL_CHANGED: &str = "stopped when the channel changed";
pub const NOTHING: &str = "nothing was recorded";
const RECORDER_STOPPED: &str = "the recorder stopped";

// ---------------------------------------------------------------------------
// What the page sees.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Recording,
    Done,
    Partial,
    Failed,
}

/// One recording, as the index keeps it and the page reads it. Times are Unix
/// milliseconds. `reason` says why it is Partial or Failed, and is null
/// otherwise. `buffer` is a recording of the player's own buffer, which opens
/// no connection of its own: the page counts a line's connections by it. An
/// index from before it existed has none, and reads as false.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub channel: String,
    #[serde(default)]
    pub programme: Option<String>,
    pub playlist_id: String,
    pub started_at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    pub path: String,
    pub bytes: u64,
    pub status: Status,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub buffer: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    records: Vec<Record>,
}

/// What `start` is given. The agent is what `mpvagent::clean` has passed.
pub struct Spec {
    pub url: String,
    pub user_agent: Option<String>,
    pub channel: String,
    pub programme: Option<String>,
    pub playlist_id: String,
    pub folder: PathBuf,
}

/// What `buffer_start` is given.
pub struct BufferSpec {
    pub channel: String,
    pub programme: Option<String>,
    pub playlist_id: String,
    pub folder: PathBuf,
}

pub type Free = Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>;

/// The numbers a recorder runs on, so a test can run it in seconds.
#[derive(Clone)]
pub struct Config {
    /// None is `mvconvert::locate`.
    pub ffmpeg: Option<PathBuf>,
    /// How long a stream may stay down before the recording is given up.
    pub window: Duration,
    /// The waits before the first reconnects, then `steady` between the rest.
    pub retry: Vec<Duration>,
    pub steady: Duration,
    /// How long an HLS reader may say nothing before it counts as down, as
    /// the proxy's read timeout does for a direct stream. A live playlist
    /// that stops naming segments leaves ffmpeg alive and silent.
    pub read_idle: Duration,
    /// How long a file may stay empty, with bytes coming, before the recording
    /// is called Failed. ffmpeg has the first of them out within seconds of
    /// the stream's own; a feed that is not a stream (an error page served as
    /// 200) would otherwise be asked for again and again for ever, holding a
    /// connection on the line.
    pub first_output: Duration,
    /// How often the size is read, the disk looked at and the page told.
    pub tick: Duration,
    /// How long ffmpeg has to finish a file once its input is closed.
    pub stop_wait: Duration,
    /// How long a buffer recording waits, after mpv is told to stop, for it to
    /// close the file before its size is read.
    pub settle: Duration,
    pub min_start: u64,
    pub min_run: u64,
    /// Free bytes where a folder is. None when it cannot be told.
    pub free: Free,
    /// Told whenever a record changes: status at once, size every `tick`.
    pub emit: Arc<dyn Fn(&Record) + Send + Sync>,
}

impl Config {
    pub fn app(emit: Arc<dyn Fn(&Record) + Send + Sync>) -> Config {
        Config {
            ffmpeg: None,
            window: Duration::from_secs(120),
            retry: [1, 2, 5].map(Duration::from_secs).to_vec(),
            steady: Duration::from_secs(10),
            read_idle: Duration::from_secs(20),
            first_output: Duration::from_secs(30),
            tick: Duration::from_secs(5),
            stop_wait: Duration::from_secs(10),
            settle: Duration::from_secs(2),
            min_start: MIN_TO_START,
            min_run: MIN_TO_RUN,
            free: Arc::new(free_bytes),
            emit,
        }
    }
}

// ---------------------------------------------------------------------------
// The names of things.

/// A name's part: whatever Windows refuses in a file name, and control
/// characters, become spaces; runs of space collapse to one; cut to `max`
/// characters; no trailing dot or space, which Windows drops or refuses.
fn clean_part(s: &str, max: usize) -> String {
    let spaced: String = s
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let one = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = one.chars().take(max).collect();
    cut.trim_end_matches(['.', ' ']).to_string()
}

/// `<Channel> <YYYY-MM-DD HHmm>[ - <Programme>].ts`. A channel with nothing
/// left in it is "Recording". The stamp is always there, so the stem is never
/// one of Windows' device names (CON, NUL and the rest).
pub fn file_name(channel: &str, programme: Option<&str>, when: [u32; 5]) -> String {
    let channel = clean_part(channel, CHANNEL_MAX);
    let channel = if channel.is_empty() {
        "Recording"
    } else {
        &channel
    };
    let [y, mo, d, h, mi] = when;
    let mut name = format!("{channel} {y:04}-{mo:02}-{d:02} {h:02}{mi:02}");
    if let Some(p) = programme
        .map(|p| clean_part(p, PROGRAMME_MAX))
        .filter(|p| !p.is_empty())
    {
        name.push_str(" - ");
        name.push_str(&p);
    }
    name.push_str(".ts");
    name
}

/// This minute on the person's clock: year, month, day, hour, minute.
#[cfg(windows)]
fn local_now() -> [u32; 5] {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe { GetLocalTime() };
    [t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute].map(u32::from)
}

/// shortcut: UTC off Windows, where nothing ships; upgrade if a build ever does.
#[cfg(not(windows))]
fn local_now() -> [u32; 5] {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    // Days since 1970 to a calendar date (Howard Hinnant's civil_from_days).
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    let rem = secs % 86_400;
    [
        y as u32,
        m as u32,
        d as u32,
        (rem / 3600) as u32,
        (rem % 3600 / 60) as u32,
    ]
}

/// Make the file's name and take it, so two recordings of one channel in one
/// minute do not share a file: `... (2).ts`, `(3)` and so on. Created empty
/// (`create_new` refuses a name in use), and ffmpeg overwrites the empty file.
fn take_name(folder: &Path, name: &str) -> Result<PathBuf, String> {
    let stem = name.strip_suffix(".ts").unwrap_or(name);
    for n in 1..=99 {
        let file = if n == 1 {
            format!("{stem}.ts")
        } else {
            format!("{stem} ({n}).ts")
        };
        let path = folder.join(file);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                log::warn!("[rec] could not create the file: {}", e.kind());
                return Err("the recordings folder can't be written to".into());
            }
        }
    }
    Err("too many recordings with that name".into())
}

/// Where the folder picker opens: the folder the page has now if it is there,
/// else the default if it is, else the folder above the default (Videos, say,
/// before the first recording has made `BlammyTV`), else the dialog's own.
pub fn picker_start(current: Option<&str>, default: &Path) -> Option<PathBuf> {
    let current = current.map(str::trim).filter(|c| !c.is_empty());
    current
        .map(PathBuf::from)
        .filter(|c| c.is_dir())
        .or_else(|| Some(default.to_path_buf()).filter(|d| d.is_dir()))
        .or_else(|| {
            default
                .parent()
                .map(Path::to_path_buf)
                .filter(|p| p.is_dir())
        })
}

/// How a page tells an HLS link from the rest (MultiviewTile.tsx `kindOf`):
/// `.m3u8` followed by a query or the end.
pub fn is_hls(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower
        .match_indices(".m3u8")
        .any(|(i, m)| matches!(lower.as_bytes().get(i + m.len()), None | Some(b'?')))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn new_id() -> String {
    let mut raw = [0u8; 4];
    let _ = getrandom::fill(&mut raw);
    format!("{:x}-{:08x}", now_ms(), u32::from_be_bytes(raw))
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn size_of(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.len())
}

/// Only a file this module could have made is read back, played or deleted
/// from an index entry: a `.ts`.
fn ours(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("ts"))
}

/// A recording that wrote nothing failed, whatever ended it.
fn or_failed(bytes: u64, status: Status) -> Status {
    if bytes == 0 {
        Status::Failed
    } else {
        status
    }
}

// ---------------------------------------------------------------------------
// The disk, and the machine's sleep.

/// Free bytes on the drive a folder is on, for this user (quotas count).
#[cfg(windows)]
pub fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    // A UNC share must be asked about with a trailing backslash.
    let mut name = dir.as_os_str().to_os_string();
    if !dir.to_string_lossy().ends_with('\\') {
        name.push("\\");
    }
    let wide: Vec<u16> = name.encode_wide().chain(Some(0)).collect();
    let mut free = 0u64;
    unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free), None, None) }.ok()?;
    Some(free)
}

/// Nothing off Windows says, and a recorder that cannot tell goes ahead.
#[cfg(not(windows))]
pub fn free_bytes(_: &Path) -> Option<u64> {
    None
}

/// Holds the machine awake while at least one recording runs.
struct Awake {
    /// Recordings holding it, and the thread that does the calling.
    state: Mutex<(usize, Option<mpsc::Sender<bool>>)>,
    /// What the thread last set. A test reads it.
    on: Arc<AtomicBool>,
}

impl Awake {
    fn new() -> Awake {
        Awake {
            state: Mutex::new((0, None)),
            on: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Under the lock, so the thread hears 'on' and 'off' in the order they
    /// happened. The thread is made on first use and lives as long as this.
    fn tell(&self, change: impl FnOnce(&mut usize) -> Option<bool>) {
        let mut g = lock(&self.state);
        let Some(on) = change(&mut g.0) else { return };
        let tx = g.1.get_or_insert_with(|| {
            let (tx, rx) = mpsc::channel::<bool>();
            let flag = self.on.clone();
            let _ = std::thread::Builder::new()
                .name("rec-awake".into())
                .spawn(move || {
                    for on in rx {
                        set_awake(on);
                        flag.store(on, Ordering::SeqCst);
                    }
                });
            tx
        });
        let _ = tx.send(on);
    }

    fn hold(&self) {
        self.tell(|n| {
            *n += 1;
            (*n == 1).then_some(true)
        });
    }

    fn release(&self) {
        self.tell(|n| {
            *n = n.saturating_sub(1);
            (*n == 0).then_some(false)
        });
    }
}

/// ES_CONTINUOUS alone puts it back. The system may not sleep; the screen may.
#[cfg(windows)]
fn set_awake(on: bool) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };
    unsafe {
        SetThreadExecutionState(if on {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        });
    }
}

#[cfg(not(windows))]
fn set_awake(_: bool) {}

// ---------------------------------------------------------------------------
// The bytes.

/// ffmpeg's arguments for the WRITER: the stream on stdin, the file out. No URL
/// of any kind, and nothing the provider sent is in them.
///
/// - `-f mpegts` on the input: it is what an IPTV link serves, and it skips
///   guessing at it. Anything else ends as a Failed recording with ffmpeg's
///   words.
/// - `+genpts+discardcorrupt`: the same as a tile's conversion.
/// - Probing is left at ffmpeg's defaults. A recording is not waiting on its
///   first frame, and a short probe can miss a stream that comes late.
/// - `-dts_delta_threshold 1`: see the top of this file.
/// - Video, audio and subtitles, all of them; not the data streams.
/// - `-flush_packets 1`: the file is written a packet at a time, so what is on
///   disk is what was read, and a killed ffmpeg loses almost nothing.
pub fn writer_args(file: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "level+info",
        "-f",
        "mpegts",
        "-fflags",
        "+genpts+discardcorrupt",
        "-dts_delta_threshold",
        "1",
        "-i",
        "pipe:0",
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-map",
        "0:s?",
        "-c",
        "copy",
        "-f",
        "mpegts",
        "-flush_packets",
        "1",
        "-y",
        file,
    ]
    .map(String::from)
    .to_vec()
}

/// ffmpeg's arguments for an HLS READER: the proxy's loopback URL in, MPEG-TS
/// out on stdout. `-allowed_extensions ALL -extension_picky 0` because every
/// URI the proxy serves is `/mv/<token>/<n>` with no extension for ffmpeg to
/// like (measured on the shinchiro build: without them it refuses the first
/// segment, "not in allowed_segment_extensions"). `-live_start_index -1`
/// starts at the newest segment: a restart asks for it again, and the default
/// of three back would repeat them.
pub fn reader_args(local: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "level+info",
        "-allowed_extensions",
        "ALL",
        "-extension_picky",
        "0",
        "-live_start_index",
        "-1",
        "-i",
        local,
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-map",
        "0:s?",
        "-c",
        "copy",
        "-f",
        "mpegts",
        "-flush_packets",
        "1",
        "pipe:1",
    ]
    .map(String::from)
    .to_vec()
}

/// Where the bytes come from, and how to ask again.
struct Source {
    hls: bool,
    /// The link now. `rec_set_url` changes it; a reconnect reads it.
    url: Arc<Mutex<String>>,
    agent: Option<String>,
    ffmpeg: PathBuf,
    read_idle: Duration,
}

enum Feed {
    Direct(reqwest::Response),
    Hls(Box<Reader>),
}

/// An HLS reader. The stdin is held so the reader is not told to stop, and
/// `local` is closed when this goes.
struct Reader {
    _child: Child,
    _stdin: ChildStdin,
    out: ChildStdout,
    local: String,
    _log: AbortOnDrop,
    problems: Problems,
}

/// One open connection's bytes.
struct Conn {
    feed: Feed,
    /// The chunk that proved the connection, handed out first.
    first: Option<Bytes>,
    /// Silence from an HLS reader longer than this is an error.
    read_idle: Duration,
}

impl Drop for Conn {
    fn drop(&mut self) {
        if let Feed::Hls(r) = &self.feed {
            mvproxy::close(&r.local);
        }
    }
}

impl Conn {
    /// The next bytes, None when the connection ended cleanly, an error when
    /// it broke. Holds its place if it is dropped between awaits.
    async fn next(&mut self) -> Option<Result<Bytes, String>> {
        if let Some(first) = self.first.take() {
            return Some(Ok(first));
        }
        match &mut self.feed {
            Feed::Direct(res) => match res.chunk().await {
                Ok(Some(b)) => Some(Ok(b)),
                Ok(None) => None,
                // Not reqwest's own words: they carry the URL.
                Err(_) => Some(Err("upstream read failed".into())),
            },
            Feed::Hls(r) => {
                let mut buf = vec![0u8; 64 * 1024];
                match tokio::time::timeout(self.read_idle, r.out.read(&mut buf)).await {
                    Ok(Ok(0)) => None,
                    Ok(Ok(n)) => {
                        buf.truncate(n);
                        Some(Ok(Bytes::from(buf)))
                    }
                    Ok(Err(_)) => Some(Err("reader read failed".into())),
                    Err(_) => Some(Err("the reader went quiet".into())),
                }
            }
        }
    }

    /// Wait for the first bytes, so a link that answers and sends nothing is
    /// not called a recording.
    async fn prime(mut self) -> Result<Conn, String> {
        match tokio::time::timeout(FIRST_BYTES, self.next()).await {
            Ok(Some(Ok(first))) => {
                self.first = Some(first);
                Ok(self)
            }
            Ok(Some(Err(e))) => Err(e),
            Ok(None) => {
                // The reader's last words, which its log may not have read yet.
                tokio::time::sleep(Duration::from_millis(300)).await;
                Err(match &self.feed {
                    Feed::Hls(r) => r
                        .problems
                        .last()
                        .unwrap_or_else(|| "the stream ended at once".into()),
                    Feed::Direct(_) => "the stream ended at once".into(),
                })
            }
            Err(_) => Err("no data from the stream for 20 seconds".into()),
        }
    }
}

impl Source {
    /// A connection with bytes on it, or why not. The words never hold the link.
    async fn connect(&self) -> Result<Conn, String> {
        let url = lock(&self.url).clone();
        let feed = if self.hls {
            self.hls_reader(&url).await?
        } else {
            let agent = mpvagent::header_value(self.agent.as_deref());
            Feed::Direct(mvproxy::open_stream(&url, agent.as_ref()).await?)
        };
        Conn {
            feed,
            first: None,
            read_idle: self.read_idle,
        }
        .prime()
        .await
    }

    async fn hls_reader(&self, url: &str) -> Result<Feed, String> {
        let local = mvproxy::open_hls_as(url, self.agent.as_deref())?;
        let spawned = mvconvert::command(&self.ffmpeg)
            .args(reader_args(&local))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                mvproxy::close(&local);
                log::warn!("[rec] the reader ffmpeg did not start: {}", e.kind());
                return Err("the recorder couldn't start".into());
            }
        };
        let (Some(stdin), Some(out), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            mvproxy::close(&local);
            return Err("ffmpeg's pipes did not open".into());
        };
        let problems = Problems::default();
        let log = tokio::spawn(follow(stderr, vec![local.clone()], problems.clone()));
        Ok(Feed::Hls(Box::new(Reader {
            _child: child,
            _stdin: stdin,
            out,
            local,
            _log: AbortOnDrop(log.abort_handle()),
            problems,
        })))
    }
}

/// A task that stops when this does.
struct AbortOnDrop(tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// ffmpeg's last few problems, for the reason a recording gives.
#[derive(Clone, Default)]
struct Problems(Arc<Mutex<VecDeque<String>>>);

impl Problems {
    fn push(&self, line: String) {
        let mut g = lock(&self.0);
        g.push_back(line);
        if g.len() > 3 {
            g.pop_front();
        }
    }

    /// The newest, short enough for a reason.
    fn last(&self) -> Option<String> {
        lock(&self.0).back().map(|l| l.chars().take(120).collect())
    }
}

/// ffmpeg's log a line at a time (as bytes, so a name that is not UTF-8 does
/// not end it): the stream descriptions, and the problems up to a limit, with
/// every `hide` cut out. A path and a loopback URL are the things it can say
/// that the log should not.
async fn follow<R>(stderr: R, hide: Vec<String>, keep: Problems)
where
    R: AsyncRead + Unpin,
{
    let hide = |text: &str| {
        hide.iter()
            .filter(|h| !h.is_empty())
            .fold(text.to_string(), |t, h| t.replace(h.as_str(), "[file]"))
    };
    let mut lines = BufReader::new(stderr).split(b'\n');
    let mut printed = 0;
    while let Ok(Some(raw)) = lines.next_segment().await {
        let line = String::from_utf8_lossy(&raw);
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        match mvconvert::said(line) {
            Said::Stream(text) => log::info!("[rec] ffmpeg: {}", hide(&text)),
            Said::Problem(text) => {
                let text = hide(&text);
                if printed < mvconvert::LOG_LINES {
                    log::warn!("[rec] ffmpeg: {text}");
                    printed += 1;
                }
                keep.push(text);
            }
            Said::Quiet => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Racing a stop.

/// What ends a recording. The first reason set stays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Why {
    User,
    DiskFull,
    ChannelChanged,
    /// The file is still empty after `first_output`.
    NoOutput,
}

type StopTx = Arc<watch::Sender<Option<Why>>>;
type Stop = watch::Receiver<Option<Why>>;

fn ask_stop(tx: &StopTx, why: Why) {
    tx.send_if_modified(|s| {
        s.is_none() && {
            *s = Some(why);
            true
        }
    });
}

/// Resolves when a stop has been asked for.
async fn stopped(stop: &mut Stop) -> Why {
    loop {
        if let Some(why) = *stop.borrow_and_update() {
            return why;
        }
        if stop.changed().await.is_err() {
            return Why::User;
        }
    }
}

async fn first<A: Future, B: Future>(a: A, b: B) -> Either<A::Output, B::Output> {
    match select(std::pin::pin!(a), std::pin::pin!(b)).await {
        Either::Left((x, _)) => Either::Left(x),
        Either::Right((y, _)) => Either::Right(y),
    }
}

// ---------------------------------------------------------------------------
// The recorder.

struct Live {
    stop: StopTx,
    done: watch::Receiver<bool>,
    /// A stream recording's link, for `set_url`.
    url: Option<Arc<Mutex<String>>>,
    /// A recording of the player's own buffer, which only the player's
    /// changes end (`player_changed`).
    buffer: bool,
}

pub struct Rec {
    index: PathBuf,
    cfg: Config,
    records: Mutex<Vec<Record>>,
    live: Mutex<HashMap<String, Live>>,
    /// One index write at a time, so an old snapshot is never the last.
    write: Mutex<()>,
    /// False when the index on disk could not be read or moved aside: it is
    /// not written over (`load`).
    writable: bool,
    /// Held from the check for a running buffer recording to its registration,
    /// so two starts cannot both pass.
    buffer_gate: Mutex<()>,
    awake: Awake,
}

/// How a stream recording's pump ended.
enum Ended {
    Stopped(Why),
    /// The stream stayed down for the whole window.
    Lost,
    /// ffmpeg went by itself.
    Writer,
}

impl Rec {
    /// Read the index; a recording it still calls Recording is one the app died
    /// in.
    pub fn open(index: PathBuf, cfg: Config) -> Arc<Rec> {
        let (mut records, writable) = load(&index);
        let mut fixed = false;
        for r in records.iter_mut().filter(|r| r.status == Status::Recording) {
            let meta = std::fs::metadata(&r.path).ok();
            r.bytes = meta.as_ref().map_or(r.bytes, |m| m.len());
            r.ended_at = Some(
                meta.and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or_else(now_ms, |d| d.as_millis() as u64),
            );
            r.status = or_failed(r.bytes, Status::Partial);
            r.reason = Some(APP_CLOSED.into());
            fixed = true;
        }
        let rec = Arc::new(Rec {
            index,
            cfg,
            records: Mutex::new(records),
            live: Mutex::new(HashMap::new()),
            write: Mutex::new(()),
            writable,
            buffer_gate: Mutex::new(()),
            awake: Awake::new(),
        });
        if fixed {
            rec.save();
        }
        rec
    }

    /// Newest first.
    pub fn list(&self) -> Vec<Record> {
        let mut all = lock(&self.records).clone();
        all.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        all
    }

    fn get(&self, id: &str) -> Option<Record> {
        lock(&self.records).iter().find(|r| r.id == id).cloned()
    }

    /// Write the index: to a temp file beside it, then renamed over it.
    fn save(&self) {
        if !self.writable {
            return;
        }
        let _one_at_a_time = lock(&self.write);
        let json = {
            let records = lock(&self.records).clone();
            serde_json::to_vec_pretty(&Index {
                version: 1,
                records,
            })
        };
        let wrote = json
            .map_err(std::io::Error::other)
            .and_then(|json| write_atomic(&self.index, &json));
        if let Err(e) = wrote {
            log::warn!("[rec] could not save the index: {}", e.kind());
        }
    }

    /// Change a record, and tell the page if `f` said it did.
    fn change(&self, id: &str, save: bool, f: impl FnOnce(&mut Record) -> bool) -> Option<Record> {
        let (changed, rec) = {
            let mut g = lock(&self.records);
            let r = g.iter_mut().find(|r| r.id == id)?;
            (f(r), r.clone())
        };
        if changed {
            if save {
                self.save();
            }
            (self.cfg.emit)(&rec);
        }
        Some(rec)
    }

    /// The folder made, the drive checked, the file's name taken.
    fn reserve(
        &self,
        folder: &Path,
        channel: &str,
        programme: Option<&str>,
    ) -> Result<PathBuf, String> {
        // The page sends this; a relative one would be the app's own folder.
        if !folder.is_absolute() {
            return Err("the recordings folder must be a full path".into());
        }
        std::fs::create_dir_all(folder)
            .map_err(|e| {
                log::warn!("[rec] could not make the folder: {}", e.kind());
                "the recordings folder couldn't be made".to_string()
            })?;
        if (self.cfg.free)(folder).is_some_and(|free| free < self.cfg.min_start) {
            return Err(format!(
                "not enough free disk space (recording needs {} GB)",
                self.cfg.min_start / GIB
            ));
        }
        take_name(folder, &file_name(channel, programme, local_now()))
    }

    fn new_record(
        &self,
        channel: String,
        programme: Option<String>,
        playlist_id: String,
        path: &Path,
        buffer: bool,
    ) -> Record {
        Record {
            id: new_id(),
            channel,
            programme,
            playlist_id,
            started_at: now_ms(),
            ended_at: None,
            path: path.to_string_lossy().into_owned(),
            bytes: 0,
            status: Status::Recording,
            reason: None,
            buffer,
        }
    }

    /// Add a record that is now running. The machine is held awake until
    /// `finish`.
    fn register(&self, record: &Record, live: Live) {
        lock(&self.live).insert(record.id.clone(), live);
        lock(&self.records).push(record.clone());
        self.awake.hold();
        self.save();
        (self.cfg.emit)(record);
    }

    /// A recording is over: its record says how, and everything waiting on it
    /// is let go.
    fn finish(
        &self,
        id: &str,
        status: Status,
        reason: Option<String>,
        done: &watch::Sender<bool>,
        path: &Path,
    ) {
        let bytes = size_of(path);
        // The record and the live entry change together, as far as anyone
        // looking at the live map can tell: a page that sees Partial and
        // starts the next buffer recording at once must not be told one is
        // still running.
        let mut live = lock(&self.live);
        self.change(id, true, |r| {
            r.bytes = bytes.unwrap_or(r.bytes);
            r.status = or_failed(r.bytes, status);
            r.reason = if r.status == Status::Failed && reason.is_none() {
                Some(NOTHING.into())
            } else {
                reason
            };
            r.ended_at = Some(now_ms());
            true
        });
        live.remove(id);
        drop(live);
        self.awake.release();
        let _ = done.send(true);
    }

    /// Record a stream. Returns once bytes are flowing, or with why not, and
    /// leaves nothing behind when it fails.
    pub async fn start(self: &Arc<Self>, spec: Spec) -> Result<String, String> {
        mpvurl::http_only(&spec.url)?;
        let ffmpeg = match &self.cfg.ffmpeg {
            Some(p) => p.clone(),
            None => mvconvert::locate()?,
        };
        let path = self.reserve(&spec.folder, &spec.channel, spec.programme.as_deref())?;
        let source = Source {
            hls: is_hls(&spec.url),
            url: Arc::new(Mutex::new(spec.url)),
            agent: spec.user_agent,
            ffmpeg: ffmpeg.clone(),
            read_idle: self.cfg.read_idle,
        };
        let origin = mvproxy::origin_of(&lock(&source.url));
        let conn = match source.connect().await {
            Ok(c) => c,
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                return Err(e);
            }
        };
        let file = path.to_string_lossy().into_owned();
        let spawned = mvconvert::command(&ffmpeg)
            .args(writer_args(&file))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                log::warn!("[rec] ffmpeg did not start: {}", e.kind());
                return Err("the recorder couldn't start".into());
            }
        };
        let (Some(stdin), Some(stderr)) = (child.stdin.take(), child.stderr.take()) else {
            let _ = std::fs::remove_file(&path);
            return Err("ffmpeg's pipes did not open".into());
        };
        let problems = Problems::default();
        let log = tokio::spawn(follow(stderr, vec![file], problems.clone()));

        let record = self.new_record(spec.channel, spec.programme, spec.playlist_id, &path, false);
        let (stop_tx, stop_rx) = watch::channel(None);
        let (done_tx, done_rx) = watch::channel(false);
        let stop_tx: StopTx = Arc::new(stop_tx);
        self.register(
            &record,
            Live {
                stop: stop_tx.clone(),
                done: done_rx,
                url: Some(source.url.clone()),
                buffer: false,
            },
        );
        log::info!(
            "[rec] {} started: {} from {origin}",
            record.id,
            if source.hls { "hls" } else { "ts" }
        );
        let ticker = tokio::spawn(self.clone().tick(record.id.clone(), path.clone(), stop_tx));
        let this = self.clone();
        let id = record.id.clone();
        tokio::spawn(async move {
            let _ticker = AbortOnDrop(ticker.abort_handle());
            let mut stop = stop_rx;
            let mut stdin = stdin;
            let ended = this
                .pump(conn, &source, &mut stdin, &mut child, &mut stop)
                .await;
            // Closing the pipe is what tells ffmpeg to finish the file.
            drop(stdin);
            let finished = Finished {
                id: &id,
                path: &path,
                done: &done_tx,
                problems: &problems,
            };
            this.close_writer(finished, ended, child, log).await;
        });
        Ok(record.id)
    }

    /// Feed the writer until a stop, the stream's end for good, or ffmpeg's.
    async fn pump(
        &self,
        mut conn: Conn,
        source: &Source,
        stdin: &mut ChildStdin,
        child: &mut Child,
        stop: &mut Stop,
    ) -> Ended {
        // When the stream went down, until bytes come again.
        let mut down_since: Option<Instant> = None;
        loop {
            let event = first(conn.next(), first(stopped(stop), child.wait())).await;
            match event {
                Either::Left(Some(Ok(bytes))) => {
                    down_since = None;
                    // A stop that lands in the middle of a write leaves a torn
                    // packet at the end of the pipe, which ffmpeg drops.
                    match first(
                        stopped(stop),
                        tokio::time::timeout(WRITE_STALL, stdin.write_all(&bytes)),
                    )
                    .await
                    {
                        Either::Left(why) => return Ended::Stopped(why),
                        Either::Right(Ok(Ok(()))) => {}
                        Either::Right(_) => return Ended::Writer,
                    }
                }
                // The stream broke or ended. A live one does not end, so ask again.
                Either::Left(_) => {
                    let since = *down_since.get_or_insert_with(Instant::now);
                    match self.reconnect(source, since, stop).await {
                        Ok(c) => conn = c,
                        Err(ended) => return ended,
                    }
                }
                Either::Right(Either::Left(why)) => return Ended::Stopped(why),
                Either::Right(Either::Right(_exit)) => return Ended::Writer,
            }
        }
    }

    /// A new connection, backing off between tries. Err is how the recording
    /// ends instead: a stop that came first, or the stream down the whole window.
    async fn reconnect(
        &self,
        source: &Source,
        down_since: Instant,
        stop: &mut Stop,
    ) -> Result<Conn, Ended> {
        let mut tries = 0;
        loop {
            if down_since.elapsed() >= self.cfg.window {
                return Err(Ended::Lost);
            }
            let wait = self
                .cfg
                .retry
                .get(tries)
                .copied()
                .unwrap_or(self.cfg.steady);
            tries += 1;
            if let Either::Left(why) = first(stopped(stop), tokio::time::sleep(wait)).await {
                return Err(Ended::Stopped(why));
            }
            match first(stopped(stop), source.connect()).await {
                Either::Left(why) => return Err(Ended::Stopped(why)),
                Either::Right(Ok(c)) => return Ok(c),
                Either::Right(Err(_)) => {}
            }
        }
    }

    /// The writer's input is closed: let ffmpeg finish the file (killed after
    /// `stop_wait`), then say how the recording ended.
    async fn close_writer(
        &self,
        fin: Finished<'_>,
        ended: Ended,
        mut child: Child,
        log: tokio::task::JoinHandle<()>,
    ) {
        let exit = match tokio::time::timeout(self.cfg.stop_wait, child.wait()).await {
            Ok(Ok(status)) => Some(status),
            _ => {
                let _ = child.kill().await;
                None
            }
        };
        // Its last words, once it has said them.
        let _ = tokio::time::timeout(Duration::from_secs(1), log).await;
        let clean = exit.is_some_and(|s| s.success());
        let why =
            |fallback: &str| Some(fin.problems.last().unwrap_or_else(|| fallback.to_string()));
        let (status, reason) = match ended {
            Ended::Stopped(Why::User) if clean => (Status::Done, None),
            Ended::Stopped(Why::User) => (Status::Partial, why(RECORDER_STOPPED)),
            Ended::Stopped(Why::DiskFull) => (Status::Partial, Some(DISK_FULL.into())),
            Ended::Stopped(Why::ChannelChanged) => (Status::Partial, Some(CHANNEL_CHANGED.into())),
            Ended::Stopped(Why::NoOutput) => (Status::Failed, why(NOTHING)),
            Ended::Lost => (Status::Partial, Some(STREAM_LOST.into())),
            Ended::Writer => (Status::Partial, why(RECORDER_STOPPED)),
        };
        log::info!("[rec] {} ended: {status:?}", fin.id);
        self.finish(fin.id, status, reason, fin.done, fin.path);
    }

    /// Every `tick`: the file's size to the page, and the disk looked at. A
    /// drive under `min_run` stops the recording and keeps what there is, and
    /// a file still empty after `first_output` stops it as Failed.
    async fn tick(self: Arc<Self>, id: String, path: PathBuf, stop: StopTx) {
        let folder = path.parent().map(Path::to_path_buf).unwrap_or_default();
        let started = Instant::now();
        loop {
            tokio::time::sleep(self.cfg.tick).await;
            if let Some(bytes) = size_of(&path) {
                self.change(&id, false, |r| {
                    std::mem::replace(&mut r.bytes, bytes) != bytes
                });
                if bytes == 0 && started.elapsed() >= self.cfg.first_output {
                    ask_stop(&stop, Why::NoOutput);
                }
            }
            if (self.cfg.free)(&folder).is_some_and(|free| free < self.cfg.min_run) {
                ask_stop(&stop, Why::DiskFull);
            }
        }
    }

    /// Record the player's own buffer (D3). `begin` is how the player is told,
    /// given the file to write; it runs once the file is taken, and a failure
    /// leaves nothing behind. `end` is how it is told to stop. The recording
    /// has no ffmpeg and no connection: the player writes the file, and this
    /// watches its size, the disk, and the player's changes (`player_changed`).
    pub async fn buffer_start(
        self: &Arc<Self>,
        spec: BufferSpec,
        begin: impl FnOnce(&Path) -> Result<(), String>,
        end: Box<dyn Fn() + Send + Sync>,
    ) -> Result<String, String> {
        // The player has one dump: a second would replace the first, which
        // would stay Recording with nothing coming.
        let _gate = lock(&self.buffer_gate);
        if lock(&self.live).values().any(|l| l.buffer) {
            return Err("the player's buffer is already being recorded".into());
        }
        let path = self.reserve(&spec.folder, &spec.channel, spec.programme.as_deref())?;
        if let Err(e) = begin(&path) {
            let _ = std::fs::remove_file(&path);
            return Err(e);
        }
        let record = self.new_record(spec.channel, spec.programme, spec.playlist_id, &path, true);
        let (stop_tx, mut stop) = watch::channel(None);
        let (done_tx, done_rx) = watch::channel(false);
        let stop_tx: StopTx = Arc::new(stop_tx);
        self.register(
            &record,
            Live {
                stop: stop_tx.clone(),
                done: done_rx,
                url: None,
                buffer: true,
            },
        );
        log::info!("[rec] {} started: the player's buffer", record.id);
        let ticker = tokio::spawn(self.clone().tick(record.id.clone(), path.clone(), stop_tx));
        let this = self.clone();
        let id = record.id.clone();
        tokio::spawn(async move {
            let _ticker = AbortOnDrop(ticker.abort_handle());
            let why = stopped(&mut stop).await;
            // The player stops itself when the channel changes. Otherwise it is told.
            if why != Why::ChannelChanged {
                end();
            }
            tokio::time::sleep(this.cfg.settle).await;
            let (status, reason) = match why {
                Why::User => (Status::Done, None),
                Why::DiskFull => (Status::Partial, Some(DISK_FULL.to_string())),
                Why::ChannelChanged => (Status::Partial, Some(CHANNEL_CHANGED.to_string())),
                Why::NoOutput => (Status::Failed, Some(NOTHING.to_string())),
            };
            log::info!("[rec] {id} ended: {status:?}");
            this.finish(&id, status, reason, &done_tx, &path);
        });
        Ok(record.id)
    }

    /// The player loaded something, reloaded or stopped, which ends a
    /// recording of its buffer.
    pub fn player_changed(&self) {
        for l in lock(&self.live).values().filter(|l| l.buffer) {
            ask_stop(&l.stop, Why::ChannelChanged);
        }
    }

    /// Stop a recording and wait for its file to be finished. A recording that
    /// is not running is answered as it is.
    pub async fn stop(&self, id: &str) -> Result<Record, String> {
        let running = lock(&self.live)
            .get(id)
            .map(|l| (l.stop.clone(), l.done.clone()));
        if let Some((stop, mut done)) = running {
            ask_stop(&stop, Why::User);
            let wait = self.cfg.stop_wait + self.cfg.settle + Duration::from_secs(5);
            let _ = tokio::time::timeout(wait, done.wait_for(|d| *d)).await;
        }
        self.get(id).ok_or_else(|| "no such recording".into())
    }

    /// Hand a running recording a fresh link, for its next reconnect: a Stalker
    /// link expires, and the page can make a new one.
    pub fn set_url(&self, id: &str, url: &str) -> Result<(), String> {
        mpvurl::http_only(url)?;
        let live = lock(&self.live);
        let cell = live
            .get(id)
            .and_then(|l| l.url.as_ref())
            .ok_or("that recording is not running")?;
        *lock(cell) = url.to_string();
        Ok(())
    }

    /// The file to play or show, from the index and nowhere else, and only if
    /// it is there. The page names an id, never a path.
    pub fn playable(&self, id: &str) -> Result<PathBuf, String> {
        let rec = self.get(id).ok_or("no such recording")?;
        let path = PathBuf::from(rec.path);
        if !ours(&path) || !path.is_file() {
            return Err("the file is gone".into());
        }
        Ok(path)
    }

    /// Delete a recording's file and its entry. Not while it records.
    pub fn delete(&self, id: &str) -> Result<(), String> {
        let rec = self.get(id).ok_or("no such recording")?;
        if rec.status == Status::Recording || lock(&self.live).contains_key(id) {
            return Err("stop the recording first".into());
        }
        let path = PathBuf::from(&rec.path);
        if ours(&path) {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                // Windows refuses while the player has it open.
                Err(e) => {
                    log::warn!("[rec] could not delete the file: {}", e.kind());
                    return Err("the file is in use or read-only".into());
                }
            }
        }
        lock(&self.records).retain(|r| r.id != id);
        self.save();
        Ok(())
    }
}

/// What `close_writer` needs to know about the recording it is closing.
struct Finished<'a> {
    id: &'a str,
    path: &'a Path,
    done: &'a watch::Sender<bool>,
    problems: &'a Problems,
}

// ---------------------------------------------------------------------------
// The index file.

/// The index, and whether it is safe to write one over it. Only a file that is
/// not there means no recordings. One that cannot be read (not text, held open
/// by another program) or parsed is the person's recordings and is KEPT: moved
/// aside as `recordings.json.bad-<ms>`, a name no earlier one has, and then the
/// app starts empty. If it cannot even be moved aside, the second answer is
/// false and nothing is saved this run, so the next save cannot overwrite it.
fn load(path: &Path) -> (Vec<Record>, bool) {
    let parsed = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<Index>(&text)
            .map(|i| i.records)
            .map_err(|_| "could not be parsed"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Vec::new(), true),
        Err(_) => Err("could not be read"),
    };
    match parsed {
        Ok(records) => (records, true),
        Err(why) => {
            let mut aside = path.with_extension(format!("json.bad-{}", now_ms()));
            let mut n = 1;
            while aside.exists() {
                n += 1;
                aside = path.with_extension(format!("json.bad-{}-{n}", now_ms()));
            }
            let kept = std::fs::rename(path, &aside).is_ok();
            log::warn!(
                "[rec] the index {why}; {}",
                if kept {
                    "kept beside it as recordings.json.bad-*"
                } else {
                    "it could not be moved aside, so recordings are not saved this run"
                }
            );
            (Vec::new(), kept)
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)
}

// ---------------------------------------------------------------------------
// The one the app uses.

static REC: OnceLock<Arc<Rec>> = OnceLock::new();

/// Open the index and keep the recorder for the run. Once; the first wins.
pub fn init(index: PathBuf, emit: Arc<dyn Fn(&Record) + Send + Sync>) {
    let _ = REC.set(Rec::open(index, Config::app(emit)));
}

pub fn get() -> Result<&'static Arc<Rec>, String> {
    REC.get().ok_or_else(|| "recording is not available".into())
}

/// mpv.rs calls this where the player loads, reloads or stops.
pub fn player_changed() {
    if let Some(rec) = REC.get() {
        rec.player_changed();
    }
}

#[cfg(test)]
mod tests {
    //! Driven for real: a fake provider on a loopback port, the real ffmpeg
    //! (BLAMMYTV_FFMPEG on CI) writing the files, and ffmpeg again to say
    //! whether a file decodes and how long it is. The numbers a recorder runs
    //! on are cut to milliseconds (`Bench::new`), so none of this waits two
    //! minutes for a stream to be given up on.
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, AtomicUsize};

    /// An MPEG-TS packet.
    const TS: usize = 188;

    fn ffmpeg() -> PathBuf {
        mvconvert::locate().expect("no ffmpeg: set BLAMMYTV_FFMPEG")
    }

    fn temp(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let d = std::env::temp_dir().join(format!(
            "blammytv-rec-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Twelve seconds of MPEG-TS from ffmpeg itself: a test card and a tone,
    /// MPEG-2 and MP2, about 460 kbit/s. Made once.
    const SRC_SECS: f64 = 12.0;

    fn src() -> &'static Vec<u8> {
        static SRC: OnceLock<Vec<u8>> = OnceLock::new();
        SRC.get_or_init(|| {
            let dir = temp("src");
            let file = dir.join("src.ts");
            let out = std::process::Command::new(ffmpeg())
                .args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25"])
                .args(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"])
                .args(["-t", &SRC_SECS.to_string()])
                .args(["-c:v", "mpeg2video", "-b:v", "400k", "-g", "25"])
                .args(["-c:a", "mp2", "-b:a", "96k", "-f", "mpegts"])
                .arg(&file)
                .output()
                .expect("ffmpeg ran");
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            let bytes = std::fs::read(&file).unwrap();
            let _ = std::fs::remove_dir_all(&dir);
            bytes
        })
    }

    /// How many bytes `secs` seconds of the source are, to a whole packet.
    fn at(secs: f64) -> usize {
        (secs * (src().len() / TS) as f64 / SRC_SECS) as usize * TS
    }

    /// Wait for `cond`, or fail saying what it was.
    fn until(what: &str, secs: u64, mut cond: impl FnMut() -> bool) {
        let t = Instant::now();
        while !cond() {
            assert!(t.elapsed() < Duration::from_secs(secs), "timed out: {what}");
            std::thread::sleep(Duration::from_millis(40));
        }
    }

    // --- the fake provider ---

    /// Ends the connection itself when dropped, whoever else holds a handle.
    struct HangUpOnDrop(std::net::TcpStream);

    impl Drop for HangUpOnDrop {
        fn drop(&mut self) {
            let _ = self.0.shutdown(std::net::Shutdown::Both);
        }
    }

    struct Req {
        path: String,
    }

    enum Reply {
        /// 200 and these bytes with no length, then the connection closed
        /// cleanly. `break_it` claims more than is sent, so the close is an
        /// error to the reader. `pace` is the wait after each 16 KB.
        Stream {
            bytes: Vec<u8>,
            pace: Duration,
            break_it: bool,
        },
        File {
            kind: &'static str,
            bytes: Vec<u8>,
        },
        Status(u16),
        HangUp,
    }

    struct Fake {
        base: String,
        hits: Arc<Mutex<Vec<String>>>,
        agents: Arc<Mutex<Vec<String>>>,
    }

    impl Fake {
        fn hits(&self, path: &str) -> usize {
            lock(&self.hits)
                .iter()
                .filter(|p| p.as_str() == path)
                .count()
        }
    }

    fn serve(handler: impl Fn(&Req) -> Reply + Send + Sync + 'static) -> Fake {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(Vec::new()));
        let agents = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let (h, a) = (hits.clone(), agents.clone());
        std::thread::spawn(move || {
            for conn in l.incoming() {
                let Ok(mut conn) = conn else { continue };
                let (handler, hits, agents) = (handler.clone(), h.clone(), a.clone());
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(conn.try_clone().unwrap());
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        return;
                    }
                    let mut agent = String::new();
                    loop {
                        let mut header = String::new();
                        if reader.read_line(&mut header).unwrap_or(0) <= 2 {
                            break;
                        }
                        if header.to_ascii_lowercase().starts_with("user-agent:") {
                            agent = header["user-agent:".len()..].trim().to_string();
                        }
                    }
                    let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                    lock(&hits).push(path.clone());
                    lock(&agents).push(agent);
                    // Every reply ends in shutdown, not only a drop: on Windows
                    // an accepted socket is inheritable (std sets no-inherit on
                    // the ones it creates, not on accept's), so an ffmpeg a test
                    // spawns meanwhile can hold the connection open after the
                    // drop, and the recorder never hears the hang-up.
                    let reply = handler(&Req { path });
                    let _hang_up = HangUpOnDrop(conn.try_clone().unwrap());
                    match reply {
                        Reply::HangUp => {}
                        Reply::Status(code) => {
                            let _ = write!(
                                conn,
                                "HTTP/1.1 {code} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            );
                        }
                        Reply::File { kind, bytes } => {
                            let _ = write!(
                                conn,
                                "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                bytes.len()
                            );
                            let _ = conn.write_all(&bytes);
                        }
                        Reply::Stream {
                            bytes,
                            pace,
                            break_it,
                        } => {
                            let length = if break_it {
                                format!("Content-Length: {}\r\n", bytes.len() + 1_000_000)
                            } else {
                                String::new()
                            };
                            let _ = write!(
                                conn,
                                "HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\n{length}Connection: close\r\n\r\n"
                            );
                            for chunk in bytes.chunks(16 * 1024) {
                                if conn.write_all(chunk).is_err() {
                                    return;
                                }
                                std::thread::sleep(pace);
                            }
                        }
                    }
                });
            }
        });
        Fake { base, hits, agents }
    }

    fn stream(from: f64, to: f64) -> Reply {
        Reply::Stream {
            bytes: src()[at(from)..at(to)].to_vec(),
            pace: Duration::ZERO,
            break_it: false,
        }
    }

    // --- what a file is ---

    struct Check {
        ok: bool,
        secs: f64,
        log: String,
    }

    /// Whether ffmpeg decodes the file to the end, and the length of what it
    /// decoded. No ffprobe: it is not in every build.
    fn check(file: &Path) -> Check {
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-v", "info", "-i"])
            .arg(file)
            .args(["-f", "null", "-"])
            .output()
            .expect("ffmpeg ran");
        let log = String::from_utf8_lossy(&out.stderr).into_owned();
        let secs = log
            .rfind("time=")
            .map(|i| {
                let clock: String = log[i + 5..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit() || matches!(c, ':' | '.'))
                    .collect();
                clock
                    .split(':')
                    .try_fold(0.0, |acc, part| part.parse::<f64>().map(|p| acc * 60.0 + p))
                    .unwrap_or(0.0)
            })
            .unwrap_or(0.0);
        Check {
            ok: out.status.success(),
            secs,
            log,
        }
    }

    fn near(c: &Check, want: f64) {
        assert!(c.ok, "the file does not decode:\n{}", c.log);
        assert!(
            (c.secs - want).abs() <= 0.9,
            "{}s long, wanted about {want}s:\n{}",
            c.secs,
            c.log
        );
    }

    // --- a recorder to drive ---

    struct Bench {
        rt: Option<tokio::runtime::Runtime>,
        rec: Arc<Rec>,
        root: PathBuf,
        out: PathBuf,
        events: Arc<Mutex<Vec<Record>>>,
        /// Held for the test; dropped last.
        _lane: MutexGuard<'static, ()>,
    }

    impl Drop for Bench {
        fn drop(&mut self) {
            drop(self.rt.take());
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// One recorder test at a time. Each runs ffmpeg processes and waits on
    /// timers of tens of milliseconds, and alongside the rest of the crate's
    /// tests they starved a 4-core box enough to tip a race in mpvopen's
    /// (a fake that closes after a reply, and a client that reuses the
    /// connection): one full run in eight.
    static LANE: Mutex<()> = Mutex::new(());

    impl Bench {
        fn new(tag: &str, tweak: impl FnOnce(&mut Config)) -> Bench {
            let lane = lock(&LANE);
            let root = temp(tag);
            let events = Arc::new(Mutex::new(Vec::new()));
            let seen = events.clone();
            let mut cfg = Config::app(Arc::new(move |r| lock(&seen).push(r.clone())));
            cfg.window = Duration::from_secs(30);
            cfg.retry = vec![Duration::from_millis(100), Duration::from_millis(200)];
            cfg.steady = Duration::from_millis(300);
            cfg.tick = Duration::from_millis(100);
            cfg.settle = Duration::ZERO;
            cfg.read_idle = Duration::from_secs(5);
            cfg.free = Arc::new(|_| None);
            tweak(&mut cfg);
            Bench {
                rt: Some(
                    tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(2)
                        .enable_all()
                        .build()
                        .unwrap(),
                ),
                rec: Rec::open(root.join("recordings.json"), cfg),
                out: root.join("Videos"),
                root,
                events,
                _lane: lane,
            }
        }

        fn block<F: Future>(&self, f: F) -> F::Output {
            self.rt.as_ref().unwrap().block_on(f)
        }

        fn spec(&self, url: &str) -> Spec {
            Spec {
                url: url.into(),
                user_agent: Some("TestApp/1.0 (Provider Check)".into()),
                channel: "News: HD/1".into(),
                programme: Some("The Match".into()),
                playlist_id: "p1".into(),
                folder: self.out.clone(),
            }
        }

        fn start(&self, url: &str) -> String {
            self.block(self.rec.start(self.spec(url))).expect("started")
        }

        fn stop(&self, id: &str) -> Record {
            self.block(self.rec.stop(id)).expect("stopped")
        }

        fn status(&self, id: &str) -> Status {
            self.rec.get(id).unwrap().status
        }

        fn wait_over(&self, id: &str, secs: u64) -> Record {
            until("the recording to end", secs, || {
                self.status(id) != Status::Recording
            });
            self.rec.get(id).unwrap()
        }

        /// Wait until the file stops growing, as the end of a finite source.
        fn wait_still(&self, id: &str) {
            let path = PathBuf::from(self.rec.get(id).unwrap().path);
            let mut last = (0, Instant::now());
            let shown = self.rec.clone();
            let shown_id = id.to_string();
            until("the file to settle", 20, || {
                if std::env::var("REC_DEBUG").is_ok() {
                    eprintln!("{:?} size={:?}", shown.get(&shown_id), size_of(&path));
                }
                let now = size_of(&path).unwrap_or(0);
                if now != last.0 {
                    last = (now, Instant::now());
                }
                now > 0 && last.1.elapsed() > Duration::from_millis(800)
            });
        }
    }

    // --- names ---

    #[test]
    fn a_name_is_the_channel_the_minute_and_the_programme() {
        let when = [2026, 10, 27, 19, 5];
        assert_eq!(
            file_name("BBC One", Some("The Match"), when),
            "BBC One 2026-10-27 1905 - The Match.ts"
        );
        assert_eq!(
            file_name("BBC One", None, when),
            "BBC One 2026-10-27 1905.ts"
        );
        assert_eq!(
            file_name("BBC One", Some("  "), when),
            "BBC One 2026-10-27 1905.ts"
        );
    }

    #[test]
    fn a_name_has_nothing_windows_refuses() {
        let when = [2026, 1, 2, 3, 4];
        let n = file_name(
            "A<B>C:D\"E/F\\G|H?I*J\u{7}K",
            Some("Who: me? Live/Rerun."),
            when,
        );
        assert_eq!(
            n,
            "A B C D E F G H I J K 2026-01-02 0304 - Who me Live Rerun.ts"
        );
        for bad in ['<', '>', ':', '"', '/', '\\', '|', '?', '*'] {
            assert!(!n.contains(bad), "{bad} in {n}");
        }
        // Trailing dots and spaces are dropped, or Windows drops them for us.
        assert_eq!(clean_part("News... ", 50), "News");
        // A channel with nothing in it.
        assert_eq!(file_name("???", None, when), "Recording 2026-01-02 0304.ts");
        assert_eq!(file_name("", None, when), "Recording 2026-01-02 0304.ts");
        // The stamp is always there, so a device name is never the whole stem.
        assert_eq!(file_name("CON", None, when), "CON 2026-01-02 0304.ts");
    }

    #[test]
    fn a_long_name_is_cut_and_still_a_name() {
        let long = "x".repeat(400);
        let n = file_name(&long, Some(&long), [2026, 1, 2, 3, 4]);
        assert!(
            n.chars().count() <= CHANNEL_MAX + PROGRAMME_MAX + 3 + 15 + 1 + 3,
            "{}",
            n.len()
        );
        assert!(n.ends_with(".ts") && n.contains(" 2026-01-02 0304 - "));
        // Cut in characters, not bytes: no panic in the middle of one.
        let wide = "\u{30c6}".repeat(400);
        assert!(file_name(&wide, Some(&wide), [2026, 1, 2, 3, 4]).ends_with(".ts"));
    }

    #[test]
    fn the_clock_gives_a_real_date() {
        let [y, mo, d, h, mi] = local_now();
        assert!((2026..2100).contains(&y) && (1..=12).contains(&mo) && (1..=31).contains(&d));
        assert!(h < 24 && mi < 60);
    }

    #[test]
    fn a_name_in_use_gets_a_number_and_the_old_file_is_not_touched() {
        let dir = temp("names");
        let first = take_name(&dir, "News 2026-10-27 1905.ts").unwrap();
        std::fs::write(&first, b"first").unwrap();
        let second = take_name(&dir, "News 2026-10-27 1905.ts").unwrap();
        let third = take_name(&dir, "News 2026-10-27 1905.ts").unwrap();
        assert!(first.ends_with("News 2026-10-27 1905.ts"));
        assert!(second.ends_with("News 2026-10-27 1905 (2).ts"));
        assert!(third.ends_with("News 2026-10-27 1905 (3).ts"));
        assert_eq!(std::fs::read(&first).unwrap(), b"first");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_folder_picker_opens_on_the_nearest_folder_that_is_there() {
        let dir = temp("picker");
        let (videos, mine) = (dir.join("Videos"), dir.join("Videos").join("BlammyTV"));
        let chosen = dir.join("Chosen");
        std::fs::create_dir_all(&videos).unwrap();
        std::fs::create_dir_all(&chosen).unwrap();
        let said = |c: Option<&str>| picker_start(c, &mine);
        // Neither the default nor the folder above it, nor anything chosen.
        assert_eq!(picker_start(None, &dir.join("no").join("BlammyTV")), None);
        // The default is not made yet: its parent.
        assert_eq!(said(None), Some(videos.clone()));
        assert_eq!(said(Some("  ")), Some(videos.clone()));
        assert_eq!(
            said(Some(&dir.join("gone").to_string_lossy())),
            Some(videos)
        );
        // A folder the page has, and then the default once it is there.
        assert_eq!(said(Some(&chosen.to_string_lossy())), Some(chosen.clone()));
        std::fs::create_dir_all(&mine).unwrap();
        assert_eq!(said(None), Some(mine.clone()));
        // A file is not a folder to start in.
        let file = dir.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        assert_ne!(said(Some(&file.to_string_lossy())), Some(file));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_link_is_hls_when_it_says_m3u8_as_the_page_does() {
        for hls in [
            "http://h/a/index.m3u8",
            "http://h/a/index.M3U8",
            "http://h/a/index.m3u8?token=1",
            "https://h/live.m3u8?x=.ts",
        ] {
            assert!(is_hls(hls), "{hls}");
        }
        for ts in [
            "http://h/live/u/p/1.ts",
            "http://h/live/u/p/1",
            "http://h/a.m3u8x",
            "http://h/a.m3u8/segment.ts",
            "http://h/m3u8",
        ] {
            assert!(!is_hls(ts), "{ts}");
        }
    }

    // --- bytes ---

    #[test]
    fn what_ffmpeg_is_given_never_carries_a_link() {
        let w = writer_args("/v/News.ts").join(" ");
        assert!(!w.contains("http") && !w.contains("://"), "{w}");
        assert!(
            w.contains("-f mpegts -fflags +genpts+discardcorrupt"),
            "{w}"
        );
        assert!(w.contains("-dts_delta_threshold 1 -i pipe:0"), "{w}");
        assert!(w.contains("-map 0:v? -map 0:a? -map 0:s? -c copy"), "{w}");
        assert!(w.ends_with("-y /v/News.ts"), "{w}");
        // Only the proxy's loopback address, which holds no credentials.
        let r = reader_args("http://127.0.0.1:5000/mv/abc").join(" ");
        assert_eq!(r.matches("http").count(), 1, "{r}");
        assert!(r.contains("-i http://127.0.0.1:5000/mv/abc"), "{r}");
        assert!(
            r.contains("-allowed_extensions ALL -extension_picky 0"),
            "{r}"
        );
        assert!(r.ends_with("pipe:1"), "{r}");
    }

    // --- the index ---

    fn record(id: &str, status: Status, path: &Path) -> Record {
        Record {
            id: id.into(),
            channel: "News".into(),
            programme: None,
            playlist_id: "p1".into(),
            started_at: 1_000,
            ended_at: None,
            path: path.to_string_lossy().into_owned(),
            bytes: 0,
            status,
            reason: None,
            buffer: false,
        }
    }

    fn cfg_quiet() -> Config {
        Config::app(Arc::new(|_| {}))
    }

    fn write_index(path: &Path, records: Vec<Record>) {
        let json = serde_json::to_vec(&Index {
            version: 1,
            records,
        })
        .unwrap();
        std::fs::write(path, json).unwrap();
    }

    #[test]
    fn a_recording_the_app_died_in_is_partial_when_it_opens_again() {
        let dir = temp("died");
        let index = dir.join("recordings.json");
        let half = dir.join("half.ts");
        std::fs::write(&half, vec![0x47u8; 12_345]).unwrap();
        let mut rec = record("a", Status::Recording, &half);
        rec.bytes = 99;
        write_index(
            &index,
            vec![
                rec,
                record("b", Status::Recording, &dir.join("never-written.ts")),
                record("c", Status::Done, &half),
            ],
        );
        let r = Rec::open(index.clone(), cfg_quiet());
        let a = r.get("a").unwrap();
        // What the file holds, not what was last written down.
        assert_eq!((a.status, a.bytes), (Status::Partial, 12_345));
        assert_eq!(a.reason.as_deref(), Some(APP_CLOSED));
        assert!(a.ended_at.is_some());
        // Nothing was written: failed, not a partial of nothing.
        assert_eq!(r.get("b").unwrap().status, Status::Failed);
        assert_eq!(r.get("c").unwrap().status, Status::Done);
        // And it is written down: a second open finds the same.
        let again = Rec::open(index, cfg_quiet());
        assert_eq!(again.get("a").unwrap(), a);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_index_is_replaced_whole_and_a_stray_temp_file_does_no_harm() {
        let dir = temp("atomic");
        let index = dir.join("recordings.json");
        write_index(&index, vec![record("a", Status::Done, &dir.join("a.ts"))]);
        // A write that died half way left this behind.
        let tmp = dir.join("recordings.json.tmp");
        std::fs::write(&tmp, b"{\"records\":[{\"id\":\"half").unwrap();
        let r = Rec::open(index.clone(), cfg_quiet());
        assert_eq!(r.list().len(), 1, "the half-written file was read");
        // The next save goes through it and leaves nothing behind.
        r.change("a", true, |x| {
            x.channel = "Changed".into();
            true
        });
        assert!(!tmp.exists());
        let on_disk: Index = serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
        assert_eq!(on_disk.records[0].channel, "Changed");
        // Writers on many threads: whatever is last on disk reads whole and
        // is what memory holds.
        let writers: Vec<_> = (0..8)
            .map(|n| {
                let r = r.clone();
                std::thread::spawn(move || {
                    for k in 0..10 {
                        r.change("a", true, |x| {
                            x.bytes = n * 100 + k;
                            true
                        });
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let on_disk: Index = serde_json::from_slice(&std::fs::read(&index).unwrap()).unwrap();
        assert_eq!(on_disk.records, r.list());
        assert!(!tmp.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Every `recordings.json.bad-*` beside the index, by name.
    fn aside(dir: &Path) -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with("recordings.json.bad-"))
            })
            .collect();
        found.sort();
        found
    }

    #[test]
    fn an_index_that_cannot_be_parsed_or_read_is_kept_aside_and_never_overwritten() {
        let dir = temp("bad");
        let index = dir.join("recordings.json");
        // Not JSON, and then not text at all (a read error that is not
        // "not found": the old code took it for no index, and the next save
        // wrote over the person's recordings).
        for bad in [
            &b"{ not json"[..],
            &[0xff, 0xfe, 0x00, b'{', 0xc3, 0x28][..],
        ] {
            std::fs::write(&index, bad).unwrap();
            let r = Rec::open(index.clone(), cfg_quiet());
            assert!(r.list().is_empty());
            assert!(!index.exists(), "left in place to be written over");
            // The next save is the app's own, and the old one is still there.
            r.save();
            assert!(aside(&dir).iter().any(|p| std::fs::read(p).unwrap() == bad));
        }
        // A second bad index did not replace the first one kept.
        let kept = aside(&dir);
        assert_eq!(kept.len(), 2, "{kept:?}");
        let contents: Vec<Vec<u8>> = kept.iter().map(|p| std::fs::read(p).unwrap()).collect();
        assert!(contents.contains(&b"{ not json".to_vec()));
        assert!(contents.contains(&vec![0xff, 0xfe, 0x00, b'{', 0xc3, 0x28]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_bad_indexes_in_one_millisecond_still_get_two_names() {
        let dir = temp("bad-fast");
        let index = dir.join("recordings.json");
        for n in 0..5 {
            std::fs::write(&index, format!("{{ bad {n}")).unwrap();
            drop(load(&index));
        }
        assert_eq!(aside(&dir).len(), 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_index_at_all_is_no_recordings_and_nothing_is_set_aside() {
        let dir = temp("none");
        let (records, writable) = load(&dir.join("recordings.json"));
        assert!(records.is_empty() && writable);
        assert!(aside(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_page_gets_the_index_in_camel_case_with_a_lowercase_status() {
        let mut r = record("a", Status::Partial, Path::new("C:\\v\\a.ts"));
        r.reason = Some(DISK_FULL.into());
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["playlistId"], "p1");
        assert_eq!(json["startedAt"], 1000);
        assert_eq!(json["status"], "partial");
        assert_eq!(json["reason"], "disk full");
        assert!(json["programme"].is_null() && json["endedAt"].is_null());
        assert_eq!(json["buffer"], false);
        assert_eq!(json.as_object().unwrap().len(), 11);
        r.buffer = true;
        assert_eq!(serde_json::to_value(&r).unwrap()["buffer"], true);
    }

    #[test]
    fn an_index_from_before_the_buffer_flag_reads_as_not_a_buffer_recording() {
        let dir = temp("old-index");
        let index = dir.join("recordings.json");
        std::fs::write(
            &index,
            r#"{"version":1,"records":[{"id":"a","channel":"News","playlistId":"p1","startedAt":1000,"path":"C:\\v\\a.ts","bytes":5,"status":"done"}]}"#,
        )
        .unwrap();
        let (records, _) = load(&index);
        assert_eq!(records.len(), 1);
        assert!(!records[0].buffer);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_list_is_newest_first_and_delete_takes_the_file_and_the_entry() {
        let dir = temp("delete");
        let index = dir.join("recordings.json");
        let (old, new, other) = (
            dir.join("old.ts"),
            dir.join("new.ts"),
            dir.join("notes.txt"),
        );
        for f in [&old, &new, &other] {
            std::fs::write(f, b"x").unwrap();
        }
        let mut n = record("new", Status::Done, &new);
        n.started_at = 5_000;
        write_index(
            &index,
            vec![
                record("old", Status::Done, &old),
                n,
                record("odd", Status::Done, &other),
            ],
        );
        let r = Rec::open(index.clone(), cfg_quiet());
        assert_eq!(
            r.list().iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            ["new", "old", "odd"]
        );
        r.delete("old").unwrap();
        assert!(!old.exists() && r.get("old").is_none());
        // A path that is not a .ts is never deleted from an index entry.
        r.delete("odd").unwrap();
        assert!(other.exists() && r.get("odd").is_none());
        assert_eq!(r.delete("old"), Err("no such recording".into()));
        let again = Rec::open(index, cfg_quiet());
        assert_eq!(again.list().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_ts_file_that_is_there_is_played() {
        let dir = temp("play");
        let (ts, txt) = (dir.join("a.ts"), dir.join("a.txt"));
        std::fs::write(&ts, b"x").unwrap();
        std::fs::write(&txt, b"x").unwrap();
        let index = dir.join("recordings.json");
        write_index(
            &index,
            vec![
                record("ok", Status::Done, &ts),
                record("gone", Status::Done, &dir.join("gone.ts")),
                record("text", Status::Done, &txt),
                record("dir", Status::Done, &dir),
            ],
        );
        let r = Rec::open(index, cfg_quiet());
        assert_eq!(r.playable("ok"), Ok(ts));
        for no in ["gone", "text", "dir"] {
            assert_eq!(r.playable(no), Err("the file is gone".into()), "{no}");
        }
        // The page's id is the only way in: a path is not one.
        assert_eq!(
            r.playable(&txt.to_string_lossy()),
            Err("no such recording".into())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn the_drive_tells_its_free_space_with_or_without_a_trailing_backslash() {
        let dir = temp("free");
        let plain = free_bytes(&dir).expect("Windows would not say");
        let slashed = free_bytes(&dir.join("")).expect("Windows would not say");
        assert!(plain > 0 && slashed > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(not(windows))]
    #[test]
    fn off_windows_the_drive_says_nothing_and_a_recorder_goes_ahead() {
        assert_eq!(free_bytes(&std::env::temp_dir()), None);
    }

    #[test]
    fn the_first_reason_to_stop_is_the_one_that_stays() {
        let (tx, rx) = watch::channel(None);
        let tx: StopTx = Arc::new(tx);
        ask_stop(&tx, Why::DiskFull);
        ask_stop(&tx, Why::User);
        ask_stop(&tx, Why::ChannelChanged);
        assert_eq!(*rx.borrow(), Some(Why::DiskFull));
    }

    // --- keeping awake ---

    #[test]
    fn the_machine_is_held_awake_from_the_first_recording_to_the_last() {
        let a = Awake::new();
        let on = a.on.clone();
        let wait = |want: bool| until("the awake thread", 5, || on.load(Ordering::SeqCst) == want);
        a.hold();
        wait(true);
        a.hold();
        a.release();
        // One is still running.
        std::thread::sleep(Duration::from_millis(150));
        assert!(on.load(Ordering::SeqCst));
        a.release();
        wait(false);
        // A release with nothing held changes nothing, and it can be held again.
        a.release();
        a.hold();
        wait(true);
    }

    // --- recording ---

    #[test]
    fn it_records_a_stream_and_a_stop_leaves_a_whole_file() {
        let (fake, asked) = plan(vec![stream(0.0, 8.0)]);
        let b = Bench::new("clean", |_| {});
        let id = b.start(&format!("{}/live/u/p/1.ts", fake.base));
        let rec = b.rec.get(&id).unwrap();
        assert_eq!(rec.status, Status::Recording);
        assert!(
            rec.path.ends_with(".ts") && rec.path.contains("News HD 1 "),
            "{}",
            rec.path
        );
        assert!(rec.path.contains(" - The Match"), "{}", rec.path);
        // The source is all read once the recorder is asking for more.
        until("the stream to be read", 20, || {
            asked.load(Ordering::SeqCst) >= 2
        });
        b.wait_still(&id);
        let done = b.stop(&id);
        assert_eq!((done.status, done.reason.clone()), (Status::Done, None));
        assert!(done.ended_at.is_some() && done.bytes > 100_000, "{done:?}");
        assert_eq!(done.bytes, size_of(Path::new(&done.path)).unwrap());
        near(&check(Path::new(&done.path)), 8.0);
        // The page was told: it started, and it ended.
        let seen = lock(&b.events).clone();
        assert_eq!(seen.first().unwrap().status, Status::Recording);
        assert_eq!(seen.last().unwrap().status, Status::Done);
        // The provider was asked as the playlist says, and the index has it.
        assert_eq!(lock(&fake.agents)[0], "TestApp/1.0 (Provider Check)");
        let index = Rec::open(b.root.join("recordings.json"), cfg_quiet());
        assert_eq!(index.get(&id).unwrap().status, Status::Done);
    }

    /// A provider that serves `plan[n]` to its nth request, and hangs up after.
    fn plan(plan: Vec<Reply>) -> (Fake, Arc<AtomicUsize>) {
        let plan = Mutex::new(plan.into_iter().map(Some).collect::<Vec<_>>());
        let n = Arc::new(AtomicUsize::new(0));
        let seen = n.clone();
        let fake = serve(move |_| {
            let i = seen.fetch_add(1, Ordering::SeqCst);
            lock(&plan)
                .get_mut(i)
                .and_then(Option::take)
                .unwrap_or(Reply::HangUp)
        });
        (fake, n)
    }

    fn breaks(from: f64, to: f64, extra: usize) -> Reply {
        Reply::Stream {
            bytes: src()[at(from)..at(to) + extra].to_vec(),
            pace: Duration::ZERO,
            break_it: true,
        }
    }

    #[test]
    fn a_dropped_connection_is_joined_into_one_file_with_one_timeline() {
        // Three seconds, then the connection breaks in the middle of a packet.
        // The provider is back two seconds of stream later, also partway into
        // one, and serves three more.
        let (fake, asked) = plan(vec![
            breaks(0.0, 3.0, 77),
            Reply::Stream {
                bytes: src()[at(5.0) + 33..at(8.0)].to_vec(),
                pace: Duration::ZERO,
                break_it: false,
            },
        ]);
        let b = Bench::new("join", |_| {});
        let id = b.start(&format!("{}/live.ts", fake.base));
        until("the second connection to be read", 20, || {
            asked.load(Ordering::SeqCst) >= 3
        });
        b.wait_still(&id);
        let done = b.stop(&id);
        assert_eq!(done.status, Status::Done, "{done:?}");
        // 3s and 3s of stream make 6s of file. The two seconds between are not
        // a hole in it: ffmpeg's default threshold of 10s would leave one and
        // this would read 8s. Nothing is repeated either.
        near(&check(Path::new(&done.path)), 6.0);
        assert_eq!(std::fs::read_dir(&b.out).unwrap().count(), 1);
    }

    #[test]
    fn the_window_counts_from_the_last_bytes_and_not_from_the_first_drop() {
        // Down, back for longer than the window, down again, back. Counted
        // from the first drop, the second would find the window already spent.
        let (fake, asked) = plan(vec![
            breaks(0.0, 2.0, 0),
            Reply::Stream {
                bytes: src()[at(2.5)..at(4.5)].to_vec(),
                pace: Duration::from_millis(220),
                break_it: true,
            },
            Reply::Stream {
                bytes: src()[at(5.0)..at(12.0)].to_vec(),
                pace: Duration::from_millis(100),
                break_it: false,
            },
        ]);
        let b = Bench::new("window", |c| c.window = Duration::from_millis(900));
        let id = b.start(&format!("{}/live.ts", fake.base));
        let path = PathBuf::from(b.rec.get(&id).unwrap().path);
        until("the third connection to be flowing", 20, || {
            asked.load(Ordering::SeqCst) >= 3 && size_of(&path).unwrap_or(0) > 250_000
        });
        let done = b.stop(&id);
        assert_eq!(
            (done.status, done.reason.as_deref()),
            (Status::Done, None),
            "{done:?}"
        );
        // At least the 2s and 2s before the third, with the gaps closed.
        let c = check(&path);
        assert!(c.ok && c.secs > 4.3, "{}s\n{}", c.secs, c.log);
    }

    #[test]
    fn a_stream_that_does_not_come_back_ends_partial_when_the_window_is_up() {
        let (fake, _) = plan(vec![breaks(0.0, 4.0, 0)]);
        let b = Bench::new("lost", |c| c.window = Duration::from_millis(1200));
        let id = b.start(&format!("{}/live.ts", fake.base));
        let t = Instant::now();
        let over = b.wait_over(&id, 20);
        assert!(
            t.elapsed() >= Duration::from_millis(900),
            "{:?}",
            t.elapsed()
        );
        assert_eq!(
            (over.status, over.reason.as_deref()),
            (Status::Partial, Some(STREAM_LOST))
        );
        // What there was is kept and plays.
        assert!(over.bytes > 50_000, "{over:?}");
        near(&check(Path::new(&over.path)), 4.0);
        // And the machine is let go: nothing is running.
        assert!(lock(&b.rec.live).is_empty());
        // Stopping it now is not an error, and says how it ended.
        assert_eq!(b.stop(&id).status, Status::Partial);
    }

    #[test]
    fn a_fresh_link_from_the_page_is_used_for_the_next_reconnect() {
        // The first link dies with the connection (a Stalker link expires).
        // Only the second can be reached.
        let served = Arc::new(AtomicUsize::new(0));
        let n = served.clone();
        let fake = serve(
            move |r| match (r.path.as_str(), n.fetch_add(1, Ordering::SeqCst)) {
                ("/old.ts", 0) => breaks(0.0, 3.0, 0),
                ("/new.ts", 1) => stream(5.0, 8.0),
                _ => Reply::Status(404),
            },
        );
        let b = Bench::new("link", |c| {
            c.retry = vec![Duration::from_millis(700)];
            c.steady = Duration::from_millis(700);
        });
        let id = b.start(&format!("{}/old.ts", fake.base));
        b.rec
            .set_url(&id, &format!("{}/new.ts", fake.base))
            .unwrap();
        until("the new link to be asked", 20, || fake.hits("/new.ts") >= 1);
        b.wait_still(&id);
        let done = b.stop(&id);
        assert_eq!(done.status, Status::Done, "{done:?}");
        near(&check(Path::new(&done.path)), 6.0);
        assert_eq!(fake.hits("/old.ts"), 1, "the old link was asked for again");
        // Only a link that could be played, and only for a recording that runs.
        assert!(b.rec.set_url(&id, "http://127.0.0.1/x.ts").is_err());
        assert!(b.rec.set_url("nope", "http://127.0.0.1/x.ts").is_err());
    }

    #[test]
    fn a_folder_that_is_not_a_full_path_is_refused_before_anything_is_made() {
        let b = Bench::new("relative", |_| {});
        let fake = serve(|_| stream(0.0, 2.0));
        let mut spec = b.spec(&format!("{}/a.ts", fake.base));
        spec.folder = PathBuf::from("recordings-relative-test");
        let why = b.block(b.rec.start(spec)).unwrap_err();
        assert_eq!(why, "the recordings folder must be a full path");
        assert!(!Path::new("recordings-relative-test").exists());
        assert_eq!(
            fake.hits.lock().unwrap().len(),
            0,
            "the provider was asked anyway"
        );
        let (_, end) = told();
        let mut spec = buffer_spec(&b);
        spec.folder = PathBuf::from("recordings-relative-test");
        assert!(b.block(b.rec.buffer_start(spec, |_| Ok(()), end)).is_err());
        assert!(!Path::new("recordings-relative-test").exists());
    }

    #[test]
    fn a_link_the_player_would_refuse_is_refused() {
        let fake = serve(|_| stream(0.0, 2.0));
        let b = Bench::new("scheme", |_| {});
        for url in [
            "file:///C:/secret.ts",
            r"\\evil\share\x.ts",
            "ftp://h/x.ts",
            "",
        ] {
            assert!(b.block(b.rec.start(b.spec(url))).is_err(), "{url}");
        }
        assert!(b.rec.list().is_empty());
        let id = b.start(&format!("{}/a.ts", fake.base));
        assert!(b.rec.set_url(&id, "file:///C:/secret.ts").is_err());
        b.stop(&id);
    }

    #[test]
    fn a_start_that_cannot_connect_says_why_without_the_link_and_leaves_nothing() {
        let fake = serve(|r| match r.path.as_str() {
            p if p.starts_with("/live/user/hunter2/9.ts") => Reply::Status(403),
            _ => Reply::HangUp,
        });
        let b = Bench::new("refused", |_| {});
        let secret = format!("{}/live/user/hunter2/9.ts?token=abc123", fake.base);
        let why = b.block(b.rec.start(b.spec(&secret))).unwrap_err();
        assert!(
            why.contains("HTTP 403") && why.contains("127.0.0.1"),
            "{why}"
        );
        assert!(!why.contains("hunter2") && !why.contains("abc123"), "{why}");
        // A host nothing listens on.
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        let why = b
            .block(
                b.rec
                    .start(b.spec(&format!("http://{closed}/live/user/hunter2/9.ts"))),
            )
            .unwrap_err();
        assert!(
            why.contains("could not connect") && !why.contains("hunter2"),
            "{why}"
        );
        assert!(b.rec.list().is_empty());
        assert_eq!(
            std::fs::read_dir(&b.out).map(|d| d.count()).unwrap_or(0),
            0,
            "a file was left behind"
        );
        assert!(lock(&b.rec.live).is_empty());
    }

    #[test]
    fn a_stream_ffmpeg_cannot_read_ends_failed_with_ffmpegs_words() {
        // Bytes that never make a stream, served again for every ask: the
        // recorder is never without a connection, and ffmpeg never has a file.
        let fake = serve(|_| Reply::Stream {
            bytes: b"this is not a transport stream. ".repeat(100),
            pace: Duration::ZERO,
            break_it: false,
        });
        let b = Bench::new("junk", |c| c.first_output = Duration::from_millis(1500));
        let id = b.start(&format!("{}/x.ts", fake.base));
        let over = b.wait_over(&id, 20);
        assert_eq!(over.status, Status::Failed, "{over:?}");
        let why = over.reason.unwrap();
        assert!(
            !why.is_empty() && why != NOTHING && why != STREAM_LOST,
            "{why}"
        );
        // The folder's path is not in the words.
        assert!(
            !why.contains(&b.out.to_string_lossy().into_owned()),
            "{why}"
        );
    }

    #[test]
    fn a_drive_under_two_gigabytes_is_refused_and_one_under_one_stops_a_running_recording() {
        let free = Arc::new(AtomicU64::new(GIB + GIB / 2));
        let f = free.clone();
        let fake = serve(|_| Reply::Stream {
            bytes: src()[..at(10.0)].to_vec(),
            pace: Duration::from_millis(20),
            break_it: false,
        });
        let b = Bench::new("disk", move |c| {
            c.free = Arc::new(move |_| Some(f.load(Ordering::SeqCst)))
        });
        let why = b
            .block(b.rec.start(b.spec(&format!("{}/a.ts", fake.base))))
            .unwrap_err();
        assert!(why.contains("2 GB"), "{why}");
        assert!(b.rec.list().is_empty());
        assert_eq!(
            fake.hits.lock().unwrap().len(),
            0,
            "the provider was asked anyway"
        );
        // Plenty: it runs. Then the drive fills.
        free.store(50 * GIB, Ordering::SeqCst);
        let id = b.start(&format!("{}/a.ts", fake.base));
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(b.status(&id), Status::Recording);
        free.store(GIB / 2, Ordering::SeqCst);
        let over = b.wait_over(&id, 20);
        assert_eq!(
            (over.status, over.reason.as_deref()),
            (Status::Partial, Some(DISK_FULL))
        );
        assert!(over.bytes > 0);
        assert!(check(Path::new(&over.path)).ok);
    }

    #[test]
    fn a_running_recording_cannot_be_deleted_and_a_stopped_one_can() {
        let fake = serve(|_| Reply::Stream {
            bytes: src()[..at(10.0)].to_vec(),
            pace: Duration::from_millis(30),
            break_it: false,
        });
        let b = Bench::new("busy", |_| {});
        let id = b.start(&format!("{}/a.ts", fake.base));
        let path = PathBuf::from(b.rec.get(&id).unwrap().path);
        assert_eq!(b.rec.delete(&id), Err("stop the recording first".into()));
        assert!(path.exists() && b.rec.get(&id).is_some());
        b.stop(&id);
        b.rec.delete(&id).unwrap();
        assert!(!path.exists() && b.rec.get(&id).is_none());
    }

    #[test]
    fn the_page_hears_the_size_as_it_grows_and_the_machine_stays_awake_meanwhile() {
        let fake = serve(|_| Reply::Stream {
            bytes: src()[..at(12.0)].to_vec(),
            pace: Duration::from_millis(60),
            break_it: false,
        });
        let b = Bench::new("size", |_| {});
        let id = b.start(&format!("{}/a.ts", fake.base));
        until("the size to be told", 20, || {
            lock(&b.events)
                .iter()
                .any(|r| r.status == Status::Recording && r.bytes > 20_000)
        });
        assert!(
            b.rec.awake.on.load(Ordering::SeqCst) || {
                std::thread::sleep(Duration::from_millis(200));
                b.rec.awake.on.load(Ordering::SeqCst)
            }
        );
        b.stop(&id);
        until("the machine to be let go", 5, || {
            !b.rec.awake.on.load(Ordering::SeqCst)
        });
        let sizes: Vec<u64> = lock(&b.events).iter().map(|r| r.bytes).collect();
        assert!(sizes.windows(2).all(|w| w[0] <= w[1]), "{sizes:?}");
    }

    #[test]
    fn an_app_that_dies_mid_recording_leaves_a_file_that_plays() {
        let fake = serve(|_| Reply::Stream {
            bytes: src().clone(),
            pace: Duration::from_millis(40),
            break_it: false,
        });
        let b = Bench::new("killed", |_| {});
        let id = b.start(&format!("{}/a.ts", fake.base));
        let path = PathBuf::from(b.rec.get(&id).unwrap().path);
        until("the file to fill", 20, || {
            size_of(&path).unwrap_or(0) > 150_000
        });
        // The runtime goes, and every task with it: ffmpeg is killed where it
        // stands (kill_on_drop), without being asked to finish.
        let mut b = b;
        drop(b.rt.take());
        std::thread::sleep(Duration::from_millis(300));
        let c = check(&path);
        assert!(c.ok, "{}", c.log);
        assert!(c.secs > 1.0, "{}s\n{}", c.secs, c.log);
        // The index still says Recording; the next start of the app settles it.
        let reopened = Rec::open(b.root.join("recordings.json"), cfg_quiet());
        let r = reopened.get(&id).unwrap();
        assert_eq!(
            (r.status, r.reason.as_deref()),
            (Status::Partial, Some(APP_CLOSED))
        );
        assert!(r.bytes > 150_000);
    }

    #[test]
    fn closing_the_pipe_alone_is_enough_for_ffmpeg_to_finish_the_file() {
        // The app being killed outright does not kill ffmpeg; its end of the
        // pipe closes. This is that, with nothing of ours in between.
        let dir = temp("pipe");
        let file = dir.join("out.ts");
        let mut child = std::process::Command::new(ffmpeg())
            .args(writer_args(&file.to_string_lossy()))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(&src()[..at(6.0)]).unwrap();
        drop(stdin);
        assert!(child.wait().unwrap().success());
        near(&check(&file), 6.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- HLS ---

    /// A playlist and its segments, cut from the source by ffmpeg: 2s each,
    /// `index.m3u8` and `index0.ts` on.
    fn hls_files() -> HashMap<String, Vec<u8>> {
        let dir = temp("hls-src");
        let whole = dir.join("whole.ts");
        std::fs::write(&whole, &src()[..at(8.0)]).unwrap();
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&whole)
            .args([
                "-c",
                "copy",
                "-f",
                "hls",
                "-hls_time",
                "2",
                "-hls_list_size",
                "0",
            ])
            .arg(dir.join("index.m3u8"))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let files: HashMap<String, Vec<u8>> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| {
                (
                    e.file_name().to_string_lossy().into_owned(),
                    std::fs::read(e.path()).unwrap(),
                )
            })
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            files.contains_key("index.m3u8") && files.len() > 3,
            "{:?}",
            files.keys()
        );
        files
    }

    /// Serves `files` under the path the tests give out, the playlist as a
    /// playlist and the segments with no extension a player would trust.
    fn hls_provider(files: HashMap<String, Vec<u8>>) -> Fake {
        serve(move |r| {
            let name = r.path.strip_prefix("/hls/user/hunter2/").unwrap_or("");
            let name = name.split('?').next().unwrap_or("");
            match files.get(name) {
                Some(bytes) if name.ends_with(".m3u8") => Reply::File {
                    kind: "application/vnd.apple.mpegurl",
                    bytes: bytes.clone(),
                },
                // Not named .ts, as a provider's often are not.
                Some(bytes) => Reply::File {
                    kind: "video/mp2t",
                    bytes: bytes.clone(),
                },
                None => Reply::Status(404),
            }
        })
    }

    #[test]
    fn an_hls_stream_is_recorded_through_the_proxy_and_ffmpeg_never_sees_the_provider() {
        let fake = hls_provider(hls_files());
        // The reader is asked again after the playlist ends; not in this test.
        let b = Bench::new("hls", |c| c.retry = vec![Duration::from_secs(30)]);
        let id = b.start(&format!("{}/hls/user/hunter2/index.m3u8?t=1", fake.base));
        b.wait_still(&id);
        let done = b.stop(&id);
        assert_eq!(done.status, Status::Done, "{done:?}");
        near(&check(Path::new(&done.path)), 8.0);
        // The proxy went to the provider with the playlist's own agent.
        assert!(lock(&fake.agents)
            .iter()
            .all(|a| a == "TestApp/1.0 (Provider Check)"));
        assert!(fake.hits("/hls/user/hunter2/index.m3u8?t=1") >= 1);
    }

    #[test]
    fn an_hls_reader_that_goes_silent_is_reconnected_like_a_dropped_stream() {
        // A LIVE playlist (no end) that stops naming new segments: ffmpeg
        // stays alive, polling it, and says nothing. Its last four segments
        // are served; the reader starts at the newest, `index3.ts`, writes it,
        // and then there is nothing. Asked for again means the idle limit
        // sent it down the reconnect path.
        let mut files = hls_files();
        let playlist = String::from_utf8(files["index.m3u8"].clone()).unwrap();
        let live = playlist
            .replace("#EXT-X-ENDLIST\n", "")
            .replace("#EXTINF:0.040000,\nindex4.ts\n", "");
        assert!(
            live.contains("index3.ts") && !live.contains("index4.ts"),
            "{live}"
        );
        files.insert("index.m3u8".into(), live.into_bytes());
        let fake = hls_provider(files);
        let b = Bench::new("hls-silent", |c| c.read_idle = Duration::from_secs(1));
        let id = b.start(&format!("{}/hls/user/hunter2/index.m3u8", fake.base));
        until("the silent reader to be asked for again", 30, || {
            fake.hits("/hls/user/hunter2/index3.ts") >= 2
        });
        assert_eq!(b.status(&id), Status::Recording);
        let done = b.stop(&id);
        assert_eq!(done.status, Status::Done, "{done:?}");
        assert!(check(Path::new(&done.path)).ok);
    }

    // --- the player's buffer ---

    /// What mpv does for `dump-cache`: fills the file it was given, until told.
    fn player(path: &Path, bytes: usize) -> Result<(), String> {
        std::fs::write(path, vec![0x47u8; bytes]).map_err(|e| e.to_string())
    }

    fn buffer_spec(b: &Bench) -> BufferSpec {
        BufferSpec {
            channel: "News".into(),
            programme: None,
            playlist_id: "p1".into(),
            folder: b.out.clone(),
        }
    }

    fn told() -> (Arc<AtomicUsize>, Box<dyn Fn() + Send + Sync>) {
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        (
            n,
            Box::new(move || {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        )
    }

    #[test]
    fn a_buffer_recording_ends_partial_when_the_channel_changes_and_the_player_is_not_told() {
        let b = Bench::new("buf-change", |_| {});
        let (ended, end) = told();
        let id = b
            .block(
                b.rec
                    .buffer_start(buffer_spec(&b), |p| player(p, 5_000), end),
            )
            .unwrap();
        assert_eq!(b.status(&id), Status::Recording);
        // The page counts connections by this flag.
        assert!(b.rec.get(&id).unwrap().buffer);
        b.rec.player_changed();
        let over = b.wait_over(&id, 10);
        assert_eq!(
            (over.status, over.reason.as_deref()),
            (Status::Partial, Some(CHANNEL_CHANGED))
        );
        assert_eq!(over.bytes, 5_000);
        // It stopped itself: telling it again would stop the NEXT channel's dump.
        assert_eq!(ended.load(Ordering::SeqCst), 0);
        assert!(lock(&b.rec.live).is_empty());
    }

    #[test]
    fn a_stream_recording_does_not_end_when_the_channel_changes() {
        let fake = serve(|_| Reply::Stream {
            bytes: src()[..at(10.0)].to_vec(),
            pace: Duration::from_millis(30),
            break_it: false,
        });
        let b = Bench::new("stream-change", |_| {});
        let id = b.start(&format!("{}/a.ts", fake.base));
        assert!(!b.rec.get(&id).unwrap().buffer);
        b.rec.player_changed();
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(b.status(&id), Status::Recording);
        b.stop(&id);
    }

    #[test]
    fn a_second_buffer_recording_is_refused_while_one_runs() {
        let b = Bench::new("buf-two", |_| {});
        let (ended, end) = told();
        let first = b
            .block(
                b.rec
                    .buffer_start(buffer_spec(&b), |p| player(p, 4_000), end),
            )
            .unwrap();
        // The player has one dump: the second must not be told to start one.
        let started = Arc::new(AtomicUsize::new(0));
        let s = started.clone();
        let (_, end) = told();
        let why = b
            .block(b.rec.buffer_start(
                buffer_spec(&b),
                move |_| {
                    s.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
                end,
            ))
            .unwrap_err();
        assert_eq!(why, "the player's buffer is already being recorded");
        assert_eq!(started.load(Ordering::SeqCst), 0);
        assert_eq!(b.rec.list().len(), 1);
        assert_eq!(b.status(&first), Status::Recording);
        assert_eq!(ended.load(Ordering::SeqCst), 0);
        // A stream recording is not a dump, and once the first is over a new
        // one may start.
        assert_eq!(b.stop(&first).status, Status::Done);
        let (_, end) = told();
        let again = b
            .block(
                b.rec
                    .buffer_start(buffer_spec(&b), |p| player(p, 1_000), end),
            )
            .unwrap();
        assert_eq!(b.stop(&again).status, Status::Done);
    }

    #[test]
    fn a_buffer_recording_can_start_the_moment_the_last_one_shows_as_over() {
        let b = Bench::new("buf-race", |_| {});
        for _ in 0..40 {
            let (_, end) = told();
            let id = b
                .block(b.rec.buffer_start(buffer_spec(&b), |p| player(p, 100), end))
                .expect("a buffer recording was refused after the last one ended");
            b.rec.player_changed();
            // No sleeping: look the instant it changes.
            while b.status(&id) == Status::Recording {
                std::hint::spin_loop();
            }
        }
    }

    #[test]
    fn stopping_a_buffer_recording_tells_the_player_once_and_it_is_done() {
        let b = Bench::new("buf-stop", |_| {});
        let (ended, end) = told();
        let id = b
            .block(
                b.rec
                    .buffer_start(buffer_spec(&b), |p| player(p, 7_000), end),
            )
            .unwrap();
        let done = b.stop(&id);
        assert_eq!(
            (done.status, done.bytes, done.reason),
            (Status::Done, 7_000, None)
        );
        assert_eq!(ended.load(Ordering::SeqCst), 1);
        // A change after the stop finds nothing to end.
        b.rec.player_changed();
        assert_eq!(ended.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_buffer_recording_stops_for_a_full_disk_and_one_that_wrote_nothing_failed() {
        let free = Arc::new(AtomicU64::new(50 * GIB));
        let f = free.clone();
        let b = Bench::new("buf-disk", move |c| {
            c.free = Arc::new(move |_| Some(f.load(Ordering::SeqCst)))
        });
        let (ended, end) = told();
        let id = b
            .block(
                b.rec
                    .buffer_start(buffer_spec(&b), |p| player(p, 3_000), end),
            )
            .unwrap();
        free.store(GIB / 2, Ordering::SeqCst);
        let over = b.wait_over(&id, 10);
        assert_eq!(
            (over.status, over.reason.as_deref()),
            (Status::Partial, Some(DISK_FULL))
        );
        assert_eq!(ended.load(Ordering::SeqCst), 1);
        // Nothing written by the player: Failed, and it says so.
        free.store(50 * GIB, Ordering::SeqCst);
        let (_, end) = told();
        let id = b
            .block(b.rec.buffer_start(buffer_spec(&b), |_| Ok(()), end))
            .unwrap();
        let done = b.stop(&id);
        assert_eq!(
            (done.status, done.reason.as_deref()),
            (Status::Failed, Some(NOTHING))
        );
    }

    #[test]
    fn a_player_that_will_not_start_the_dump_leaves_nothing_behind() {
        let b = Bench::new("buf-fail", |_| {});
        let (_, end) = told();
        let why = b
            .block(b.rec.buffer_start(
                buffer_spec(&b),
                |_| Err("nothing is playing yet".into()),
                end,
            ))
            .unwrap_err();
        assert_eq!(why, "nothing is playing yet");
        assert!(b.rec.list().is_empty());
        assert_eq!(std::fs::read_dir(&b.out).unwrap().count(), 0);
    }
}
