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
//! AFTER IT ENDS (Phase 4). A recording keeps writing `.ts` while it runs,
//! because MPEG-TS survives a crash or a power cut. Once it is Done or Partial
//! with bytes, it is repackaged into `.mkv` (`-c copy`, video, audio and
//! subtitles; the data streams a `.ts` carries are left out), and, if the page
//! has turned on Smaller Files, re-encoded to HEVC after that. One job at a
//! time, in the order they came, on a thread of their own (`Jobs`). Both write
//! to a temp file beside the original and VERIFY it before anything is
//! replaced: it must decode to the end, and be as long as the original within
//! `LENGTH_SLACK`. Only then is it renamed into place, the index pointed at it,
//! and the old file deleted. A file that fails keeps the original and says why
//! (`Record::job_reason`). No ffprobe ships with the app, so lengths come from
//! ffmpeg's own header line and from the `-progress` it prints while decoding.
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

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::OpenOptions;
use std::future::Future;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

/// A programme is recorded from this long before it starts until this long
/// after it ends (plan 029, Phase 3), for a guide that runs late. The page
/// counts a line's connections by the programmes' own times, so padding never
/// clashes, and stops an earlier recording at its programme's end when the
/// next one's start comes due (recordings/schedule.ts, claim.ts).
pub const PAD_MS: u64 = 60_000;

/// How late a scan may find a scheduled start and still begin it. A start found
/// later than this was slept through, and a recording is never started late.
const LATE_MS: u64 = 30_000;

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
pub const MISSED: &str = "the app was not running at the start";
const RECORDER_STOPPED: &str = "the recorder stopped";

/// How far a repackaged or smaller file's length may be from the original's:
/// the larger of this and `LENGTH_PART` of the length. Streams in a `.ts`
/// start a fraction of a second apart, and ffmpeg's two ways of reading a
/// length (the header, the decode) differ by about that. A file that lost
/// content is off by far more.
const LENGTH_SLACK: f64 = 2.0;
const LENGTH_PART: f64 = 0.001;

/// What a job answers when a delete ended it, and a start from a schedule when
/// the record was cancelled first. Never shown.
const CANCELLED: &str = "cancelled";

/// Why a repackaging stopped before it began: a file is already where the
/// `.mkv` would go, and it is not ours to replace.
const NAME_TAKEN: &str = "an .mkv with that name is already there";

/// Why a shrink could not put its file in place. Windows refuses to replace
/// a file the player has open. Launch tries such a shrink again.
const IN_USE: &str = "couldn't replace the file, it may be playing";

/// The extension of a shrink that was written and checked but could not be
/// put in place. Launch keeps it and the next shrink of that file places it;
/// a `shrink.tmp` never checked out, so launch removes those.
const SHRINK_READY: &str = "shrink.ready";

// ---------------------------------------------------------------------------
// What the page sees.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Recording,
    Done,
    Partial,
    Failed,
    /// Waiting for its start (Phase 3). Has no file yet.
    Scheduled,
    /// Its start passed while the app was not running.
    Missed,
}

/// One recording, as the index keeps it and the page reads it. Times are Unix
/// milliseconds. `reason` says why it is Partial or Failed, and is null
/// otherwise. `buffer` is a recording of the player's own buffer, which opens
/// no connection of its own: the page counts a line's connections by it. An
/// index from before it existed has none, and reads as false.
///
/// After it ends (plan 029, Phase 4): `job` is the work it is waiting for or
/// having done, null when there is none, and the page treats any job as the app
/// being busy. `progress` is 0 to 1 while that job RUNS and null while it
/// waits. `job_reason` is why the last job failed and the original was kept,
/// null otherwise. `saved` is the bytes a shrink took off the file. An index
/// from before these existed has none, and reads as no job and 0.
///
/// Scheduled from the Guide (Phase 3): a Scheduled record is not yet a
/// recording. `started_at` is the programme's start, so a list sorts it by when
/// it happens, `channel_id` is the page's own id for the channel (the page finds
/// the link from it, so the index never holds one), `start_at` is when the
/// recorder starts (the programme's start less `PAD_MS`, or now) and `stop_at`
/// when it stops (the end plus `PAD_MS`). `due` is a start the page has been
/// told to make. A recording that was started from a schedule keeps its id
/// and its `stop_at`, which a running one carries even when it was started by
/// hand for a programme (`Spec::until`). An index from before has none, and a
/// record that has none of them sends none to the page.
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
    #[serde(default)]
    pub job: Option<Job>,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub job_reason: Option<String>,
    #[serde(default)]
    pub saved: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_at: Option<u64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub due: bool,
}

/// The work a finished recording is waiting for or having done. `Remux` is the
/// repackaging into `.mkv`, `Shrink` the re-encode to HEVC.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Job {
    Remux,
    Shrink,
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
    /// The id of the scheduled record this start answers (`start_scheduled`).
    pub id: Option<String>,
    /// The programme's end, Unix ms: the recording stops `PAD_MS` after it.
    pub until: Option<u64>,
}

/// What `schedule` is given: the programme's own times, Unix ms.
pub struct Plan {
    pub channel_id: String,
    pub channel: String,
    pub programme: Option<String>,
    pub playlist_id: String,
    pub start: u64,
    pub end: u64,
}

/// Whether `r` already records the programme `plan` names: the same channel
/// (a scheduled record by its channel id, a running one, which keeps none, by
/// its playlist and name) with times that meet the programme's. A running
/// record with no end covers only a programme that is on, so a later one is
/// still worth keeping. The page's `programmeAction` asks the same question.
fn covers(r: &Record, plan: &Plan, now: u64) -> bool {
    if r.status != Status::Scheduled && r.status != Status::Recording {
        return false;
    }
    let same = match &r.channel_id {
        Some(id) => *id == plan.channel_id,
        None => r.playlist_id == plan.playlist_id && r.channel == plan.channel,
    };
    let to = r.stop_at.map_or(u64::MAX, |s| s.saturating_sub(PAD_MS));
    same && r.started_at < plan.end && plan.start < to && (r.stop_at.is_some() || plan.start <= now)
}

/// What `buffer_start` is given.
pub struct BufferSpec {
    pub channel: String,
    pub programme: Option<String>,
    pub playlist_id: String,
    pub folder: PathBuf,
}

pub type Free = Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>;

/// Called with a file's path.
pub type OnFile = Arc<dyn Fn(&Path) + Send + Sync>;

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
    /// Whether a recording that ends is repackaged, and the last run's
    /// unfinished work taken up when the index opens. `init` turns it on; the
    /// tests of the recorder itself, which read a recording's own `.ts`, leave
    /// it off.
    pub repack: bool,
    /// Called with a repackaged file once ffmpeg has written it and before it
    /// is checked. A test damages the file here.
    pub after_write: Option<OnFile>,
    /// How often the schedule is looked at.
    pub sched_tick: Duration,
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
            repack: false,
            after_write: None,
            sched_tick: Duration::from_secs(1),
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
        // The `.mkv` this one becomes has that name too.
        if path.with_extension("mkv").exists() {
            continue;
        }
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
/// from an index entry: the `.ts` it records into, or the `.mkv` that replaces
/// it.
fn ours(path: &Path) -> bool {
    is_ext(path, "ts") || is_ext(path, "mkv")
}

fn is_ext(path: &Path, ext: &str) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// A scheduled recording whose start went by.
fn miss(r: &mut Record, now: u64) {
    r.status = Status::Missed;
    r.reason = Some(MISSED.into());
    r.ended_at = Some(now);
    r.due = false;
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
    /// When the schedule stops it (`sched_tick`), Unix ms.
    stop_at: Option<u64>,
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
    /// The repackaging and shrinking queue (Phase 4).
    jobs: Mutex<Jobs>,
    /// Whether the page wants recordings re-encoded smaller. None until it
    /// has said: a shrink left over from the last run waits for it.
    smaller: Mutex<Option<bool>>,
    /// The HEVC encoder this machine has, asked for once.
    encoder: OnceLock<&'static str>,
    /// Recordings between asking to start and being registered (`Starting`).
    starting: AtomicUsize,
    /// Scheduled records the page is starting right now (`start_scheduled`).
    claims: Mutex<HashSet<String>>,
}

/// Held by `start` and `buffer_start` from before a file is reserved until the
/// recording is registered (or failed), so a shrink does not begin in the
/// seconds a recording spends connecting. Lets the queue go when it drops.
struct Starting(Arc<Rec>);

impl Starting {
    fn new(rec: &Arc<Rec>) -> Starting {
        rec.starting.fetch_add(1, Ordering::SeqCst);
        Starting(rec.clone())
    }
}

impl Drop for Starting {
    fn drop(&mut self) {
        self.0.starting.fetch_sub(1, Ordering::SeqCst);
        self.0.kick();
    }
}

/// The queue, and the one job running.
#[derive(Default)]
struct Jobs {
    queue: VecDeque<(String, Job)>,
    current: Option<(String, Arc<Cancel>)>,
    /// A thread is working through the queue.
    worker: bool,
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
    /// in, and a Scheduled one whose start has passed is one the app was not
    /// running for: Missed, not started late.
    pub fn open(index: PathBuf, cfg: Config) -> Arc<Rec> {
        let (mut records, writable) = load(&index);
        let mut fixed = false;
        let now = now_ms();
        for r in records
            .iter_mut()
            .filter(|r| r.status == Status::Scheduled && !r.start_at.is_some_and(|s| s > now))
        {
            miss(r, now);
            fixed = true;
        }
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
            jobs: Mutex::new(Jobs::default()),
            smaller: Mutex::new(None),
            encoder: OnceLock::new(),
            starting: AtomicUsize::new(0),
            claims: Mutex::new(HashSet::new()),
        });
        if rec.cfg.repack {
            fixed |= rec.take_up_work();
        }
        if fixed {
            rec.save();
        }
        rec.kick();
        // The schedule's clock is native, so a minimised window or a busy page
        // changes nothing. It holds the recorder weakly and ends with it.
        let weak = Arc::downgrade(&rec);
        let every = rec.cfg.sched_tick;
        let _ = std::thread::Builder::new()
            .name("rec-schedule".into())
            .spawn(move || loop {
                std::thread::sleep(every);
                let Some(rec) = weak.upgrade() else { break };
                rec.sched_tick(now_ms());
            });
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
    /// Whether it was written.
    fn save(&self) -> bool {
        if !self.writable {
            return false;
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
        match wrote {
            Ok(()) => true,
            Err(e) => {
                log::warn!("[rec] could not save the index: {}", e.kind());
                false
            }
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
        // A share (\\server\share) is allowed on purpose: recording to a NAS
        // is a real use, and reaching this needs script in the page already.
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
            job: None,
            progress: None,
            job_reason: None,
            saved: 0,
            channel_id: None,
            start_at: None,
            stop_at: None,
            due: false,
        }
    }

    /// Add a record that is now running. The machine is held awake until
    /// `finish`.
    fn register(&self, record: &Record, live: Live) {
        lock(&self.live).insert(record.id.clone(), live);
        {
            // A recording started from a schedule takes the scheduled record's place.
            let mut records = lock(&self.records);
            records.retain(|r| r.id != record.id);
            records.push(record.clone());
        }
        self.awake.hold();
        self.save();
        (self.cfg.emit)(record);
    }

    /// A recording is over: its record says how, and everything waiting on it
    /// is let go.
    fn finish(
        self: &Arc<Self>,
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
        let ended = self.change(id, true, |r| {
            r.bytes = bytes.unwrap_or(r.bytes);
            r.status = or_failed(r.bytes, status);
            r.reason = if r.status == Status::Failed && reason.is_none() {
                Some(NOTHING.into())
            } else {
                reason
            };
            r.ended_at = Some(now_ms());
            // The same change that ends it names its next job, so the page
            // never sees it finished and idle for a moment in between.
            if self.cfg.repack && needs_remux(r) {
                r.job = Some(Job::Remux);
            }
            true
        });
        live.remove(id);
        drop(live);
        self.awake.release();
        let _ = done.send(true);
        if ended.is_some_and(|r| r.job == Some(Job::Remux)) {
            self.queue(id, Job::Remux);
        }
        // A shrink that waited for the recordings to end may go now.
        self.kick();
    }

    /// Record a stream. Returns once bytes are flowing, or with why not, and
    /// leaves nothing behind when it fails.
    pub async fn start(self: &Arc<Self>, spec: Spec) -> Result<String, String> {
        let _starting = Starting::new(self);
        mpvurl::http_only(&spec.url)?;
        let ffmpeg = match &self.cfg.ffmpeg {
            Some(p) => p.clone(),
            None => mvconvert::locate()?,
        };
        let (id, stop_at) = (spec.id, spec.until.map(|end| end.saturating_add(PAD_MS)));
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
        // Cancelled while it connected. Nothing awaits between here and
        // `register`, bar the microseconds a cancel could land in.
        if let Some(id) = &id {
            let waiting = lock(&self.records)
                .iter()
                .any(|r| &r.id == id && r.status == Status::Scheduled);
            if !waiting {
                let _ = std::fs::remove_file(&path);
                return Err(CANCELLED.into());
            }
        }
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

        let mut record =
            self.new_record(spec.channel, spec.programme, spec.playlist_id, &path, false);
        if let Some(id) = id {
            record.id = id;
        }
        record.stop_at = stop_at;
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
                stop_at,
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
        self: &Arc<Self>,
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
        let _starting = Starting::new(self);
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
                stop_at: None,
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

    /// Keep a programme to record (Phase 3). The record is Scheduled and in the
    /// index at once, so it outlives a restart. It starts `PAD_MS` before the
    /// programme, or now if that has passed, and the page is told when
    /// (`sched_tick`). Asked twice for the same programme, it answers the first.
    pub fn schedule(&self, plan: Plan) -> Result<Record, String> {
        let now = now_ms();
        if plan.end <= plan.start {
            return Err("that programme has no length".into());
        }
        if plan.end.saturating_add(PAD_MS) <= now {
            return Err("that programme is over".into());
        }
        let record = {
            let mut records = lock(&self.records);
            let same = records.iter().find(|r| {
                r.status == Status::Scheduled
                    && r.channel_id.as_deref() == Some(plan.channel_id.as_str())
                    && r.started_at == plan.start
            });
            if let Some(r) = same {
                return Ok(r.clone());
            }
            // A record of this channel whose times meet the programme's is
            // this programme again (its start moved, or native began it a
            // minute early and it is running): a second would record it twice.
            if records.iter().any(|r| covers(r, &plan, now)) {
                return Err("this channel is already being recorded then".into());
            }
            let mut record = self.new_record(
                plan.channel,
                plan.programme,
                plan.playlist_id,
                Path::new(""),
                false,
            );
            record.status = Status::Scheduled;
            record.started_at = plan.start;
            record.channel_id = Some(plan.channel_id);
            record.start_at = Some(plan.start.saturating_sub(PAD_MS).max(now));
            record.stop_at = Some(plan.end.saturating_add(PAD_MS));
            records.push(record.clone());
            record
        };
        // A schedule that cannot be kept would be lost at the next launch.
        if !self.save() {
            lock(&self.records).retain(|r| r.id != record.id);
            return Err("the schedule couldn't be saved".into());
        }
        (self.cfg.emit)(&record);
        Ok(record)
    }

    /// A scheduled record the page could not start (no link for its channel):
    /// Failed, with why. One that has since started or been cancelled is left.
    pub fn fail_scheduled(&self, id: &str, reason: &str) {
        self.change(id, true, |r| {
            let waiting = r.status == Status::Scheduled;
            if waiting {
                r.status = Status::Failed;
                r.reason = Some(reason.into());
                r.ended_at = Some(now_ms());
                r.due = false;
            }
            waiting
        });
    }

    /// `start`, for a scheduled record the page was told was due. The recording
    /// takes the record's id, so the list shows the one row change, and stops at
    /// the record's `stop_at`. A start that fails leaves the record Failed, with
    /// why.
    pub async fn start_scheduled(
        self: &Arc<Self>,
        id: &str,
        mut spec: Spec,
    ) -> Result<String, String> {
        let sched = self
            .get(id)
            .filter(|r| r.status == Status::Scheduled)
            .ok_or(CANCELLED)?;
        if !lock(&self.claims).insert(id.to_string()) {
            return Err("that recording is already starting".into());
        }
        struct Claim<'a>(&'a Rec, String);
        impl Drop for Claim<'_> {
            fn drop(&mut self) {
                lock(&self.0.claims).remove(&self.1);
            }
        }
        let _claim = Claim(self, id.to_string());
        spec.id = Some(id.to_string());
        spec.until = sched.stop_at.map(|stop| stop.saturating_sub(PAD_MS));
        let started = self.start(spec).await;
        if let Err(why) = &started {
            self.fail_scheduled(id, why);
        }
        started
    }

    /// Once a tick, with the time: stop the recordings that have run to their
    /// end, tell the page about the scheduled ones that are due, and mark the
    /// ones whose start went by Missed. The time is an argument so a test can
    /// run the clock.
    pub fn sched_tick(&self, now: u64) {
        for l in lock(&self.live).values() {
            if l.stop_at.is_some_and(|stop| now >= stop) {
                ask_stop(&l.stop, Why::User);
            }
        }
        let waiting: Vec<String> = lock(&self.records)
            .iter()
            .filter(|r| r.status == Status::Scheduled)
            .map(|r| r.id.clone())
            .collect();
        for id in waiting {
            self.change(&id, true, |r| {
                let start = r.start_at.unwrap_or(0);
                let over = now >= r.stop_at.unwrap_or(0);
                if r.status != Status::Scheduled || (!r.due && now < start) {
                    return false;
                }
                // Due, and waiting for the page: it has until the programme is over.
                if r.due && !over {
                    return false;
                }
                if !r.due && !over && now - start <= LATE_MS {
                    r.due = true;
                } else {
                    miss(r, now);
                }
                true
            });
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
        self.end_job(id)?;
        // A job that finished first may have moved the file: read it again.
        let rec = self.get(id).unwrap_or(rec);
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
            // The .ts a repackaging could not delete when it swapped this .mkv
            // in goes too, unless another entry names it. Not the other way
            // round: the .mkv beside a .ts entry may be somebody's own.
            if is_ext(&path, "mkv") {
                let _ = std::fs::remove_file(path.with_extension(SHRINK_READY));
                let ts = path.with_extension("ts");
                let named = lock(&self.records)
                    .iter()
                    .any(|r| r.id != id && Path::new(&r.path) == ts);
                if !named {
                    let _ = std::fs::remove_file(&ts);
                }
            }
        }
        let gone = {
            let mut records = lock(&self.records);
            let at = records.iter().position(|r| r.id == id);
            at.map(|i| records.remove(i))
        };
        // An entry whose removal cannot be saved would come back at the next
        // launch, a cancelled schedule with it, so it stays and the page is
        // told, as in `schedule`. A file already deleted is not put back: the
        // next try finds it gone and gets here again.
        if !self.save() {
            if let Some(r) = gone {
                lock(&self.records).push(r);
            }
            return Err("the list couldn't be saved".into());
        }
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
// After it ends: repackaged, then smaller.

/// How often a running job tells the page how far it is. ffmpeg prints more
/// often than anyone can read.
const PROGRESS_EVERY: Duration = Duration::from_millis(500);

/// How long a job's ffmpeg may be asked to stop before a delete gives up.
const END_WAIT: Duration = Duration::from_secs(15);

/// A finished recording still in its `.ts`, with something in it.
fn needs_remux(r: &Record) -> bool {
    matches!(r.status, Status::Done | Status::Partial)
        && r.bytes > 0
        && is_ext(Path::new(&r.path), "ts")
}

/// The ffmpeg a job runs, and the way to end it.
#[derive(Default)]
struct Cancel {
    asked: AtomicBool,
    child: Mutex<Option<std::process::Child>>,
}

impl Cancel {
    fn ask(&self) {
        self.asked.store(true, Ordering::SeqCst);
        if let Some(c) = lock(&self.child).as_mut() {
            let _ = c.kill();
        }
    }

    fn asked(&self) -> bool {
        self.asked.load(Ordering::SeqCst)
    }
}

/// What a job leaves: the file now, how big, what a shrink took off, and the
/// file it replaced (deleted once the index has the new one).
struct Made {
    path: PathBuf,
    bytes: u64,
    saved: u64,
    old: Option<PathBuf>,
}

/// An ffmpeg for a job: windowless, and at below-normal priority on Windows so
/// a shrink never competes with the player for the CPU.
fn ff(ffmpeg: &Path) -> std::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = std::process::Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
        cmd.creation_flags(0x0800_0000 | 0x0000_4000);
    }
    cmd
}

/// Puts a job's ffmpeg in a Windows job object that ends it when the app does.
/// Windows doesn't end a child with its parent, so a remux or shrink ffmpeg
/// would run on after BlammyTV was quit, holding the file. The job is made
/// once and its handle is never closed: the OS closes it as the process exits,
/// and KILL_ON_JOB_CLOSE ends whatever is in it. Not the recording writer: its
/// stdin closing is how it finishes its file (header). A job that can't be made
/// or joined leaves the ffmpeg as it was; the temp file is cleaned at launch.
#[cfg(windows)]
fn end_with_app(child: &std::process::Child) {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // The handle as an isize so a static can hold it; 0 = none.
    static JOB: OnceLock<isize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let Ok(job) = CreateJobObjectW(None, None) else {
            return 0;
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set.is_err() {
            let _ = CloseHandle(job);
            return 0;
        }
        job.0 as isize
    });
    let joined = job != 0
        && unsafe {
            AssignProcessToJobObject(HANDLE(job as *mut c_void), HANDLE(child.as_raw_handle()))
        }
        .is_ok();
    if !joined {
        log::warn!("[rec] ffmpeg is not tied to the app, it may outlive it");
    }
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// A clock, `01:02:03.45`, in seconds.
fn clock_secs(clock: &str) -> Option<f64> {
    clock.split(':').try_fold(0.0, |acc, part| {
        part.parse::<f64>().map(|p| acc * 60.0 + p).ok()
    })
}

/// A file's length from the line ffmpeg prints about it, `Duration: ...`. No
/// ffprobe ships with the app. For a `.ts` it is the span of its timestamps.
fn length_of(ffmpeg: &Path, file: &Path) -> Option<f64> {
    let out = ff(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let at = text.find("Duration: ")? + "Duration: ".len();
    let clock: String = text[at..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, ':' | '.'))
        .collect();
    clock_secs(&clock)
}

/// How a run of ffmpeg ended.
struct Ran {
    /// It exited with success.
    ok: bool,
    /// How far it got, in seconds of the file, from its `-progress`.
    secs: f64,
    /// Lines it printed at `-v error`, and the last of them.
    errors: usize,
    last: Option<String>,
}

/// Run ffmpeg to the end, telling `on_time` how far it is. Err only when it
/// did not start or was ended by `cancel`. `hide` is cut out of what it says
/// (a path has the user's name in it). Blocking: a job's thread runs it.
fn run(
    ffmpeg: &Path,
    cancel: &Cancel,
    args: &[String],
    hide: &[String],
    mut on_time: impl FnMut(f64),
) -> Result<Ran, String> {
    let mut child = ff(ffmpeg)
        .args([
            "-hide_banner",
            "-nostats",
            "-v",
            "error",
            "-progress",
            "pipe:1",
        ])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            log::warn!("[rec] ffmpeg did not start: {}", e.kind());
            "ffmpeg didn't start".to_string()
        })?;
    #[cfg(windows)]
    end_with_app(&child);
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        return Err("ffmpeg's pipes did not open".into());
    };
    *lock(&cancel.child) = Some(child);
    // Asked for before the child was there to be ended.
    if cancel.asked() {
        cancel.ask();
    }
    let hide = hide.to_vec();
    let said = std::thread::spawn(move || {
        let (mut errors, mut last) = (0, None);
        for raw in std::io::BufReader::new(stderr)
            .split(b'\n')
            .map_while(Result::ok)
        {
            let line = String::from_utf8_lossy(&raw);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            errors += 1;
            // Past ffmpeg's `[muxer @ 0x...]` tag, and without the path.
            let said = match line.strip_prefix('[').and_then(|l| l.split_once("] ")) {
                Some((_, rest)) => rest,
                None => line,
            };
            let said = hide
                .iter()
                .filter(|h| !h.is_empty())
                .fold(said.to_string(), |t, h| t.replace(h.as_str(), "[file]"));
            last = Some(said.chars().take(120).collect::<String>());
        }
        (errors, last)
    });
    let mut secs = 0.0;
    for raw in std::io::BufReader::new(stdout)
        .split(b'\n')
        .map_while(Result::ok)
    {
        let line = String::from_utf8_lossy(&raw);
        // `out_time_ms` is microseconds too (an old ffmpeg quirk).
        let us = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="))
            .and_then(|v| v.trim().parse::<f64>().ok());
        if let Some(us) = us.filter(|us| *us >= 0.0) {
            secs = us / 1e6;
            on_time(secs);
        }
    }
    // Taken out first: waiting with the lock held would make `ask` wait too.
    let child = lock(&cancel.child).take();
    let status = child.map(|mut c| c.wait());
    let (errors, last) = said.join().unwrap_or((0, None));
    if cancel.asked() {
        return Err(CANCELLED.into());
    }
    Ok(Ran {
        ok: matches!(status, Some(Ok(s)) if s.success()),
        secs,
        errors,
        last,
    })
}

/// A HEVC encoder's settings: constant quality, not a bit rate, so a still
/// picture costs little and a busy one what it needs. The GPU ones are tuned
/// to land near libx265 at CRF 26.
fn hevc_args(encoder: &str) -> &'static [&'static str] {
    match encoder {
        "hevc_nvenc" => &["-preset", "p5", "-rc", "vbr", "-cq", "28", "-b:v", "0"],
        "hevc_qsv" => &["-preset", "medium", "-global_quality", "28"],
        "hevc_amf" => &[
            "-quality", "quality", "-rc", "cqp", "-qp_i", "28", "-qp_p", "30",
        ],
        _ => &[
            "-preset",
            "fast",
            "-crf",
            "26",
            "-x265-params",
            "log-level=error",
        ],
    }
}

/// The shrink's deinterlacer, in front of every encoder. `deint=interlaced`
/// touches only frames flagged interlaced, so a progressive source passes
/// through unchanged; one frame out per frame in (`send_frame`), so the length
/// and the frame rate stay. A 1080i channel encoded without it keeps its combing
/// for good. Software, and the frames are software frames, so the GPU encoders
/// take them as they take any other. Options confirmed with `-h filter=bwdif`.
const DEINTERLACE: &str = "bwdif=mode=send_frame:parity=auto:deint=interlaced";

/// The GPU encoders to try, in order; libx265 is the CPU's and always there.
const HEVC_ENCODERS: [&str; 3] = ["hevc_nvenc", "hevc_qsv", "hevc_amf"];

/// The first of HEVC_ENCODERS that encodes a generated picture here with its
/// own settings (the way mvconvert asks for its H.264 one), else libx265.
fn pick_encoder(ffmpeg: &Path) -> &'static str {
    HEVC_ENCODERS
        .into_iter()
        .find(|e| encoder_works(ffmpeg, e))
        .unwrap_or("libx265")
}

fn encoder_works(ffmpeg: &Path, encoder: &str) -> bool {
    let spawned = ff(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
        .args(["color=black:s=256x256:r=30:d=0.2", "-vf"])
        .arg(format!("{DEINTERLACE},format=nv12"))
        .args(["-c:v", encoder])
        .args(hevc_args(encoder))
        .args(["-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = spawned else { return false };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() < Duration::from_secs(10) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

impl Rec {
    fn ffmpeg_path(&self) -> Result<PathBuf, String> {
        match &self.cfg.ffmpeg {
            Some(p) => Ok(p.clone()),
            None => mvconvert::locate(),
        }
    }

    /// The page's Smaller Files setting. Off drops the shrinks that have not
    /// started; one that has finishes. On lets a shrink left over from the
    /// last run go.
    pub fn set_smaller(self: &Arc<Self>, on: bool) {
        *lock(&self.smaller) = Some(on);
        if !on {
            // The queue and the rows in one pass under the queue's lock, so a
            // remux finishing as this flips cannot leave one without the other
            // (`run_job` queues a shrink under the same lock). A row that is
            // running has a progress; the rest are waiting.
            let cleared: Vec<Record> = {
                let mut j = lock(&self.jobs);
                j.queue.retain(|(_, job)| *job != Job::Shrink);
                let mut rows = lock(&self.records);
                rows.iter_mut()
                    .filter(|r| r.job == Some(Job::Shrink) && r.progress.is_none())
                    .map(|r| {
                        r.job = None;
                        r.clone()
                    })
                    .collect()
            };
            if !cleared.is_empty() {
                self.save();
                for r in &cleared {
                    (self.cfg.emit)(r);
                }
            }
        }
        self.kick();
    }

    /// When the index opens: the temp files a run that died left are removed
    /// (the originals were never touched; a checked shrink that only awaits
    /// its placing is not a temp file, see `SHRINK_READY`), and the jobs it
    /// did not finish are queued again, oldest first. A repackaging that
    /// already failed is not tried at every launch. Answers whether a record
    /// changed.
    fn take_up_work(&self) -> bool {
        let mut fixed = false;
        let mut again = Vec::new();
        let mut records = lock(&self.records);
        let kept: Vec<PathBuf> = records.iter().map(|r| PathBuf::from(&r.path)).collect();
        for r in records.iter_mut() {
            let path = PathBuf::from(&r.path);
            for ext in ["remux.tmp", "shrink.tmp"] {
                let _ = std::fs::remove_file(path.with_extension(ext));
            }
            // A repackaging that swapped the file in but could not delete the
            // .ts (Windows refuses while the player has it open): the entry
            // points at the .mkv, so the .ts beside it is nobody's. Left alone
            // if it is another entry's, or if it is refused again.
            if is_ext(&path, "mkv") && path.is_file() {
                let ts = path.with_extension("ts");
                if ts.is_file() && !kept.contains(&ts) {
                    let _ = std::fs::remove_file(&ts);
                }
            }
            let finished = matches!(r.status, Status::Done | Status::Partial);
            let want = if needs_remux(r) && r.job_reason.is_none() && path.is_file() {
                Some(Job::Remux)
            } else if finished
                && (r.job == Some(Job::Shrink) || r.job_reason.as_deref() == Some(IN_USE))
                && is_ext(&path, "mkv")
                && path.is_file()
            {
                Some(Job::Shrink)
            } else {
                None
            };
            // A checked shrink waits for its file's next shrink; for a file
            // that will not have one it is only taking up disk.
            if want != Some(Job::Shrink) {
                let _ = std::fs::remove_file(path.with_extension(SHRINK_READY));
            }
            if r.job != want || r.progress.is_some() {
                r.job = want;
                r.progress = None;
                fixed = true;
            }
            if let Some(job) = want {
                again.push((r.started_at, r.id.clone(), job));
            }
        }
        drop(records);
        again.sort_by_key(|a| a.0);
        lock(&self.jobs)
            .queue
            .extend(again.into_iter().map(|(_, id, job)| (id, job)));
        fixed
    }

    fn queue(&self, id: &str, job: Job) {
        lock(&self.jobs).queue.push_back((id.to_string(), job));
    }

    /// A remux can always go. A shrink goes when the page has asked for them
    /// and no recording runs or is starting (`Starting`), so it cannot fall
    /// behind a live stream.
    fn runnable(&self, job: Job) -> bool {
        job == Job::Remux
            || (*lock(&self.smaller) == Some(true)
                && self.starting.load(Ordering::SeqCst) == 0
                && lock(&self.live).is_empty())
    }

    /// Start the thread that works through the queue, if there is work it may
    /// do and none is running.
    fn kick(self: &Arc<Self>) {
        let mut j = lock(&self.jobs);
        if j.worker || !j.queue.iter().any(|(_, job)| self.runnable(*job)) {
            return;
        }
        j.worker = true;
        drop(j);
        let this = self.clone();
        let spawned = std::thread::Builder::new()
            .name("rec-jobs".into())
            .spawn(move || this.work());
        if spawned.is_err() {
            lock(&self.jobs).worker = false;
        }
    }

    /// One job at a time, the first in the queue that may run (a shrink
    /// waiting for a recording to end does not hold up the remuxes behind it).
    fn work(self: Arc<Self>) {
        struct Panicked<'a>(&'a Rec);
        impl Drop for Panicked<'_> {
            fn drop(&mut self) {
                if std::thread::panicking() {
                    let mut j = lock(&self.0.jobs);
                    j.worker = false;
                    j.current = None;
                }
            }
        }
        let _guard = Panicked(&self);
        loop {
            let (id, job, cancel) = {
                let mut j = lock(&self.jobs);
                let Some(at) = j.queue.iter().position(|(_, job)| self.runnable(*job)) else {
                    j.worker = false;
                    return;
                };
                let (id, job) = j.queue.remove(at).expect("it was just found");
                let cancel = Arc::new(Cancel::default());
                j.current = Some((id.clone(), cancel.clone()));
                // Running from here, as far as `set_smaller` can tell: it reads
                // the rows under this lock.
                self.change(&id, false, |r| {
                    r.job = Some(job);
                    r.progress = Some(0.0);
                    true
                });
                (id, job, cancel)
            };
            self.run_job(&id, job, &cancel);
            lock(&self.jobs).current = None;
        }
    }

    fn run_job(self: &Arc<Self>, id: &str, job: Job, cancel: &Cancel) {
        let Some(rec) = self.get(id) else { return };
        let mut last = Instant::now();
        let mut report = |frac: f64| {
            if last.elapsed() >= PROGRESS_EVERY {
                last = Instant::now();
                self.change(id, false, |r| {
                    r.progress = Some(frac.clamp(0.0, 1.0));
                    true
                });
            }
        };
        let made = self.ffmpeg_path().and_then(|ffmpeg| match job {
            Job::Remux => self.remux(&ffmpeg, &rec, cancel, &mut report),
            Job::Shrink => self.shrink(&ffmpeg, &rec, cancel, &mut report),
        });
        match made {
            Ok(made) => {
                // Under the queue's lock, so Smaller Files turned off in the
                // middle cannot leave a row naming a shrink that is in no queue,
                // or the reverse (`set_smaller`).
                let saved = {
                    let mut j = lock(&self.jobs);
                    // Unless Smaller Files is known to be off: a remux can finish
                    // before the page has said (a short one left from the last
                    // run), and its shrink waits for the page (`runnable`), which
                    // clears it if the answer is off (`set_smaller`).
                    let next = (job == Job::Remux && *lock(&self.smaller) != Some(false))
                        .then_some(Job::Shrink);
                    self.change(id, false, |r| {
                        r.path = path_str(&made.path);
                        r.bytes = made.bytes;
                        r.saved += made.saved;
                        r.progress = None;
                        r.job_reason = None;
                        r.job = next;
                        true
                    });
                    let saved = self.save();
                    if let Some(next) = next {
                        j.queue.push_back((id.to_string(), next));
                    }
                    saved
                };
                // The old file goes only once the index has the new one. If it
                // could not be written, both stay and the next launch tidies
                // (the sweep in `take_up_work`). Windows refuses while the
                // player has the old one open, and it stays the same way.
                match made.old {
                    Some(old) if saved => {
                        if let Err(e) = std::fs::remove_file(&old) {
                            log::warn!("[rec] {id}: could not delete the original: {}", e.kind());
                        }
                    }
                    Some(_) => {
                        log::warn!("[rec] {id}: the index was not saved, the original stays")
                    }
                    None => {}
                }
                log::info!("[rec] {id}: {job:?} done, {} bytes saved", made.saved);
            }
            // A delete ended it. It takes the record, but if that has not
            // happened (it gave up waiting), the row must not stay busy.
            Err(why) if why == CANCELLED => {
                self.change(id, true, |r| {
                    r.job = None;
                    r.progress = None;
                    true
                });
            }
            Err(why) => {
                log::warn!("[rec] {id}: {job:?} failed, the original is kept: {why}");
                self.change(id, true, |r| {
                    r.job = None;
                    r.progress = None;
                    r.job_reason = Some(why);
                    true
                });
            }
        }
    }

    /// `.ts` to `.mkv`, `-c copy`. The `.ts` is deleted by the caller, after
    /// the index has the new path.
    fn remux(
        &self,
        ffmpeg: &Path,
        rec: &Record,
        cancel: &Cancel,
        report: &mut dyn FnMut(f64),
    ) -> Result<Made, String> {
        let src = PathBuf::from(&rec.path);
        if !is_ext(&src, "ts") || !src.is_file() {
            return Err("the file is gone".into());
        }
        let (tmp, dst) = (src.with_extension("remux.tmp"), src.with_extension("mkv"));
        // An .mkv beside the .ts is somebody's (an old recording next to a file
        // made by hand): not overwritten, and not worth the work to find out.
        if dst.exists() {
            return Err(NAME_TAKEN.into());
        }
        let _ = std::fs::remove_file(&tmp);
        // Written, checked, and only then put in its place.
        let bytes = self
            .write_temp(ffmpeg, &src, &tmp, &[], 0.2, cancel, report)
            .and_then(|want| self.verify(ffmpeg, &src, &tmp, want, 0.2, cancel, report))
            .and_then(|()| self.place(&tmp, &dst, false, cancel));
        if bytes.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        Ok(Made {
            path: dst,
            bytes: bytes?,
            saved: 0,
            old: Some(src),
        })
    }

    /// An `.mkv` to a smaller one: the picture as HEVC, the rest copied. It
    /// has to be smaller, or it is not worth the replacing.
    fn shrink(
        &self,
        ffmpeg: &Path,
        rec: &Record,
        cancel: &Cancel,
        report: &mut dyn FnMut(f64),
    ) -> Result<Made, String> {
        let src = PathBuf::from(&rec.path);
        if !is_ext(&src, "mkv") || !src.is_file() {
            return Err("the file is gone".into());
        }
        let before = size_of(&src).unwrap_or(0);
        let tmp = src.with_extension("shrink.tmp");
        let ready = src.with_extension(SHRINK_READY);
        // A shrink an earlier pass finished and checked but could not put in
        // place (the player had the original open): placed now, with no second
        // encode. One that is no longer smaller than the file is dropped.
        if ready.is_file() && size_of(&ready).map_or(true, |a| a >= before) {
            let _ = std::fs::remove_file(&ready);
        }
        let after = if ready.is_file() {
            self.place(&ready, &src, true, cancel)
        } else {
            let encoder = *self.encoder.get_or_init(|| pick_encoder(ffmpeg));
            let _ = std::fs::remove_file(&tmp);
            let mut video = ["-vf", DEINTERLACE, "-c:v", encoder]
                .map(String::from)
                .to_vec();
            video.extend(hevc_args(encoder).iter().map(|a| a.to_string()));
            let placed = self
                .write_temp(ffmpeg, &src, &tmp, &video, 0.85, cancel, report)
                .and_then(|want| self.verify(ffmpeg, &src, &tmp, want, 0.85, cancel, report))
                .and_then(|()| {
                    let after = size_of(&tmp).unwrap_or(0);
                    if after >= before {
                        return Err("it didn't get any smaller".to_string());
                    }
                    self.place(&tmp, &src, true, cancel)
                });
            // Only the last step failed: the file is whole and checked, so it
            // is kept under a name launch does not clean up. Anything else
            // that went wrong, it never checked out and goes.
            if placed.as_ref().is_err_and(|why| why == IN_USE)
                && std::fs::rename(&tmp, &ready).is_ok()
            {
                log::info!("[rec] the smaller file is kept to place later");
            }
            placed
        };
        if after.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        let after = after?;
        Ok(Made {
            path: src,
            bytes: after,
            saved: before.saturating_sub(after),
            old: None,
        })
    }

    /// Write `tmp` from `src` (`video` after `-c copy` says how the picture is
    /// encoded; nothing copies it), taking `share` of the progress. Answers
    /// the length `src` has, which `verify` holds `tmp` to. `tmp` is NOT yet fit
    /// to replace anything.
    #[allow(clippy::too_many_arguments)]
    fn write_temp(
        &self,
        ffmpeg: &Path,
        src: &Path,
        tmp: &Path,
        video: &[String],
        share: f64,
        cancel: &Cancel,
        report: &mut dyn FnMut(f64),
    ) -> Result<f64, String> {
        let want = length_of(ffmpeg, src)
            .filter(|s| *s > 0.0)
            .ok_or("the length of the file can't be read")?;
        let size = size_of(src).unwrap_or(0);
        if src
            .parent()
            .is_some_and(|dir| (self.cfg.free)(dir).is_some_and(|f| f < size + self.cfg.min_run))
        {
            return Err("not enough free disk space".into());
        }
        let (from, to) = (path_str(src), path_str(tmp));
        let hide = [from.clone(), to.clone()];
        let mut args = vec!["-i".to_string(), from];
        // Video, audio and subtitles; the data streams a .ts carries (SCTE-35,
        // ID3) are left out, as a recording leaves them out.
        for map in ["0:v?", "0:a?", "0:s?"] {
            args.extend(["-map".to_string(), map.to_string()]);
        }
        args.extend(["-c".to_string(), "copy".to_string()]);
        args.extend(video.iter().cloned());
        args.extend(["-f", "matroska", "-y"].map(String::from));
        args.push(to);
        let ran = run(ffmpeg, cancel, &args, &hide, |secs| {
            report(share * secs / want)
        })?;
        if !ran.ok {
            return Err(format!(
                "ffmpeg couldn't write it: {}",
                ran.last.unwrap_or_else(|| "it stopped".into())
            ));
        }
        if let Some(damage) = &self.cfg.after_write {
            damage(tmp);
        }
        Ok(want)
    }

    /// The new file decodes to the end, and is as long as the original within
    /// `LENGTH_SLACK`. Errors in the decode are the original's own if the
    /// original has as many.
    #[allow(clippy::too_many_arguments)]
    fn verify(
        &self,
        ffmpeg: &Path,
        src: &Path,
        out: &Path,
        want: f64,
        from: f64,
        cancel: &Cancel,
        report: &mut dyn FnMut(f64),
    ) -> Result<(), String> {
        let decode = |file: &Path, on_time: &mut dyn FnMut(f64)| {
            let f = path_str(file);
            let args = ["-i", &f, "-f", "null", "-"].map(String::from);
            run(ffmpeg, cancel, &args, std::slice::from_ref(&f), on_time)
        };
        let ran = decode(out, &mut |secs| report(from + (1.0 - from) * secs / want))?;
        if !ran.ok {
            return Err(format!(
                "the new file doesn't play through: {}",
                ran.last.unwrap_or_else(|| "ffmpeg stopped".into())
            ));
        }
        let slack = LENGTH_SLACK.max(want * LENGTH_PART);
        if (ran.secs - want).abs() > slack {
            return Err(format!(
                "the new file is {:.0}s long and the original {want:.0}s",
                ran.secs
            ));
        }
        if ran.errors > 0 && ran.errors > decode(src, &mut |_| {})?.errors {
            return Err("the new file has errors the original doesn't".into());
        }
        Ok(())
    }

    /// The verified temp file becomes the file, unless a delete said no. With
    /// `replace` false, a file already at `to` is left alone (checked again
    /// here, after the work, in case one turned up meanwhile).
    fn place(&self, tmp: &Path, to: &Path, replace: bool, cancel: &Cancel) -> Result<u64, String> {
        if cancel.asked() {
            return Err(CANCELLED.into());
        }
        if !replace && to.exists() {
            return Err(NAME_TAKEN.into());
        }
        std::fs::rename(tmp, to).map_err(|e| {
            log::warn!("[rec] could not move the new file into place: {}", e.kind());
            IN_USE.to_string()
        })?;
        Ok(size_of(to).unwrap_or(0))
    }

    /// Before a recording is deleted: leave the queue, and if its job is
    /// running, end it and wait until it has let go of the files.
    fn end_job(&self, id: &str) -> Result<(), String> {
        let running = {
            let mut j = lock(&self.jobs);
            j.queue.retain(|(queued, _)| queued != id);
            j.current
                .as_ref()
                .filter(|(current, _)| current == id)
                .map(|(_, cancel)| cancel.clone())
        };
        let Some(cancel) = running else { return Ok(()) };
        cancel.ask();
        let started = Instant::now();
        while lock(&self.jobs)
            .current
            .as_ref()
            .is_some_and(|(current, _)| current == id)
        {
            if started.elapsed() > END_WAIT {
                return Err("the file is still being repackaged".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    }
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
    let cfg = Config {
        repack: true,
        ..Config::app(emit)
    };
    let _ = REC.set(Rec::open(index, cfg));
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
                id: None,
                until: None,
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
            job: None,
            progress: None,
            job_reason: None,
            saved: 0,
            channel_id: None,
            start_at: None,
            stop_at: None,
            due: false,
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
        assert_eq!(json.as_object().unwrap().len(), 15);
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

    // --- Phase 4: repackaged into .mkv, then smaller ---

    /// MPEG-2's CRC-32, which PAT and PMT sections end with and ffmpeg checks.
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc ^= u32::from(b) << 24;
            for _ in 0..8 {
                crc = if crc & 0x8000_0000 != 0 {
                    (crc << 1) ^ 0x04C1_1DB7
                } else {
                    crc << 1
                };
            }
        }
        crc
    }

    fn section(table_id: u8, body: &[u8]) -> Vec<u8> {
        let mut s = vec![table_id];
        s.extend((0xB000u16 | (body.len() as u16 + 4)).to_be_bytes());
        s.extend(body);
        let crc = crc32(&s);
        s.extend(crc.to_be_bytes());
        s
    }

    /// `payload` cut into 188-byte packets on `pid`, the last one padded with
    /// an adaptation field.
    fn ts_packets(pid: u16, payload: &[u8], cc: &mut u8) -> Vec<u8> {
        let mut out = Vec::new();
        for (i, chunk) in payload.chunks(184).enumerate() {
            let pad = 184 - chunk.len();
            let control = if pad > 0 { 0x30 } else { 0x10 };
            let start = if i == 0 { 0x40 } else { 0 };
            out.extend([0x47, start | (pid >> 8) as u8, pid as u8, control | *cc]);
            *cc = (*cc + 1) & 0x0F;
            match pad {
                0 => {}
                1 => out.push(0),
                _ => {
                    out.extend([(pad - 1) as u8, 0]);
                    out.extend(std::iter::repeat(0xFF).take(pad - 2));
                }
            }
            out.extend(chunk);
        }
        out
    }

    fn pes(pts: u64, data: &[u8]) -> Vec<u8> {
        let mut body = vec![0x80, 0x80, 5];
        body.extend([
            0x21 | ((pts >> 29) & 0x0E) as u8,
            ((pts >> 22) & 0xFF) as u8,
            0x01 | ((pts >> 14) & 0xFE) as u8,
            ((pts >> 7) & 0xFF) as u8,
            0x01 | ((pts << 1) & 0xFE) as u8,
        ]);
        body.extend(data);
        let mut p = vec![0, 0, 1, 0xBD];
        p.extend((body.len() as u16).to_be_bytes());
        p.extend(body);
        p
    }

    /// A transport stream with ONE subtitle stream and nothing else: two PES
    /// packets, at 2s and 6s. A DVB subtitle stream is an empty page (valid,
    /// and decodes to nothing); a teletext one is a stream mkv has no codec id
    /// for, whose payload ffmpeg never has to read to copy. ffmpeg has no way
    /// to make either from text, so they are built here.
    fn subtitle_ts(teletext: bool) -> Vec<u8> {
        const SUB: u16 = 0x200;
        const PMT: u16 = 0x1000;
        let mut pat_sec = vec![0, 1, 0xC1, 0, 0];
        pat_sec.extend([0, 1]);
        pat_sec.extend((0xE000u16 | PMT).to_be_bytes());
        let pat = section(0x00, &pat_sec);
        let descriptor: Vec<u8> = if teletext {
            [&[0x56, 5][..], b"eng", &[0x09, 0x00]].concat()
        } else {
            [&[0x59, 8][..], b"eng", &[0x10, 0, 1, 0, 1]].concat()
        };
        let mut pmt_sec = vec![0, 1, 0xC1, 0, 0];
        pmt_sec.extend((0xE000u16 | SUB).to_be_bytes());
        pmt_sec.extend(0xF000u16.to_be_bytes());
        pmt_sec.push(0x06);
        pmt_sec.extend((0xE000u16 | SUB).to_be_bytes());
        pmt_sec.extend((0xF000u16 | descriptor.len() as u16).to_be_bytes());
        pmt_sec.extend(&descriptor);
        let pmt = section(0x02, &pmt_sec);
        let page = |kind: u8, data: &[u8]| {
            let mut s = vec![0x0F, kind, 0, 1];
            s.extend((data.len() as u16).to_be_bytes());
            s.extend(data);
            s
        };
        let payload: Vec<u8> = if teletext {
            [&[0x10, 0x02, 44][..], &[0u8; 44]].concat()
        } else {
            // data_identifier, stream id, a page composition (mode change, no
            // regions), the end of the display set, and the end marker.
            [
                &[0x20, 0x00][..],
                &page(0x10, &[5, 2 << 2]),
                &page(0x80, &[]),
                &[0xFF],
            ]
            .concat()
        };
        let mut out = Vec::new();
        for (pid, sec) in [(0u16, &pat), (PMT, &pmt)] {
            let mut cc = 0;
            out.extend(ts_packets(pid, &[&[0u8][..], &sec[..]].concat(), &mut cc));
        }
        let mut cc = 0;
        for secs in [2u64, 6] {
            out.extend(ts_packets(SUB, &pes(secs * 90_000, &payload), &mut cc));
        }
        out
    }

    /// The 12 seconds of `src()` with a subtitle stream muxed in.
    fn with_subs(teletext: bool) -> &'static Vec<u8> {
        static DVB: OnceLock<Vec<u8>> = OnceLock::new();
        static TTX: OnceLock<Vec<u8>> = OnceLock::new();
        (if teletext { &TTX } else { &DVB }).get_or_init(|| {
            let dir = temp("subs");
            std::fs::write(dir.join("base.ts"), src()).unwrap();
            std::fs::write(dir.join("subs.ts"), subtitle_ts(teletext)).unwrap();
            let out = std::process::Command::new(ffmpeg())
                .args(["-hide_banner", "-loglevel", "error", "-y"])
                .arg("-i")
                .arg(dir.join("base.ts"))
                .arg("-i")
                .arg(dir.join("subs.ts"))
                .args(["-map", "0", "-map", "1", "-c", "copy", "-f", "mpegts"])
                .arg(dir.join("both.ts"))
                .output()
                .expect("ffmpeg ran");
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            let bytes = std::fs::read(dir.join("both.ts")).unwrap();
            let _ = std::fs::remove_dir_all(&dir);
            bytes
        })
    }

    /// What ffmpeg says about a file before it is asked to do anything: its
    /// streams.
    fn header(file: &Path) -> String {
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-i"])
            .arg(file)
            .output()
            .expect("ffmpeg ran");
        String::from_utf8_lossy(&out.stderr).into_owned()
    }

    fn mkv_of(ts: &Path, mkv: &Path) {
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(ts)
            .args(["-map", "0", "-c", "copy", "-f", "matroska"])
            .arg(mkv)
            .output()
            .expect("ffmpeg ran");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// The names in a folder, sorted.
    fn listing(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map(|d| {
                d.filter_map(Result::ok)
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    /// The app's page says Smaller Files at launch (off by default): the
    /// benches start as if it had said off. `unsaid` is the moment before.
    fn repacking(tag: &str) -> Bench {
        let b = unsaid(tag);
        *lock(&b.rec.smaller) = Some(false);
        b
    }

    fn unsaid(tag: &str) -> Bench {
        Bench::new(tag, |c| c.repack = true)
    }

    /// Record what `reply` serves, until the file stops growing, and stop it.
    fn ended(b: &Bench, reply: Reply) -> Record {
        let (fake, _) = plan(vec![reply]);
        let id = b.start(&format!("{}/live.ts", fake.base));
        b.wait_still(&id);
        b.stop(&id)
    }

    /// Wait for a recording's job to be over, or for the whole chain of them.
    fn wait_idle(b: &Bench, id: &str) -> Record {
        until("the job to finish", 90, || {
            b.rec.get(id).is_some_and(|r| r.job.is_none())
        });
        b.rec.get(id).unwrap()
    }

    /// A finished recording the index already has, with its job queued but not
    /// started (`set_smaller` or `kick` starts the worker).
    fn add_finished(b: &Bench, id: &str, started_at: u64, ext: &str) -> PathBuf {
        std::fs::create_dir_all(&b.out).unwrap();
        let ts = b.out.join(format!("{id}.ts"));
        std::fs::write(&ts, src()).unwrap();
        let path = if ext == "mkv" {
            let mkv = b.out.join(format!("{id}.mkv"));
            mkv_of(&ts, &mkv);
            std::fs::remove_file(&ts).unwrap();
            mkv
        } else {
            ts
        };
        let job = if ext == "mkv" {
            Job::Shrink
        } else {
            Job::Remux
        };
        let mut r = record(id, Status::Done, &path);
        r.started_at = started_at;
        r.bytes = size_of(&path).unwrap();
        r.job = Some(job);
        lock(&b.rec.records).push(r);
        b.rec.queue(id, job);
        path
    }

    #[test]
    fn a_recording_that_ends_is_repackaged_into_mkv_and_the_ts_goes() {
        let b = repacking("remux");
        let done = ended(&b, stream(0.0, 12.0));
        // Busy from the moment it ends: the change that says Done names the job.
        assert_eq!((done.status, done.job), (Status::Done, Some(Job::Remux)));
        let ts = PathBuf::from(&done.path);
        let r = wait_idle(&b, &done.id);
        let mkv = PathBuf::from(&r.path);
        assert!(r.path.ends_with(".mkv"), "{r:?}");
        assert_eq!(
            (r.job_reason.as_deref(), r.progress, r.saved),
            (None, None, 0)
        );
        assert_eq!(r.status, Status::Done);
        near(&check(&mkv), SRC_SECS);
        assert_eq!(r.bytes, size_of(&mkv).unwrap());
        // Only the .mkv is left: no .ts, no temp file.
        assert!(!ts.exists());
        assert_eq!(
            listing(&b.out),
            [mkv.file_name().unwrap().to_string_lossy()]
        );
        assert_eq!(b.rec.playable(&r.id), Ok(mkv));
        // The page was told: running with a progress, then done with the path.
        let seen = lock(&b.events).clone();
        assert!(seen
            .iter()
            .any(|e| e.id == r.id && e.job == Some(Job::Remux) && e.progress.is_some()));
        assert_eq!(seen.last().map(|e| e.path.clone()), Some(r.path.clone()));
    }

    #[test]
    fn a_recording_joined_after_a_dropped_connection_is_repackaged_with_its_timeline() {
        // As the join test: 3s, a break in a packet, 3s more two seconds on.
        let (fake, asked) = plan(vec![
            breaks(0.0, 3.0, 77),
            Reply::Stream {
                bytes: src()[at(5.0) + 33..at(8.0)].to_vec(),
                pace: Duration::ZERO,
                break_it: false,
            },
        ]);
        let b = repacking("remux-join");
        let id = b.start(&format!("{}/live.ts", fake.base));
        until("the second connection to be read", 20, || {
            asked.load(Ordering::SeqCst) >= 3
        });
        b.wait_still(&id);
        b.stop(&id);
        let r = wait_idle(&b, &id);
        assert!(r.path.ends_with(".mkv"), "{r:?}");
        near(&check(Path::new(&r.path)), 6.0);
        assert_eq!(listing(&b.out).len(), 1);
    }

    #[test]
    fn a_subtitle_stream_comes_along_into_the_mkv() {
        let b = repacking("remux-subs");
        let done = ended(
            &b,
            Reply::Stream {
                bytes: with_subs(false).clone(),
                pace: Duration::ZERO,
                break_it: false,
            },
        );
        let r = wait_idle(&b, &done.id);
        assert!(r.path.ends_with(".mkv"), "{r:?}");
        let h = header(Path::new(&r.path));
        for want in ["Video: mpeg2video", "Audio: mp2", "Subtitle: dvb_subtitle"] {
            assert!(h.contains(want), "no {want} in:\n{h}");
        }
        near(&check(Path::new(&r.path)), SRC_SECS);
    }

    #[test]
    fn a_stream_mkv_will_not_hold_keeps_the_ts_and_says_why() {
        let b = repacking("remux-refused");
        let done = ended(
            &b,
            Reply::Stream {
                bytes: with_subs(true).clone(),
                pace: Duration::ZERO,
                break_it: false,
            },
        );
        let ts = PathBuf::from(&done.path);
        let r = wait_idle(&b, &done.id);
        // Still the .ts, whole, in the index and on disk; nothing else beside it.
        assert_eq!(r.path, done.path);
        assert_eq!((r.status, r.job, r.progress), (Status::Done, None, None));
        assert_eq!(r.bytes, done.bytes);
        assert_eq!(size_of(&ts), Some(done.bytes));
        assert_eq!(listing(&b.out), [ts.file_name().unwrap().to_string_lossy()]);
        let why = r.job_reason.expect("it says why");
        assert!(why.starts_with("ffmpeg couldn't write it"), "{why}");
        // The path has the user's name in it.
        assert!(
            !why.contains(&b.out.to_string_lossy().into_owned()),
            "{why}"
        );
        assert_eq!(b.rec.playable(&r.id), Ok(ts));
    }

    #[test]
    fn a_file_that_does_not_check_out_never_replaces_the_ts() {
        // Half the new file is gone by the time it is checked. Whatever the
        // check says about it, the .mkv must not have been put in place first.
        let b = Bench::new("remux-bad", |c| {
            c.repack = true;
            c.after_write = Some(Arc::new(|tmp| {
                let f = OpenOptions::new().write(true).open(tmp).unwrap();
                f.set_len(f.metadata().unwrap().len() / 2).unwrap();
            }));
        });
        let done = ended(&b, stream(0.0, 12.0));
        let ts = PathBuf::from(&done.path);
        let r = wait_idle(&b, &done.id);
        assert_eq!(r.path, done.path);
        assert_eq!(size_of(&ts), Some(done.bytes));
        let why = r.job_reason.expect("it says why");
        assert!(why.starts_with("the new file"), "{why}");
        assert_eq!(listing(&b.out), [ts.file_name().unwrap().to_string_lossy()]);
    }

    #[test]
    fn jobs_run_one_at_a_time_in_order_and_a_remux_comes_before_its_shrink() {
        let b = repacking("queue");
        for (id, at) in [("a", 1_000), ("b", 2_000), ("c", 3_000)] {
            add_finished(&b, id, at, "ts");
        }
        // Turning Smaller Files on starts the worker with all three queued.
        b.rec.set_smaller(true);
        for id in ["a", "b", "c"] {
            wait_idle(&b, id);
        }
        let seen = lock(&b.events).clone();
        // What started, in order: an event that is a job's first, at 0.
        let mut started: Vec<(String, Job)> = Vec::new();
        let mut running: Option<String> = None;
        for e in &seen {
            if e.progress.is_some() {
                assert!(
                    running.as_ref().is_none_or(|r| *r == e.id),
                    "{running:?} and {} at once",
                    e.id
                );
                running = Some(e.id.clone());
                let this = (e.id.clone(), e.job.unwrap());
                if started.last() != Some(&this) {
                    started.push(this);
                }
            } else if running.as_deref() == Some(e.id.as_str()) {
                running = None;
            }
        }
        let want: Vec<(String, Job)> = [
            ("a", Job::Remux),
            ("b", Job::Remux),
            ("c", Job::Remux),
            ("a", Job::Shrink),
            ("b", Job::Shrink),
            ("c", Job::Shrink),
        ]
        .map(|(id, j)| (id.to_string(), j))
        .to_vec();
        assert_eq!(started, want);
        for id in ["a", "b", "c"] {
            let r = b.rec.get(id).unwrap();
            assert!(r.path.ends_with(".mkv") && r.saved > 0, "{r:?}");
            assert!(header(Path::new(&r.path)).contains("Video: hevc"));
        }
    }

    #[test]
    fn smaller_files_re_encodes_after_the_remux_and_records_what_it_saved() {
        let b = repacking("shrink");
        b.rec.set_smaller(true);
        let done = ended(&b, stream(0.0, 12.0));
        let r = wait_idle(&b, &done.id);
        let mkv = PathBuf::from(&r.path);
        assert!(r.path.ends_with(".mkv"), "{r:?}");
        assert_eq!(r.job_reason, None);
        // HEVC for the picture, the audio as it was, the same length.
        let h = header(&mkv);
        assert!(h.contains("Video: hevc"), "{h}");
        assert!(h.contains("Audio: mp2"), "{h}");
        near(&check(&mkv), SRC_SECS);
        assert!(
            r.bytes < done.bytes,
            "{} is not under {}",
            r.bytes,
            done.bytes
        );
        assert_eq!(r.bytes, size_of(&mkv).unwrap());
        // It saved what the remux made less what the shrink did.
        assert!(r.saved > 0 && r.saved < done.bytes, "{r:?}");
        assert_eq!(listing(&b.out).len(), 1);
        // And it did go through the .mkv first.
        let seen = lock(&b.events).clone();
        assert!(seen
            .iter()
            .any(|e| e.job == Some(Job::Shrink) && e.path.ends_with(".mkv")));
    }

    #[test]
    fn a_remux_that_ends_before_the_page_says_still_gets_its_shrink() {
        let b = unsaid("shrink-before-page");
        // The page hasn't said yet: the remux runs, and its shrink waits.
        let done = ended(&b, stream(0.0, 12.0));
        until("the remux, with its shrink waiting", 60, || {
            b.rec
                .get(&done.id)
                .is_some_and(|r| r.job == Some(Job::Shrink) && r.progress.is_none() && r.path.ends_with(".mkv"))
        });
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(b.rec.get(&done.id).unwrap().progress, None, "a shrink ran before the page said");
        // On: it shrinks.
        b.rec.set_smaller(true);
        let r = wait_idle(&b, &done.id);
        assert!(header(&PathBuf::from(&r.path)).contains("Video: hevc"), "{r:?}");
    }

    #[test]
    fn a_remux_that_ends_before_the_page_says_off_is_left_as_it_is() {
        let b = unsaid("shrink-before-page-off");
        let done = ended(&b, stream(0.0, 12.0));
        until("the remux, with its shrink waiting", 60, || {
            b.rec.get(&done.id).is_some_and(|r| r.job == Some(Job::Shrink) && r.path.ends_with(".mkv"))
        });
        b.rec.set_smaller(false);
        let r = b.rec.get(&done.id).unwrap();
        assert_eq!(r.job, None);
        assert!(!header(&PathBuf::from(&r.path)).contains("Video: hevc"), "{r:?}");
    }

    #[test]
    fn a_shrink_waits_for_a_recording_to_end() {
        let b = repacking("shrink-waits");
        // A recording that stays live for a few seconds.
        let (fake, _) = plan(vec![Reply::Stream {
            bytes: src()[..at(12.0)].to_vec(),
            pace: Duration::from_millis(120),
            break_it: false,
        }]);
        let live = b.start(&format!("{}/live.ts", fake.base));
        let path = add_finished(&b, "m", 1_000, "mkv");
        let before = size_of(&path).unwrap();
        b.rec.set_smaller(true);
        std::thread::sleep(Duration::from_millis(800));
        let m = b.rec.get("m").unwrap();
        assert_eq!(
            (m.job, m.progress, m.bytes),
            (Some(Job::Shrink), None, before)
        );
        assert_eq!(size_of(&path), Some(before));
        // It goes once the recording is over.
        b.stop(&live);
        let m = wait_idle(&b, "m");
        assert!(m.bytes < before && m.saved > 0, "{m:?}");
        wait_idle(&b, &live);
    }

    #[test]
    fn work_the_last_run_left_is_picked_up_and_its_temp_files_go() {
        let _lane = lock(&LANE);
        let dir = temp("sweep");
        let index = dir.join("recordings.json");
        let junk = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, b"half a file").unwrap();
            p
        };
        let ts = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, src()).unwrap();
            p
        };
        let done = |id: &str, path: &Path| {
            let mut r = record(id, Status::Done, path);
            r.bytes = size_of(path).unwrap_or(0);
            r
        };
        // a: a remux that never finished.
        let a = done("a", &ts("a.ts"));
        let a_tmp = junk("a.remux.tmp");
        // b: a shrink that was running, on a .mkv that is whole.
        let b_mkv = dir.join("b.mkv");
        mkv_of(&ts("b.ts"), &b_mkv);
        std::fs::remove_file(dir.join("b.ts")).unwrap();
        let mut b = done("b", &b_mkv);
        b.job = Some(Job::Shrink);
        b.progress = Some(0.5);
        let b_tmp = junk("b.shrink.tmp");
        let b_before = std::fs::read(&b_mkv).unwrap();
        // e: a remux that already failed, and is not tried again at every launch.
        let mut e = done("e", &ts("e.ts"));
        e.job_reason = Some("ffmpeg couldn't write it".into());
        let e_tmp = junk("e.remux.tmp");
        // f: says it is working on a file that is gone.
        let mut f = done("f", &dir.join("f.ts"));
        f.bytes = 5;
        f.job = Some(Job::Remux);
        f.progress = Some(0.4);
        // g: a failed recording is nobody's to repackage.
        let g = record("g", Status::Failed, &ts("g.ts"));
        write_index(&index, vec![a, b, e, f, g]);

        let mut cfg = cfg_quiet();
        cfg.repack = true;
        let r = Rec::open(index.clone(), cfg);

        // Temp files gone, the originals as they were.
        assert!(!a_tmp.exists() && !b_tmp.exists() && !e_tmp.exists());
        assert_eq!(std::fs::read(&b_mkv).unwrap(), b_before);
        // b waits for the page to say Smaller Files is still on.
        let b = r.get("b").unwrap();
        assert_eq!((b.job, b.progress), (Some(Job::Shrink), None));
        // e and g stay as they are. f has no work.
        let e = r.get("e").unwrap();
        assert_eq!(
            (e.job, e.job_reason.as_deref()),
            (None, Some("ffmpeg couldn't write it"))
        );
        assert!(dir.join("e.ts").exists() && dir.join("g.ts").exists());
        let f = r.get("f").unwrap();
        assert_eq!((f.job, f.progress), (None, None));
        assert_eq!(r.get("g").unwrap().job, None);
        // a is repackaged by itself, and its shrink waits for the page too.
        // The .ts goes after the index has the .mkv (the save first, so a
        // failed save loses nothing), so wait for that too: Windows' CI read
        // the gap between the two once (1.0.32).
        until("a to be repackaged", 90, || {
            r.get("a")
                .is_some_and(|a| a.path.ends_with("a.mkv") && a.job == Some(Job::Shrink) && a.progress.is_none())
                && !dir.join("a.ts").exists()
        });
        let a = r.get("a").unwrap();
        assert!(
            a.path.ends_with("a.mkv") && !dir.join("a.ts").exists(),
            "{a:?}"
        );
        near(&check(Path::new(&a.path)), SRC_SECS);
        assert!(!dir.join("a.remux.tmp").exists());
        // The page says it, and b goes again from the start.
        r.set_smaller(true);
        until("b to be shrunk", 90, || {
            r.get("b").is_some_and(|b| b.job.is_none())
        });
        let b = r.get("b").unwrap();
        assert!(b.saved > 0 && b.bytes < b_before.len() as u64, "{b:?}");
        // What it did is in the index, for the next launch.
        // (Written just after the page is told, so wait for it.)
        until("the index to say so", 10, || {
            let (saved, _) = load(&index);
            saved.iter().any(|x| x.id == "b" && x.job.is_none())
        });
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn turning_smaller_files_off_drops_the_shrinks_that_have_not_started() {
        let b = repacking("shrink-off");
        add_finished(&b, "m", 1_000, "mkv");
        add_finished(&b, "t", 2_000, "ts");
        b.rec.set_smaller(false);
        // The shrink is dropped and its row says so; the remux is not.
        assert_eq!(b.rec.get("m").unwrap().job, None);
        wait_idle(&b, "t");
        let t = b.rec.get("t").unwrap();
        assert!(t.path.ends_with(".mkv") && t.saved == 0, "{t:?}");
        assert!(header(Path::new(&t.path)).contains("Video: mpeg2video"));
    }

    #[test]
    fn deleting_a_recording_ends_its_job_and_leaves_nothing() {
        let hold = Arc::new(AtomicBool::new(true));
        let held = hold.clone();
        let b = Bench::new("delete-job", move |c| {
            c.repack = true;
            // The job stops here, after the file is written and before it is checked.
            c.after_write = Some(Arc::new(move |_| {
                while held.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }));
        });
        let done = ended(&b, stream(0.0, 12.0));
        until("the job to run", 30, || {
            b.rec.get(&done.id).unwrap().progress.is_some()
        });
        let (rec, id) = (b.rec.clone(), done.id.clone());
        let deleting = std::thread::spawn(move || rec.delete(&id));
        std::thread::sleep(Duration::from_millis(300));
        hold.store(false, Ordering::SeqCst);
        assert_eq!(deleting.join().unwrap(), Ok(()));
        assert!(b.rec.get(&done.id).is_none());
        assert_eq!(listing(&b.out), Vec::<String>::new());
    }

    #[test]
    fn an_mkv_is_played_and_deleted_like_a_ts_and_nothing_else_is() {
        let dir = temp("mkv-ours");
        let (mkv, txt) = (dir.join("a.mkv"), dir.join("a.txt"));
        std::fs::write(&mkv, b"x").unwrap();
        std::fs::write(&txt, b"x").unwrap();
        let index = dir.join("recordings.json");
        write_index(
            &index,
            vec![
                record("mkv", Status::Done, &mkv),
                record("txt", Status::Done, &txt),
            ],
        );
        let r = Rec::open(index, cfg_quiet());
        assert_eq!(r.playable("mkv"), Ok(mkv.clone()));
        assert_eq!(r.playable("txt"), Err("the file is gone".into()));
        r.delete("txt").unwrap();
        assert!(txt.exists());
        r.delete("mkv").unwrap();
        assert!(!mkv.exists() && r.get("mkv").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_recording_does_not_take_the_name_of_an_mkv() {
        let dir = temp("mkv-names");
        std::fs::write(dir.join("News 2026-10-27 1905.mkv"), b"first").unwrap();
        let next = take_name(&dir, "News 2026-10-27 1905.ts").unwrap();
        assert!(next.ends_with("News 2026-10-27 1905 (2).ts"), "{next:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_index_from_before_phase_4_loads_and_the_new_fields_reach_the_page() {
        let dir = temp("old-index-4");
        let index = dir.join("recordings.json");
        std::fs::write(
            &index,
            r#"{"version":1,"records":[{"id":"a","channel":"News","playlistId":"p1","startedAt":1000,"path":"C:\\v\\a.ts","bytes":5,"status":"done","buffer":false}]}"#,
        )
        .unwrap();
        let (records, ok) = load(&index);
        assert!(ok && records.len() == 1);
        let r = &records[0];
        assert_eq!(
            (r.job, r.progress, r.job_reason.as_deref(), r.saved),
            (None, None, None, 0)
        );
        let mut r = r.clone();
        r.job = Some(Job::Shrink);
        r.progress = Some(0.25);
        r.job_reason = Some("it didn't get any smaller".into());
        r.saved = 7;
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["job"], "shrink");
        assert_eq!(json["progress"], 0.25);
        assert_eq!(json["jobReason"], "it didn't get any smaller");
        assert_eq!(json["saved"], 7);
        r.job = Some(Job::Remux);
        assert_eq!(serde_json::to_value(&r).unwrap()["job"], "remux");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- the shrink deinterlaces; the sweep of an orphaned .ts ---

    const W: usize = 320;
    const H: usize = 240;

    /// Six seconds of a white bar crossing a black picture, 8 pixels a field
    /// (every row of it moves), as an MPEG-2 `.mkv`. Interlaced is 50 fields a second woven into 25 frames, top
    /// field first and FLAGGED so (`interlaced_frames` proves it); progressive
    /// is 25 whole frames.
    fn motion_mkv(file: &Path, interlaced: bool) {
        let (rate, vf, flags) = if interlaced {
            (
                "50",
                "tinterlace=mode=interleave_top,fieldorder=tff,format=yuv420p",
                "+ildct+ilme",
            )
        } else {
            ("25", "format=yuv420p", "0")
        };
        // A whole picture also gets fine horizontal lines, which a filter that
        // rebuilt its rows from their neighbours would smear.
        let grid = if interlaced {
            ""
        } else {
            ",drawgrid=width=0:height=4:thickness=1:color=gray"
        };
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"])
            .arg("-i")
            .arg(format!(
                "color=c=black:s={W}x{H}:r={rate}[bg];color=c=white:s=24x{H}:r={rate}[bar];\
                 [bg][bar]overlay=x=mod(n*8\\,296):y=0{grid}"
            ))
            .args(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"])
            .args(["-t", "6", "-vf", vf, "-flags", flags])
            .args(["-c:v", "mpeg2video", "-b:v", "3000k", "-g", "25"])
            .args(["-c:a", "mp2", "-b:a", "96k", "-f", "matroska"])
            .arg(file)
            .output()
            .expect("ffmpeg ran");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// (frames flagged interlaced, frames flagged progressive), from ffmpeg's
    /// `showinfo`.
    fn interlaced_frames(file: &Path) -> (usize, usize) {
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-v", "info", "-i"])
            .arg(file)
            .args(["-vf", "showinfo", "-f", "null", "-"])
            .output()
            .expect("ffmpeg ran");
        let log = String::from_utf8_lossy(&out.stderr);
        let count = |flag: &str| log.matches(flag).count();
        (count(" i:T") + count(" i:B"), count(" i:P"))
    }

    /// Every decoded frame as grey.
    fn grey_frames(file: &Path) -> Vec<Vec<u8>> {
        let out = std::process::Command::new(ffmpeg())
            .args(["-hide_banner", "-v", "error", "-i"])
            .arg(file)
            .args(["-vf", "format=gray", "-f", "rawvideo", "-"])
            .output()
            .expect("ffmpeg ran");
        assert!(out.status.success());
        out.stdout.chunks_exact(W * H).map(<[u8]>::to_vec).collect()
    }

    /// How combed the frames are: the mean difference between a row and the
    /// one beside it, which belongs to the other field. The bar's edge is
    /// vertical, so a whole picture has none and a woven one has a tooth in
    /// every row.
    fn combing(frames: &[Vec<u8>]) -> f64 {
        let mut near = 0u64;
        for f in frames {
            for y in 0..H - 1 {
                for x in 0..W {
                    near += i32::from(f[y * W + x]).abs_diff(i32::from(f[(y + 1) * W + x])) as u64;
                }
            }
        }
        near as f64 / (frames.len().max(1) * W * H) as f64
    }

    /// The mean difference between two runs of frames, pixel by pixel.
    fn mean_diff(a: &[Vec<u8>], b: &[Vec<u8>]) -> f64 {
        let total: u64 = a
            .iter()
            .zip(b)
            .flat_map(|(x, y)| x.iter().zip(y))
            .map(|(p, q)| u64::from(p.abs_diff(*q)))
            .sum();
        total as f64 / (a.len().max(1) * W * H) as f64
    }

    /// Register a finished `.mkv` already on disk with a shrink queued.
    fn add_mkv(b: &Bench, id: &str, mkv: &Path) {
        let mut r = record(id, Status::Done, mkv);
        r.bytes = size_of(mkv).unwrap();
        r.job = Some(Job::Shrink);
        lock(&b.rec.records).push(r);
        b.rec.queue(id, Job::Shrink);
    }

    /// Shrink `fixture`, answering what came out.
    fn shrunk(tag: &str, interlaced: bool) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        let b = repacking(tag);
        std::fs::create_dir_all(&b.out).unwrap();
        let mkv = b.out.join("m.mkv");
        motion_mkv(&mkv, interlaced);
        let before = grey_frames(&mkv);
        add_mkv(&b, "m", &mkv);
        b.rec.set_smaller(true);
        let r = wait_idle(&b, "m");
        assert_eq!(r.job_reason, None, "{r:?}");
        assert!(r.saved > 0, "{r:?}");
        assert!(header(&mkv).contains("Video: hevc"));
        near(&check(&mkv), 6.0);
        (before, grey_frames(&mkv))
    }

    #[test]
    fn the_fixtures_are_what_they_say_they_are() {
        let dir = temp("fixtures");
        let (il, pr) = (dir.join("il.mkv"), dir.join("pr.mkv"));
        motion_mkv(&il, true);
        motion_mkv(&pr, false);
        // Every frame of one is flagged interlaced, none of the other.
        assert_eq!(interlaced_frames(&il), (150, 0));
        assert_eq!(interlaced_frames(&pr), (0, 150));
        // And the woven one really is combed.
        // (A whole picture has none of the bar's; its fine lines are its own.)
        let c_il = combing(&grey_frames(&il));
        assert!(c_il > 10.0, "woven combing is only {c_il}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_shrink_deinterlaces_what_is_flagged_interlaced() {
        let (before, after) = shrunk("shrink-il", true);
        // One frame out for each in, so the length stands.
        assert_eq!(after.len(), before.len());
        // The combing the weave put in is gone, not encoded.
        let (was, is) = (combing(&before), combing(&after));
        assert!(is < was / 2.0, "combing {was} before, {is} after");
    }

    #[test]
    fn a_shrink_leaves_a_progressive_source_alone() {
        let (before, after) = shrunk("shrink-pr", false);
        // The same number of frames and the same length (`shrunk` checks it).
        // Not the same pixels, it is re-encoded: the filter's part is that it
        // drops and adds nothing.
        assert_eq!(after.len(), before.len());
        // And the picture is the same one, frame for frame, to what an encode
        // costs it. A filter that took the frames for woven ones and
        // interpolated them would move the bar.
        let drift = mean_diff(&before, &after);
        assert!(drift < 1.0, "the frames drifted by {drift} a pixel");
    }

    #[test]
    fn a_ts_left_beside_the_mkv_that_replaced_it_is_deleted_at_launch() {
        let dir = temp("orphan");
        let index = dir.join("recordings.json");
        let file = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, b"x").unwrap();
            p
        };
        let done = |id: &str, path: &Path| {
            let mut r = record(id, Status::Done, path);
            r.bytes = 1;
            r
        };
        // a: swapped to a.mkv, and the delete of a.ts was refused.
        let (a_mkv, a_ts) = (file("a.mkv"), file("a.ts"));
        // b: a .ts with nothing beside it. c: a .ts whose entry is on the .ts,
        // with an .mkv file next to it that no entry points at.
        let b_ts = file("b.ts");
        let (c_mkv, c_ts) = (file("c.mkv"), file("c.ts"));
        // d: the .mkv entry is there but its file is not: the .ts is all there is.
        let d_ts = file("d.ts");
        // e: two entries, one on e.ts and one on e.mkv. Both are somebody's.
        let (e_mkv, e_ts) = (file("e.mkv"), file("e.ts"));
        write_index(
            &index,
            vec![
                done("a", &a_mkv),
                done("b", &b_ts),
                done("c-ts", &c_ts),
                done("d", &dir.join("d.mkv")),
                done("e-mkv", &e_mkv),
                done("e-ts", &e_ts),
            ],
        );
        let mut cfg = cfg_quiet();
        cfg.repack = true;
        // Nothing can run: no ffmpeg that works, so the jobs this opens fail
        // without touching a file.
        cfg.ffmpeg = Some(dir.join("no-ffmpeg"));
        let r = Rec::open(index, cfg);
        assert!(a_mkv.exists() && !a_ts.exists(), "a.ts should be gone");
        assert!(b_ts.exists(), "a .ts with no .mkv entry is never touched");
        // c.mkv is on disk but no entry points at it.
        assert!(c_mkv.exists() && c_ts.exists());
        assert!(d_ts.exists());
        assert!(e_mkv.exists() && e_ts.exists(), "another entry's .ts stays");
        assert!(r.get("a").is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- review fixes: what a job may not touch, and what it leaves behind ---

    /// Wait until the job thread has gone idle: everything a job does after it
    /// tells the page (deleting the old file) is done.
    fn wait_worker(b: &Bench) {
        until("the job thread to go idle", 30, || {
            !lock(&b.rec.jobs).worker
        });
    }

    #[test]
    fn a_remux_never_overwrites_an_mkv_it_did_not_make() {
        let b = repacking("remux-taken");
        let ts = add_finished(&b, "n", 1_000, "ts");
        let mine = b.out.join("n.mkv");
        std::fs::write(&mine, b"made by hand").unwrap();
        let original = std::fs::read(&ts).unwrap();
        b.rec.kick();
        let r = wait_idle(&b, "n");
        wait_worker(&b);
        assert_eq!(r.job_reason.as_deref(), Some(NAME_TAKEN), "{r:?}");
        assert_eq!(std::fs::read(&mine).unwrap(), b"made by hand");
        assert_eq!(std::fs::read(&ts).unwrap(), original);
        assert_eq!(r.path, ts.to_string_lossy());
        assert_eq!(listing(&b.out), ["n.mkv", "n.ts"]);
    }

    #[test]
    fn the_old_file_stays_when_the_index_cannot_record_the_new_one() {
        let b = repacking("save-fails");
        let ts = add_finished(&b, "a", 1_000, "ts");
        let original = std::fs::read(&ts).unwrap();
        // A directory where the index goes: the save cannot move its temp file
        // over it.
        std::fs::create_dir_all(b.root.join("recordings.json")).unwrap();
        b.rec.kick();
        let r = wait_idle(&b, "a");
        wait_worker(&b);
        // The page is told, and both files are there for the next launch.
        assert!(r.path.ends_with(".mkv"), "{r:?}");
        assert_eq!(std::fs::read(&ts).unwrap(), original);
        near(&check(Path::new(&r.path)), SRC_SECS);
    }

    #[test]
    fn deleting_an_mkv_takes_the_ts_it_replaced_but_not_one_that_is_anothers() {
        let dir = temp("delete-sibling");
        let file = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, b"x").unwrap();
            p
        };
        let (x_mkv, x_ts) = (file("x.mkv"), file("x.ts"));
        let (y_mkv, y_ts) = (file("y.mkv"), file("y.ts"));
        let (z_mkv, z_ts) = (file("z.mkv"), file("z.ts"));
        let index = dir.join("recordings.json");
        write_index(
            &index,
            vec![
                record("x", Status::Done, &x_mkv),
                record("y", Status::Done, &y_mkv),
                record("y-ts", Status::Done, &y_ts),
                record("z", Status::Done, &z_ts),
            ],
        );
        let r = Rec::open(index, cfg_quiet());
        r.delete("x").unwrap();
        assert!(!x_mkv.exists() && !x_ts.exists());
        r.delete("y").unwrap();
        assert!(
            !y_mkv.exists() && y_ts.exists(),
            "another entry's .ts stays"
        );
        // A .ts entry's neighbour .mkv may be somebody's own: never taken.
        r.delete("z").unwrap();
        assert!(!z_ts.exists() && z_mkv.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_job_that_is_cancelled_leaves_no_busy_row_behind() {
        let hold = Arc::new(AtomicBool::new(true));
        let held = hold.clone();
        let b = Bench::new("cancelled", move |c| {
            c.repack = true;
            c.after_write = Some(Arc::new(move |_| {
                while held.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }));
        });
        let done = ended(&b, stream(0.0, 12.0));
        until("the job to run", 30, || {
            b.rec.get(&done.id).unwrap().progress.is_some()
        });
        // Ended, but the record stays (a delete that gave up waiting).
        let cancel = lock(&b.rec.jobs).current.as_ref().unwrap().1.clone();
        cancel.ask();
        hold.store(false, Ordering::SeqCst);
        until("the row to be let go", 20, || {
            b.rec.get(&done.id).unwrap().job.is_none()
        });
        let r = b.rec.get(&done.id).unwrap();
        assert_eq!((r.progress, r.job_reason), (None, None));
        assert_eq!(r.path, done.path);
        assert!(Path::new(&done.path).exists());
        assert_eq!(listing(&b.out).len(), 1);
    }

    #[test]
    fn a_shrink_the_player_keeps_from_replacing_the_file_says_so() {
        // The file is swapped for a folder as the new one is checked, which
        // is a rename that cannot happen.
        let b = Bench::new("in-use", |c| {
            c.repack = true;
            c.after_write = Some(Arc::new(|tmp| {
                let mkv = tmp.with_file_name("m.mkv");
                std::fs::remove_file(&mkv).unwrap();
                std::fs::create_dir(&mkv).unwrap();
            }));
        });
        add_finished(&b, "m", 1_000, "mkv");
        b.rec.set_smaller(true);
        let r = wait_idle(&b, "m");
        wait_worker(&b);
        assert_eq!(r.job_reason.as_deref(), Some(IN_USE), "{r:?}");
        assert_eq!((r.saved, r.progress), (0, None));
        // The smaller file is whole and checked, so it is kept to be placed
        // later; no temp file is left.
        assert_eq!(listing(&b.out), ["m.mkv", "m.shrink.ready"]);
    }

    #[test]
    fn a_checked_shrink_that_only_could_not_be_placed_is_placed_later_without_a_second_encode() {
        let encodes = Arc::new(AtomicUsize::new(0));
        let counted = encodes.clone();
        let b = Bench::new("in-use-kept", move |c| {
            c.repack = true;
            c.after_write = Some(Arc::new(move |tmp| {
                // Only the first encode: the player has the original open, which
                // is a rename that cannot happen.
                if counted.fetch_add(1, Ordering::SeqCst) == 0 {
                    let mkv = tmp.with_file_name("m.mkv");
                    std::fs::remove_file(&mkv).unwrap();
                    std::fs::create_dir(&mkv).unwrap();
                }
            }));
        });
        let mkv = add_finished(&b, "m", 1_000, "mkv");
        let original = std::fs::read(&mkv).unwrap();
        b.rec.set_smaller(true);
        wait_idle(&b, "m");
        wait_worker(&b);
        assert_eq!(b.rec.get("m").unwrap().job_reason.as_deref(), Some(IN_USE));
        assert_eq!(encodes.load(Ordering::SeqCst), 1);
        // The player lets go (the original is as it was) and the queue passes.
        std::fs::remove_dir(&mkv).unwrap();
        std::fs::write(&mkv, &original).unwrap();
        b.rec.queue("m", Job::Shrink);
        b.rec.kick();
        until("the kept file to be placed", 60, || {
            b.rec.get("m").unwrap().job_reason.is_none()
        });
        wait_worker(&b);
        let r = b.rec.get("m").unwrap();
        assert_eq!(encodes.load(Ordering::SeqCst), 1, "it was encoded again");
        assert_eq!(listing(&b.out), ["m.mkv"]);
        let after = size_of(&mkv).unwrap();
        assert!(after < original.len() as u64, "{after}");
        assert_eq!((r.bytes, r.saved), (after, original.len() as u64 - after));
        assert_eq!((r.job, r.progress), (None, None));
    }

    #[test]
    fn a_shrink_that_does_not_check_out_leaves_nothing_to_place_later() {
        let b = Bench::new("shrink-bad", |c| {
            c.repack = true;
            c.after_write = Some(Arc::new(|tmp| {
                let f = OpenOptions::new().write(true).open(tmp).unwrap();
                f.set_len(f.metadata().unwrap().len() / 2).unwrap();
            }));
        });
        let mkv = add_finished(&b, "m", 1_000, "mkv");
        let before = size_of(&mkv);
        b.rec.set_smaller(true);
        let r = wait_idle(&b, "m");
        wait_worker(&b);
        let why = r.job_reason.expect("it says why");
        assert!(why.starts_with("the new file"), "{why}");
        assert_eq!(size_of(&mkv), before);
        assert_eq!(listing(&b.out), ["m.mkv"]);
    }

    #[test]
    fn a_checked_shrink_waiting_to_be_placed_survives_launch_and_goes_with_its_recording() {
        let _lane = lock(&LANE);
        let dir = temp("ready-launch");
        let index = dir.join("recordings.json");
        let file = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, b"x").unwrap();
            p
        };
        let busy = |id: &str, path: &Path, why: &str| {
            let mut r = record(id, Status::Done, path);
            r.bytes = 1;
            r.job_reason = Some(why.into());
            r
        };
        write_index(
            &index,
            vec![
                busy("busy", &file("busy.mkv"), IN_USE),
                // Its shrink was refused for another reason: nothing to place.
                busy("other", &file("other.mkv"), "it didn't get any smaller"),
            ],
        );
        for name in [
            "busy.shrink.ready",
            "busy.shrink.tmp",
            "other.shrink.ready",
            "orphan.shrink.ready",
        ] {
            file(name);
        }
        let mut cfg = cfg_quiet();
        cfg.repack = true;
        cfg.ffmpeg = Some(dir.join("no-ffmpeg"));
        let r = Rec::open(index, cfg);
        // The unchecked temp goes, the checked file waits, and one that no
        // shrink will place goes. (A file no record names is not ours to find.)
        assert_eq!(
            listing(&dir),
            [
                "busy.mkv",
                "busy.shrink.ready",
                "orphan.shrink.ready",
                "other.mkv",
                "recordings.json"
            ]
        );
        r.delete("busy").unwrap();
        assert_eq!(
            listing(&dir),
            ["orphan.shrink.ready", "other.mkv", "recordings.json"]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_shrink_that_found_the_file_in_use_is_tried_again_at_launch() {
        let _lane = lock(&LANE);
        let dir = temp("in-use-again");
        let index = dir.join("recordings.json");
        let mkv = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, b"x").unwrap();
            p
        };
        let failed = |id: &str, path: &Path, why: &str| {
            let mut r = record(id, Status::Done, path);
            r.bytes = 1;
            r.job_reason = Some(why.into());
            r
        };
        write_index(
            &index,
            vec![
                failed("busy", &mkv("busy.mkv"), IN_USE),
                failed("other", &mkv("other.mkv"), "it didn't get any smaller"),
            ],
        );
        let mut cfg = cfg_quiet();
        cfg.repack = true;
        cfg.ffmpeg = Some(dir.join("no-ffmpeg"));
        let r = Rec::open(index, cfg);
        assert_eq!(r.get("busy").unwrap().job, Some(Job::Shrink));
        assert_eq!(r.get("other").unwrap().job, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn turning_smaller_files_off_clears_a_waiting_row_that_is_in_no_queue() {
        let b = repacking("shrink-off-rows");
        let waiting = |id: &str, progress: Option<f64>| {
            let mut r = record(id, Status::Done, &b.out.join(format!("{id}.mkv")));
            r.job = Some(Job::Shrink);
            r.progress = progress;
            lock(&b.rec.records).push(r);
        };
        // One a remux queued as the toggle flipped, one running, one queued.
        waiting("flipped", None);
        waiting("running", Some(0.3));
        add_finished(&b, "queued", 3_000, "mkv");
        b.rec.set_smaller(false);
        assert_eq!(b.rec.get("flipped").unwrap().job, None);
        assert_eq!(b.rec.get("queued").unwrap().job, None);
        assert_eq!(b.rec.get("running").unwrap().job, Some(Job::Shrink));
        assert!(lock(&b.rec.jobs).queue.is_empty());
        // The page heard about both, and the index says it.
        let seen = lock(&b.events).clone();
        for id in ["flipped", "queued"] {
            assert!(seen.iter().any(|e| e.id == id && e.job.is_none()), "{id}");
        }
        let (saved, _) = load(&b.root.join("recordings.json"));
        assert!(saved
            .iter()
            .filter(|r| r.id == "flipped" || r.id == "queued")
            .all(|r| r.job.is_none()));
    }

    #[test]
    fn a_shrink_waits_for_a_recording_that_is_still_connecting() {
        let b = repacking("shrink-connecting");
        // The provider takes a second to answer.
        let fake = serve(|_| {
            std::thread::sleep(Duration::from_millis(1200));
            stream(0.0, 12.0)
        });
        let path = add_finished(&b, "m", 1_000, "mkv");
        let before = size_of(&path).unwrap();
        let url = format!("{}/live.ts", fake.base);
        let id = std::thread::scope(|s| {
            let starting = s.spawn(|| b.start(&url));
            until("the recording to be asked for", 10, || {
                lock(&fake.hits).len() == 1
            });
            b.rec.set_smaller(true);
            std::thread::sleep(Duration::from_millis(500));
            let m = b.rec.get("m").unwrap();
            assert_eq!(
                (m.job, m.progress, m.bytes),
                (Some(Job::Shrink), None, before)
            );
            let id = starting.join().unwrap();
            b.wait_still(&id);
            b.stop(&id);
            id
        });
        wait_idle(&b, "m");
        wait_idle(&b, &id);
        assert!(b.rec.get("m").unwrap().saved > 0);
    }

    // --- the schedule (Phase 3) ---

    const MIN: u64 = 60_000;

    /// A programme `from` ms from now that lasts `len` ms.
    fn programme(from: i64, len: u64) -> Plan {
        let start = (now_ms() as i64 + from) as u64;
        Plan {
            channel_id: "p1:42".into(),
            channel: "News: HD/1".into(),
            programme: Some("The Match".into()),
            playlist_id: "p1".into(),
            start,
            end: start + len,
        }
    }

    /// `plan` on another channel, so a test that needs a second record is not
    /// asking for the same channel twice at overlapping times.
    fn elsewhere(mut plan: Plan, n: u32) -> Plan {
        plan.channel_id = format!("p1:{n}");
        plan.channel = format!("Channel {n}");
        plan
    }

    fn events_of(b: &Bench, id: &str) -> Vec<Record> {
        lock(&b.events)
            .iter()
            .filter(|r| r.id == id)
            .cloned()
            .collect()
    }

    #[test]
    fn a_scheduled_programme_starts_a_minute_early_and_stops_a_minute_late() {
        let b = Bench::new("sched-times", |_| {});
        let plan = programme(10 * MIN as i64, 60 * MIN);
        let (start, end) = (plan.start, plan.end);
        let r = b.rec.schedule(plan).unwrap();
        assert_eq!(r.status, Status::Scheduled);
        assert_eq!(r.start_at, Some(start - MIN));
        assert_eq!(r.stop_at, Some(end + MIN));
        // The list sorts it by the programme, and it has no file yet.
        assert_eq!((r.started_at, r.path.as_str(), r.bytes), (start, "", 0));
        assert_eq!(r.channel_id.as_deref(), Some("p1:42"));
        assert!(!r.due && r.ended_at.is_none());
        // The page hears of it at once.
        assert_eq!(events_of(&b, &r.id), vec![r.clone()]);
        // And it is in the index, so a new run has it.
        let again = Rec::open(b.root.join("recordings.json"), cfg_quiet());
        assert_eq!(again.get(&r.id).unwrap(), r);
    }

    #[test]
    fn a_programme_that_is_on_starts_now_and_one_that_is_over_is_refused() {
        let b = Bench::new("sched-now", |_| {});
        let before = now_ms();
        let on = b.rec.schedule(programme(-20 * MIN as i64, 60 * MIN)).unwrap();
        let after = now_ms();
        let at = on.start_at.unwrap();
        assert!(before <= at && at <= after, "{at} not in {before}..{after}");
        // Its end still counts a minute late.
        assert!(on.stop_at.unwrap() > after + 39 * MIN);
        // Over, but inside the extra minute: still worth a try.
        assert!(b
            .rec
            .schedule(elsewhere(programme(-61 * MIN as i64, 60 * MIN + 30_000), 43))
            .is_ok());
        // Over.
        let over = b.rec.schedule(programme(-90 * MIN as i64, 20 * MIN)).unwrap_err();
        assert_eq!(over, "that programme is over");
        let empty = b.rec.schedule(programme(10 * MIN as i64, 0)).unwrap_err();
        assert_eq!(empty, "that programme has no length");
    }

    #[test]
    fn asking_twice_for_one_programme_is_one_recording() {
        let b = Bench::new("sched-twice", |_| {});
        let plan = programme(10 * MIN as i64, 30 * MIN);
        let again = Plan {
            channel_id: plan.channel_id.clone(),
            channel: plan.channel.clone(),
            programme: plan.programme.clone(),
            playlist_id: plan.playlist_id.clone(),
            start: plan.start,
            end: plan.end,
        };
        let first = b.rec.schedule(plan).unwrap();
        assert_eq!(b.rec.schedule(again).unwrap().id, first.id);
        assert_eq!(b.rec.list().len(), 1);
        // The same time on another channel is another recording.
        let mut other = programme(0, 30 * MIN);
        other.start = first.started_at;
        other.end = first.started_at + 30 * MIN;
        other.channel_id = "p1:43".into();
        assert_ne!(b.rec.schedule(other).unwrap().id, first.id);
    }

    #[test]
    fn a_programme_that_meets_a_record_of_its_channel_is_refused() {
        let b = Bench::new("sched-overlap", |_| {});
        let first = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        // The guide moved the start: the same programme, not a second one.
        let moved = b.rec.schedule(programme(15 * MIN as i64, 30 * MIN)).unwrap_err();
        assert_eq!(moved, "this channel is already being recorded then");
        // The next programme starts where this one ends: its own.
        let mut next = programme(0, 30 * MIN);
        next.start = first.stop_at.unwrap() - MIN;
        next.end = next.start + 30 * MIN;
        assert!(b.rec.schedule(next).is_ok());
        // Another channel at the same time is free.
        let mut other = programme(10 * MIN as i64, 30 * MIN);
        other.channel_id = "p1:43".into();
        other.channel = "Other".into();
        assert!(b.rec.schedule(other).is_ok());
    }

    #[test]
    fn a_running_recording_covers_its_programme_by_the_channel_name() {
        let b = Bench::new("sched-running", |_| {});
        // Native began it a minute before the programme: a running record with
        // no channel id and an end.
        let now = now_ms();
        let mut run = record("run", Status::Recording, Path::new("x.ts"));
        run.channel = "News: HD/1".into();
        run.started_at = now;
        run.stop_at = Some(now + 31 * MIN);
        lock(&b.rec.records).push(run);
        let soon = b.rec.schedule(programme(30_000, 30 * MIN)).unwrap_err();
        assert_eq!(soon, "this channel is already being recorded then");
        // One with no end (Record in the player) covers a programme that is on,
        // and not one still to come.
        lock(&b.rec.records).clear();
        let mut open = record("open", Status::Recording, Path::new("x.ts"));
        open.channel = "News: HD/1".into();
        open.started_at = now;
        lock(&b.rec.records).push(open);
        assert!(b.rec.schedule(programme(-5 * MIN as i64, 30 * MIN)).is_err());
        assert!(b.rec.schedule(programme(60 * MIN as i64, 30 * MIN)).is_ok());
    }

    #[test]
    fn the_page_is_told_when_a_start_is_due_and_not_before() {
        let b = Bench::new("sched-due", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        let at = r.start_at.unwrap();
        b.rec.sched_tick(at - 1);
        assert!(!b.rec.get(&r.id).unwrap().due);
        assert_eq!(events_of(&b, &r.id).len(), 1);
        b.rec.sched_tick(at);
        let due = b.rec.get(&r.id).unwrap();
        assert_eq!((due.status, due.due), (Status::Scheduled, true));
        assert_eq!(events_of(&b, &r.id).last().unwrap(), &due);
        // Told once, not every tick.
        b.rec.sched_tick(at + 5_000);
        b.rec.sched_tick(at + 10_000);
        assert_eq!(events_of(&b, &r.id).len(), 2);
        // Late by the limit is still on time.
        let late = b
            .rec
            .schedule(elsewhere(programme(11 * MIN as i64, 30 * MIN), 43))
            .unwrap();
        b.rec.sched_tick(late.start_at.unwrap() + LATE_MS);
        assert!(b.rec.get(&late.id).unwrap().due);
    }

    #[test]
    fn a_start_found_late_is_missed_and_not_started() {
        let b = Bench::new("sched-late", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        let at = r.start_at.unwrap();
        b.rec.sched_tick(at + LATE_MS + 1);
        let missed = b.rec.get(&r.id).unwrap();
        assert_eq!(missed.status, Status::Missed);
        assert_eq!(missed.reason.as_deref(), Some(MISSED));
        assert!(!missed.due && missed.ended_at.is_some());
        // Said to the page, kept in the index, and never offered again.
        assert_eq!(events_of(&b, &r.id).last().unwrap(), &missed);
        b.rec.sched_tick(at + LATE_MS + 5_000);
        assert_eq!(events_of(&b, &r.id).len(), 2);
        let again = Rec::open(b.root.join("recordings.json"), cfg_quiet());
        assert_eq!(again.get(&r.id).unwrap().status, Status::Missed);
    }

    #[test]
    fn a_due_start_the_page_never_made_is_missed_when_the_programme_is_over() {
        let b = Bench::new("sched-unclaimed", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        b.rec.sched_tick(r.start_at.unwrap());
        // A long wait on the page is not a miss while there is programme left.
        b.rec.sched_tick(r.start_at.unwrap() + 5 * MIN);
        assert!(b.rec.get(&r.id).unwrap().due);
        b.rec.sched_tick(r.stop_at.unwrap() - 1);
        assert_eq!(b.rec.get(&r.id).unwrap().status, Status::Scheduled);
        b.rec.sched_tick(r.stop_at.unwrap());
        let missed = b.rec.get(&r.id).unwrap();
        assert_eq!((missed.status, missed.due), (Status::Missed, false));
    }

    #[test]
    fn a_schedule_survives_a_restart_and_a_start_that_passed_meanwhile_is_missed() {
        let dir = temp("sched-restart");
        let index = dir.join("recordings.json");
        let now = now_ms();
        let waiting = |id: &str, start_at: u64| {
            let mut r = record(id, Status::Scheduled, Path::new(""));
            r.started_at = start_at + MIN;
            r.start_at = Some(start_at);
            r.stop_at = Some(start_at + 62 * MIN);
            r.channel_id = Some("p1:42".into());
            r
        };
        let mut due = waiting("was-due", now - 5 * MIN);
        due.due = true;
        write_index(
            &index,
            vec![
                waiting("later", now + 30 * MIN),
                waiting("passed", now - 5 * MIN),
                waiting("passed-mid-programme", now - 20 * MIN),
                due,
                record("kept", Status::Done, &dir.join("a.ts")),
            ],
        );
        let r = Rec::open(index.clone(), cfg_quiet());
        let later = r.get("later").unwrap();
        assert_eq!((later.status, later.due), (Status::Scheduled, false));
        for id in ["passed", "passed-mid-programme", "was-due"] {
            let m = r.get(id).unwrap();
            assert_eq!(m.status, Status::Missed, "{id}");
            assert_eq!(m.reason.as_deref(), Some(MISSED), "{id}");
            assert!(m.ended_at.is_some() && !m.due, "{id}");
        }
        assert_eq!(r.get("kept").unwrap().status, Status::Done);
        // Settled on disk: the next run finds the same.
        let again = Rec::open(index, cfg_quiet());
        assert_eq!(again.list(), r.list());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancel_that_cannot_be_saved_leaves_the_schedule_and_says_so() {
        let b = Bench::new("sched-cancel-unsaved", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        // A directory where the index goes: the save cannot move its temp file
        // over it.
        let index = b.root.join("recordings.json");
        std::fs::remove_file(&index).unwrap();
        std::fs::create_dir(&index).unwrap();
        let why = b.rec.delete(&r.id).unwrap_err();
        assert_eq!(why, "the list couldn't be saved");
        // Still there, still waiting, so what the page lists is what the next
        // launch will find.
        assert_eq!(b.rec.get(&r.id).unwrap().status, Status::Scheduled);
        assert_eq!(b.rec.list().len(), 1);
        // The disk comes back, and the same cancel goes through.
        std::fs::remove_dir(&index).unwrap();
        b.rec.delete(&r.id).unwrap();
        assert!(b.rec.list().is_empty());
        let again = Rec::open(index, cfg_quiet());
        assert!(again.list().is_empty());
    }

    #[test]
    fn cancelling_removes_the_schedule_and_a_start_that_was_on_its_way_finds_it_gone() {
        let b = Bench::new("sched-cancel", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        b.rec.delete(&r.id).unwrap();
        assert!(b.rec.list().is_empty());
        let again = Rec::open(b.root.join("recordings.json"), cfg_quiet());
        assert!(again.list().is_empty());
        // The page was already on its way to start it.
        let fake = serve(|_| stream(0.0, 8.0));
        let url = format!("{}/live/u/p/1.ts", fake.base);
        let why = b
            .block(b.rec.start_scheduled(&r.id, b.spec(&url)))
            .unwrap_err();
        assert_eq!(why, CANCELLED);
        assert!(lock(&fake.hits).is_empty(), "the provider was asked");
        // Cancelled while it connected: nothing is left, and nothing records.
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        let slow = serve(|_| {
            std::thread::sleep(Duration::from_millis(600));
            stream(0.0, 8.0)
        });
        let url = format!("{}/live/u/p/1.ts", slow.base);
        let why = std::thread::scope(|s| {
            let starting = s.spawn(|| b.block(b.rec.start_scheduled(&r.id, b.spec(&url))));
            until("the provider to be asked", 10, || !lock(&slow.hits).is_empty());
            b.rec.delete(&r.id).unwrap();
            starting.join().unwrap().unwrap_err()
        });
        assert_eq!(why, CANCELLED);
        assert!(b.rec.list().is_empty() && lock(&b.rec.live).is_empty());
        assert_eq!(std::fs::read_dir(&b.out).map(|d| d.count()).unwrap_or(0), 0);
    }

    #[test]
    fn a_scheduled_recording_takes_its_records_place_and_stops_a_minute_after_the_end() {
        let (fake, _) = plan(vec![stream(0.0, 8.0)]);
        let b = Bench::new("sched-run", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        b.rec.sched_tick(r.start_at.unwrap());
        // What the page does when it hears it is due.
        let url = format!("{}/live/u/p/1.ts", fake.base);
        let id = b
            .block(b.rec.start_scheduled(&r.id, b.spec(&url)))
            .expect("started");
        assert_eq!(id, r.id);
        // One row that changed, not two.
        let all = b.rec.list();
        assert_eq!(all.len(), 1, "{all:?}");
        assert_eq!(all[0].status, Status::Recording);
        assert_eq!(all[0].stop_at, r.stop_at);
        assert!(!all[0].due && all[0].path.ends_with(".ts"));
        assert_eq!(events_of(&b, &id).last().unwrap().status, Status::Recording);
        // The same record cannot be started again.
        assert!(b.block(b.rec.start_scheduled(&id, b.spec(&url))).is_err());
        b.wait_still(&id);
        // Not at the end of the programme: a minute after it.
        let stop = r.stop_at.unwrap();
        b.rec.sched_tick(stop - 1);
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(b.status(&id), Status::Recording);
        b.rec.sched_tick(stop);
        let done = b.wait_over(&id, 20);
        assert_eq!((done.status, done.reason.clone()), (Status::Done, None));
        near(&check(Path::new(&done.path)), 8.0);
        // The index holds the one record, done.
        let again = Rec::open(b.root.join("recordings.json"), cfg_quiet());
        assert_eq!(again.list().len(), 1);
        assert_eq!(again.get(&id).unwrap().status, Status::Done);
    }

    #[test]
    fn a_recording_started_by_hand_for_a_programme_stops_a_minute_after_its_end() {
        let (fake, _) = plan(vec![stream(0.0, 8.0)]);
        let b = Bench::new("sched-until", |_| {});
        let end = now_ms() + 30 * MIN;
        let mut spec = b.spec(&format!("{}/live/u/p/1.ts", fake.base));
        spec.until = Some(end);
        let id = b.block(b.rec.start(spec)).expect("started");
        assert_eq!(b.rec.get(&id).unwrap().stop_at, Some(end + MIN));
        b.wait_still(&id);
        b.rec.sched_tick(end + MIN - 1);
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(b.status(&id), Status::Recording);
        b.rec.sched_tick(end + MIN);
        assert_eq!(b.wait_over(&id, 20).status, Status::Done);
        // One with no end is left to run.
        let (fake, _) = plan(vec![stream(0.0, 8.0)]);
        let id = b.start(&format!("{}/live/u/p/1.ts", fake.base));
        assert_eq!(b.rec.get(&id).unwrap().stop_at, None);
        b.rec.sched_tick(u64::MAX);
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(b.status(&id), Status::Recording);
        b.stop(&id);
    }

    #[test]
    fn a_start_that_fails_leaves_the_scheduled_record_failed_with_why() {
        let fake = serve(|_| Reply::Status(403));
        let b = Bench::new("sched-fails", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        b.rec.sched_tick(r.start_at.unwrap());
        let url = format!("{}/live/u/p/1.ts", fake.base);
        let why = b
            .block(b.rec.start_scheduled(&r.id, b.spec(&url)))
            .unwrap_err();
        assert!(why.contains("HTTP 403"), "{why}");
        let failed = b.rec.get(&r.id).unwrap();
        assert_eq!(failed.status, Status::Failed);
        assert_eq!(failed.reason.as_deref(), Some(why.as_str()));
        assert!(!failed.due && failed.ended_at.is_some());
        // Nothing left to start, and nothing on disk. Its row can be deleted.
        assert_eq!(std::fs::read_dir(&b.out).map(|d| d.count()).unwrap_or(0), 0);
        b.rec.delete(&r.id).unwrap();
        assert!(b.rec.list().is_empty());
    }

    #[test]
    fn a_page_without_a_link_fails_the_record_and_only_a_waiting_one() {
        let b = Bench::new("sched-nolink", |_| {});
        let r = b.rec.schedule(programme(10 * MIN as i64, 30 * MIN)).unwrap();
        b.rec.sched_tick(r.start_at.unwrap());
        b.rec.fail_scheduled(&r.id, "there is no link for this channel");
        let failed = b.rec.get(&r.id).unwrap();
        assert_eq!(failed.status, Status::Failed);
        assert_eq!(failed.reason.as_deref(), Some("there is no link for this channel"));
        assert!(!failed.due);
        // A second word on it changes nothing.
        let n = events_of(&b, &r.id).len();
        b.rec.fail_scheduled(&r.id, "another reason");
        assert_eq!(b.rec.get(&r.id).unwrap(), failed);
        assert_eq!(events_of(&b, &r.id).len(), n);
        // And a recording that already runs is not failed by a late word.
        let (fake, _) = plan(vec![stream(0.0, 8.0)]);
        let id = b.start(&format!("{}/live/u/p/1.ts", fake.base));
        b.rec.fail_scheduled(&id, "too late");
        assert_eq!(b.status(&id), Status::Recording);
        b.stop(&id);
    }

    #[test]
    fn the_schedule_keeps_its_own_clock() {
        // No tick is driven by hand: the thread finds the start by itself.
        let b = Bench::new("sched-clock", |c| c.sched_tick = Duration::from_millis(30));
        let r = b.rec.schedule(programme(-(MIN as i64) / 2, 30 * MIN)).unwrap();
        until("the start to be found due", 10, || b.rec.get(&r.id).unwrap().due);
        assert!(events_of(&b, &r.id).last().unwrap().due);
        // And the thread goes when the recorder does.
        let weak = Arc::downgrade(&b.rec);
        let rec = b.rec.clone();
        drop(b);
        drop(rec);
        until("the recorder to be dropped", 10, || weak.upgrade().is_none());
    }

    #[test]
    fn the_page_hears_a_scheduled_record_in_camel_case_and_an_old_one_as_before() {
        let mut r = record("a", Status::Scheduled, Path::new(""));
        r.channel_id = Some("p1:42".into());
        r.start_at = Some(5);
        r.stop_at = Some(9);
        r.due = true;
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["status"], "scheduled");
        assert_eq!(json["channelId"], "p1:42");
        assert_eq!((json["startAt"].as_u64(), json["stopAt"].as_u64()), (Some(5), Some(9)));
        assert_eq!(json["due"], true);
        assert_eq!(serde_json::to_value(Status::Missed).unwrap(), "missed");
        // A record that was never scheduled sends none of these.
        let plain = serde_json::to_value(record("b", Status::Done, Path::new("C:\\v\\b.ts"))).unwrap();
        let keys = plain.as_object().unwrap();
        assert!(["channelId", "startAt", "stopAt", "due"].iter().all(|k| !keys.contains_key(*k)));
        // And an index from before reads as not scheduled.
        let dir = temp("old-sched-index");
        let index = dir.join("recordings.json");
        std::fs::write(
            &index,
            r#"{"version":1,"records":[{"id":"a","channel":"News","playlistId":"p1","startedAt":1000,"path":"C:\\v\\a.ts","bytes":5,"status":"done"}]}"#,
        )
        .unwrap();
        let (records, _) = load(&index);
        let a = &records[0];
        assert_eq!((a.channel_id.clone(), a.start_at, a.stop_at, a.due), (None, None, None, false));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
