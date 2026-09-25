//! HEVC to H.264 for a multi-view tile, on the way through the stream proxy.
//!
//! WHY. A tile is a web `<video>` fed by mpegts.js, so the webview's own
//! decoders are the ceiling, and WebView2 decodes HEVC only through Windows'
//! "HEVC Video Extensions" Store package. Chrome goes to the GPU through
//! D3D11 and needs nothing; Edge, and WebView2 with it, goes through Media
//! Foundation. Adam's machine said no to HEVC on 2026-09-13 with an RTX 4090
//! in it, and the free listing of that package would not install for him
//! (2026-09-25). So the proxy turns an HEVC stream into H.264, which every
//! tile plays, and nobody has to buy anything.
//!
//! HOW. ffmpeg, the build shinchiro publishes beside the libmpv we already
//! ship (scripts/fetch-ffmpeg.mjs), reading the provider's bytes on stdin and
//! writing MPEG-TS on stdout. It never sees a URL, so it can never print the
//! line's credentials. Decoding goes to the GPU through D3D11 where it works
//! here, HDR is tone mapped to SDR on the GPU by libplacebo, the
//! picture comes down to 1080p at most (a tile is never bigger), and the
//! encoder is the first of NVIDIA's, Intel's and AMD's that works here, then
//! libx264 on the CPU. Which of those this machine has is asked once, with
//! the exact options the real conversion uses, so an option a build does not
//! take fails the question rather than a tile.
//!
//! WHEN. Only when the tile asks (the webview cannot play HEVC) AND the
//! stream is HEVC, which the first packets say (`sniff`). Everything else is
//! passed through untouched, as before.
//!
//! One provider connection either way: the bytes read to sniff are the first
//! bytes ffmpeg gets. A line's cap counts connections (Adam's is 3), so a
//! second request to find out what the stream is would cost a tile.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{future, stream, Stream, StreamExt};
use hyper::body::Bytes;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::OnceCell;

/// What a stream's first packets say about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sniff {
    /// Its programme carries an HEVC video stream (stream_type 0x24).
    Hevc,
    /// A transport stream without HEVC, or not one this reads at all.
    Other,
    /// No programme map yet: read more.
    NeedMore,
}

/// MPEG-TS packets are 188 bytes, each starting 0x47.
const TS: usize = 188;
const SYNC: u8 = 0x47;
/// ISO/IEC 13818-1 stream_type for H.265.
const HEVC: u8 = 0x24;

/// Read the programme map out of the start of a transport stream.
///
/// The PAT (PID 0) names the PMT's PID, and the PMT lists each elementary
/// stream's type. Both are small and repeat several times a second, so a
/// section that spans two packets is not waited for: the next copy will
/// fit, and a stream whose never does is passed through as it is.
pub fn sniff(buf: &[u8]) -> Sniff {
    match read_map(buf) {
        Map::Types(types) if types.contains(&HEVC) => Sniff::Hevc,
        Map::Types(_) | Map::NotTs => Sniff::Other,
        Map::NeedMore => Sniff::NeedMore,
    }
}

/// Every elementary stream's type, once the programme map has been read.
/// The tests read what came out of a conversion with it.
#[cfg(test)]
pub fn stream_types(buf: &[u8]) -> Option<Vec<u8>> {
    match read_map(buf) {
        Map::Types(t) => Some(t),
        _ => None,
    }
}

enum Map {
    Types(Vec<u8>),
    NeedMore,
    NotTs,
}

fn read_map(buf: &[u8]) -> Map {
    // Where the packets start: a sync byte with another one packet later.
    let aligned = (0..buf.len().min(TS))
        .find(|&i| buf[i] == SYNC && buf.get(i + TS).map_or(true, |&b| b == SYNC));
    let Some(start) = aligned else {
        return if buf.len() >= 2 * TS {
            Map::NotTs
        } else {
            Map::NeedMore
        };
    };
    let mut pmt_pid = None;
    for pkt in buf[start..].chunks_exact(TS) {
        if pkt[0] != SYNC {
            // Lost sync: not a stream this can read, so leave it alone.
            return Map::NotTs;
        }
        let unit_start = pkt[1] & 0x40 != 0;
        let pid = (u16::from(pkt[1] & 0x1f) << 8) | u16::from(pkt[2]);
        let mut at = 4;
        match (pkt[3] >> 4) & 0x3 {
            // No payload.
            0 | 2 => continue,
            // An adaptation field first.
            3 => at += 1 + usize::from(pkt[4]),
            _ => {}
        }
        if !unit_start || at >= TS {
            continue;
        }
        // A section starts after its pointer field.
        at += 1 + usize::from(pkt[at]);
        let Some(section) = pkt.get(at..) else {
            continue;
        };
        if pid == 0 {
            if let Some(p) = pat(section) {
                pmt_pid = Some(p);
            }
        } else if Some(pid) == pmt_pid {
            if let Some(types) = pmt(section) {
                return Map::Types(types);
            }
        }
    }
    Map::NeedMore
}

/// A PSI section's body (after the 3-byte header, before the CRC), when the
/// whole of it is in `sec`.
fn section(sec: &[u8], table_id: u8) -> Option<&[u8]> {
    if sec.len() < 3 || sec[0] != table_id {
        return None;
    }
    let len = (usize::from(sec[1] & 0x0f) << 8) | usize::from(sec[2]);
    let end = 3 + len;
    if len < 9 || end > sec.len() {
        return None;
    }
    Some(&sec[3..end - 4])
}

/// The first programme's PMT PID.
fn pat(sec: &[u8]) -> Option<u16> {
    // transport_stream_id(2) version(1) section_number(1) last_section(1)
    section(sec, 0x00)?.get(5..)?.chunks_exact(4).find_map(|e| {
        let program = u16::from_be_bytes([e[0], e[1]]);
        (program != 0).then(|| (u16::from(e[2] & 0x1f) << 8) | u16::from(e[3]))
    })
}

/// Every elementary stream's stream_type.
fn pmt(sec: &[u8]) -> Option<Vec<u8>> {
    let body = section(sec, 0x02)?;
    // program_number(2) version(1) section_number(1) last_section(1)
    // PCR_PID(2) program_info_length(2)
    if body.len() < 9 {
        return None;
    }
    let info = (usize::from(body[7] & 0x0f) << 8) | usize::from(body[8]);
    let mut i = 9 + info;
    let mut types = Vec::new();
    while i + 5 <= body.len() {
        types.push(body[i]);
        let es_info = (usize::from(body[i + 3] & 0x0f) << 8) | usize::from(body[i + 4]);
        i += 5 + es_info;
    }
    Some(types)
}

/// What this machine's ffmpeg can do, asked once.
#[derive(Debug, Clone)]
pub struct Caps {
    pub ffmpeg: PathBuf,
    /// The GPU decoder that worked here, or None to decode on the CPU.
    pub hwaccel: Option<&'static str>,
    /// The first H.264 encoder that worked here.
    pub encoder: &'static str,
    /// Whether libplacebo could open the GPU: tone mapping and scaling
    /// there. Without it the picture is scaled on the CPU and HDR is not
    /// tone mapped.
    pub placebo: bool,
}

/// GPU decoders to try, in order. NOT `-hwaccel auto`: measured on a Linux
/// build, auto went on from a missing CUDA to VAAPI, whose loader aborted
/// the whole process. One named, and asked about first, instead. Each with
/// the format its frames have on the GPU.
#[cfg(windows)]
const HWACCELS: [(&str, &str); 1] = [("d3d11va", "d3d11")];
#[cfg(not(windows))]
const HWACCELS: [(&str, &str); 0] = [];

/// GPU encoders first; libx264 always works and is the CPU's.
const ENCODERS: [&str; 4] = ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"];

/// Each encoder's settings. Low latency (no B-frames, a keyframe every 60
/// frames), and a constant rate the tile's buffer can plan around. NVENC
/// holds no frames back either (`-delay 0`): a tile never catches up to
/// live (multiviewTuning.ts), so every frame held is delay kept for good.
fn encoder_args(encoder: &str) -> &'static [&'static str] {
    match encoder {
        "h264_nvenc" => &[
            "-preset",
            "p4",
            "-tune",
            "ll",
            "-zerolatency",
            "1",
            "-delay",
            "0",
            "-rc",
            "cbr",
            "-b:v",
            "8M",
            "-maxrate",
            "8M",
            "-bufsize",
            "8M",
            "-bf",
            "0",
            "-g",
            "60",
        ],
        "h264_qsv" => &[
            "-preset", "veryfast", "-b:v", "8M", "-maxrate", "8M", "-bufsize", "8M", "-bf", "0",
            "-g", "60",
        ],
        "h264_amf" => &[
            "-usage",
            "lowlatency",
            "-quality",
            "speed",
            "-rc",
            "cbr",
            "-b:v",
            "8M",
            "-maxrate",
            "8M",
            "-bufsize",
            "8M",
            "-bf",
            "0",
            "-g",
            "60",
        ],
        _ => &[
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-b:v",
            "6M",
            "-maxrate",
            "6M",
            "-bufsize",
            "3M",
            "-g",
            "60",
        ],
    }
}

/// The picture: at most 1080 lines, BT.709, NV12 (what every encoder above
/// takes). libplacebo tone maps HDR on the way; SDR goes through unchanged.
///
/// THE TAGS ARE SET ON THE FRAMES (`setparams`), not with the encoder's
/// -color_primaries and -color_trc: measured, those never reached the
/// H.264, which came out `bt709/unknown/unknown` and left the webview to
/// guess its primaries and transfer. The first HEVC tile's colours were
/// "pretty funky" and "real warm" (Adam, v0.9.112).
///
/// NO PEAK DETECTION (`peak_detect=0`). By default libplacebo measures each
/// frame's highlights and re-bends the tone curve every 20 frames, so a
/// fixed white (the score bug) dims when the picture brightens and comes
/// back when it darkens: "the whites keep fluctuating" (Adam, v0.9.113, on
/// an HDR10 1080p TNF feed). Off, the curve follows the stream's own HDR10
/// metadata and holds still.
fn video_filter(placebo: bool) -> &'static str {
    if placebo {
        "libplacebo=w=-2:h=min(1080\\,ih):colorspace=bt709:color_primaries=bt709:\
         color_trc=bt709:range=tv:peak_detect=0:format=nv12,\
         setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    } else {
        "scale=w=-2:h=min(1080\\,ih):out_color_matrix=bt709:out_range=tv,format=nv12,\
         setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    }
}

/// The conversion's arguments. Input and output are pipes, never a URL.
pub fn args(caps: &Caps) -> Vec<String> {
    let mut a: Vec<&str> = Vec::new();
    let decode: &[&str] = match caps.hwaccel {
        Some(h) => &["-hwaccel", h],
        None => &[],
    };
    a.extend_from_slice(&[
        "-hide_banner",
        "-nostats",
        // Each line tagged with its level, so the log can show the streams'
        // own descriptions (their colour tags) and every warning, and skip
        // the rest of what info prints (`shown`).
        "-loglevel",
        "level+info",
        // It is MPEG-TS: `sniff` just read its programme map.
        "-f",
        "mpegts",
        // A second to look at the stream rather than ffmpeg's default five.
        // Measured on a paced HEVC stream: first byte out at 4.8s with the
        // defaults, 0.2 to 0.8s with these.
        "-probesize",
        "4000000",
        "-analyzeduration",
        "1000000",
        // NOT +nobuffer: measured, it corrupts HEVC decoding (40 and 94
        // "Could not find ref" errors on two test streams, 0 without).
        "-fflags",
        "+genpts+discardcorrupt",
    ]);
    a.extend_from_slice(decode);
    a.extend_from_slice(&[
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        video_filter(caps.placebo),
        "-c:v",
        caps.encoder,
    ]);
    a.extend_from_slice(encoder_args(caps.encoder));
    a.extend_from_slice(&[
        // Stereo AAC whatever came in: AC-3, E-AC-3 and MP2 all play then.
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ac",
        "2",
        "-f",
        "mpegts",
        "-flush_packets",
        "1",
        "pipe:1",
    ]);
    a.into_iter().map(String::from).collect()
}

/// Where ffmpeg is: `BLAMMYTV_FFMPEG`, then beside the app, then the
/// bundle's `resources/`, the same places libmpv is looked for (mpv.rs).
fn locate() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("BLAMMYTV_FFMPEG") {
        return Ok(p.into());
    }
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from))
    {
        for p in [dir.join(name), dir.join("resources").join(name)] {
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    // `pnpm tauri dev` runs in src-tauri, where fetch-ffmpeg.mjs puts it.
    // Debug builds only: a release must not run whatever sits in the
    // directory it happened to be started from.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::current_dir().map(|d| d.join(name)) {
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(format!("{name} is missing beside the app"))
}

fn command(ffmpeg: &PathBuf) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg);
    cmd.kill_on_drop(true);
    // No console window flashing up for each tile.
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// Whether ffmpeg runs these arguments to completion, within ten seconds.
async fn works(ffmpeg: &PathBuf, args: &[&str]) -> bool {
    let run = command(ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    matches!(
        tokio::time::timeout(Duration::from_secs(10), run).await,
        Ok(Ok(s)) if s.success()
    )
}

/// Ask this machine's ffmpeg what it can do, with the conversion's own
/// options on a generated picture. The three questions are asked at once:
/// each is an ffmpeg start, and on Windows the first HEVC tile waited for
/// all of them in a row (first bytes after 4.3s on Adam's, v0.9.112).
async fn probe() -> Result<Caps, String> {
    let ffmpeg = locate()?;
    let (encoder, placebo, hwaccel) =
        future::join3(first_encoder(&ffmpeg), placebo(&ffmpeg), decoder(&ffmpeg)).await;
    let Some(encoder) = encoder else {
        // libx264 is in the build, so this is ffmpeg itself not running.
        return Err(format!(
            "{} does not run here",
            ffmpeg
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("ffmpeg")
        ));
    };
    Ok(Caps {
        ffmpeg,
        hwaccel,
        encoder,
        placebo,
    })
}

const LAVFI: [&str; 6] = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"];

/// The first encoder in ENCODERS that works here.
async fn first_encoder(ffmpeg: &PathBuf) -> Option<&'static str> {
    let head = LAVFI;
    let mut encoder = None;
    for e in ENCODERS {
        let mut a: Vec<&str> = head.to_vec();
        a.extend_from_slice(&[
            "color=black:s=256x256:r=30:d=0.2",
            "-vf",
            "format=nv12",
            "-c:v",
            e,
        ]);
        a.extend_from_slice(encoder_args(e));
        a.extend_from_slice(&["-f", "null", "-"]);
        if works(ffmpeg, &a).await {
            encoder = Some(e);
            break;
        }
    }
    encoder
}

/// Whether libplacebo opens the GPU here. `BLAMMYTV_MV_PLACEBO=0` says no
/// without asking, to compare a picture with and without it.
async fn placebo(ffmpeg: &PathBuf) -> bool {
    if std::env::var("BLAMMYTV_MV_PLACEBO").is_ok_and(|v| v == "0") {
        return false;
    }
    let mut a: Vec<&str> = LAVFI.to_vec();
    a.extend_from_slice(&[
        "testsrc2=s=64x64:d=0.1",
        "-vf",
        video_filter(true),
        "-f",
        "null",
        "-",
    ]);
    works(ffmpeg, &a).await
}

/// The first GPU decoder that decodes HEVC here: a generated clip, decoded
/// with its frames kept on the GPU (so a quiet fall back to the CPU does not
/// count as working) and then brought down, as the conversion does.
async fn decoder(ffmpeg: &PathBuf) -> Option<&'static str> {
    if HWACCELS.is_empty() {
        return None;
    }
    let clip = std::env::temp_dir().join(format!("blammytv-hevc-{}.ts", std::process::id()));
    let clip_arg = clip.to_string_lossy().to_string();
    let made = works(
        ffmpeg,
        &[
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=256x256:r=25:d=0.4",
            "-c:v",
            "libx265",
            "-x265-params",
            "log-level=error",
            "-f",
            "mpegts",
            &clip_arg,
        ],
    )
    .await;
    let mut found = None;
    if made {
        for (h, frames) in HWACCELS {
            let a = [
                "-hide_banner",
                "-loglevel",
                "error",
                "-hwaccel",
                h,
                "-hwaccel_output_format",
                frames,
                "-i",
                &clip_arg,
                "-vf",
                "hwdownload,format=nv12",
                "-f",
                "null",
                "-",
            ];
            if works(ffmpeg, &a).await {
                found = Some(h);
                break;
            }
        }
    }
    let _ = std::fs::remove_file(&clip);
    found
}

static CAPS: OnceCell<Result<Caps, String>> = OnceCell::const_new();

/// This machine's answer, asked once and kept: when the Multi-view tab
/// opens (`mv_convert_warm`), or on the first HEVC tile if that comes first.
pub async fn caps() -> Result<&'static Caps, String> {
    CAPS.get_or_init(|| async {
        let asked = std::time::Instant::now();
        let caps = probe().await;
        let took = asked.elapsed().as_millis();
        match &caps {
            Ok(c) => println!(
                "[mvproxy] HEVC conversion ({took}ms to ask): decoding {}, encoding on {}, {}",
                c.hwaccel
                    .map_or("on the CPU".to_string(), |h| format!("on {h}")),
                c.encoder,
                if c.placebo {
                    "tone mapping on the GPU"
                } else {
                    "no GPU tone mapping (HDR will look flat)"
                }
            ),
            Err(e) => println!("[mvproxy] HEVC conversion unavailable ({took}ms to ask): {e}"),
        }
        caps
    })
    .await
    .as_ref()
    .map_err(|e| e.clone())
}

/// ffmpeg processes running now, counted down when the process has actually
/// exited. A tile that goes must take its ffmpeg with it.
static RUNNING: AtomicUsize = AtomicUsize::new(0);

#[cfg(test)]
pub fn running() -> usize {
    RUNNING.load(Ordering::SeqCst)
}

/// Holds a conversion's process and tasks for as long as its tile reads.
/// Dropped when the tile goes: the feeding task is aborted, which drops the
/// provider's response and hands the connection back, and the process is
/// killed.
struct Running {
    child: Option<tokio::process::Child>,
    feed: tokio::task::AbortHandle,
    log: tokio::task::AbortHandle,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.feed.abort();
        self.log.abort();
        let Some(mut child) = self.child.take() else {
            return;
        };
        let _ = child.start_kill();
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
                rt.spawn(async move {
                    let _ = child.wait().await;
                    RUNNING.fetch_sub(1, Ordering::SeqCst);
                });
            }
            // Outside the proxy's runtime (never, in the app): the kill has
            // been sent and kill_on_drop repeats it.
            Err(_) => {
                RUNNING.fetch_sub(1, Ordering::SeqCst);
            }
        }
    }
}

/// Problems ffmpeg printed, the last few kept for a failure's reason.
/// Printed as they come, up to a limit: a bad stream can warn on every
/// packet.
const LOG_LINES: usize = 20;

/// What a line of ffmpeg's `level+info` log is worth.
#[derive(Debug, PartialEq, Eq)]
enum Said {
    /// A stream's description, in or out: codec, pixel format, and the
    /// colour tags a picture that looks wrong is diagnosed from.
    Stream(String),
    /// A warning or an error.
    Problem(String),
    /// The rest of what info prints.
    Quiet,
}

/// Lines come as "[info] ..." or "[hevc @ 0x..] [warning] ...".
fn said(line: &str) -> Said {
    for (tag, problem) in [
        ("[info] ", false),
        ("[warning] ", true),
        ("[error] ", true),
        ("[fatal] ", true),
        ("[panic] ", true),
    ] {
        if let Some(i) = line.find(tag) {
            let text = format!("{}{}", &line[..i], &line[i + tag.len()..])
                .trim()
                .to_string();
            return if problem {
                Said::Problem(text)
            } else if text.starts_with("Stream #") {
                Said::Stream(text)
            } else {
                Said::Quiet
            };
        }
    }
    Said::Problem(line.trim().to_string())
}

/// Start converting. `head` is what was read to sniff; `input` is the rest.
/// Resolves once ffmpeg has produced its first bytes, or with what ffmpeg
/// last said if it gave up first, so the tile can be told why.
pub async fn start<S>(
    caps: &Caps,
    head: Bytes,
    input: S,
) -> Result<impl Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static, String>
where
    S: Stream<Item = Bytes> + Send + 'static,
{
    let mut child = command(&caps.ffmpeg)
        .args(args(caps))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg did not start: {e}"))?;
    let (Some(mut stdin), Some(mut stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err("ffmpeg's pipes did not open".into());
    };

    // The provider's bytes, as they arrive. Ends when the provider does or
    // when ffmpeg stops reading; dropping stdin then lets ffmpeg finish.
    let feed = tokio::spawn(async move {
        if stdin.write_all(&head).await.is_err() {
            return;
        }
        let mut input = std::pin::pin!(input);
        while let Some(b) = input.next().await {
            if stdin.write_all(&b).await.is_err() {
                return;
            }
        }
    });
    let problems = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let keep = problems.clone();
    let log = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut printed = 0;
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            match said(&line) {
                Said::Stream(text) => println!("[mvproxy] ffmpeg: {text}"),
                Said::Problem(text) => {
                    if printed < LOG_LINES {
                        println!("[mvproxy] ffmpeg: {text}");
                        printed += 1;
                        if printed == LOG_LINES {
                            println!("[mvproxy] ffmpeg: (further problems not shown)");
                        }
                    }
                    if let Ok(mut s) = keep.lock() {
                        s.push_back(text);
                        if s.len() > 3 {
                            s.pop_front();
                        }
                    }
                }
                Said::Quiet => {}
            }
        }
    });

    let mut buf = vec![0u8; 64 * 1024];
    let first = tokio::time::timeout(Duration::from_secs(20), stdout.read(&mut buf)).await;
    let n = match first {
        Ok(Ok(n)) if n > 0 => n,
        Ok(_) => {
            // ffmpeg closed its output: it has exited or is about to. Its
            // last line is the reason.
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            let _ = tokio::time::timeout(Duration::from_millis(500), log).await;
            feed.abort();
            let last = problems.lock().ok().and_then(|s| s.back().cloned());
            return Err(last.unwrap_or_else(|| "ffmpeg stopped before any output".into()));
        }
        Err(_) => {
            feed.abort();
            log.abort();
            return Err("ffmpeg produced nothing for 20 seconds".into());
        }
    };
    buf.truncate(n);
    RUNNING.fetch_add(1, Ordering::SeqCst);
    let running = Running {
        child: Some(child),
        feed: feed.abort_handle(),
        log: log.abort_handle(),
    };
    let rest = stream::unfold(Some((stdout, running)), |state| async move {
        let (mut out, running) = state?;
        let mut buf = vec![0u8; 64 * 1024];
        match out.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Bytes::from(buf)), Some((out, running))))
            }
            Err(e) => Some((Err(e), None)),
        }
    });
    Ok(stream::once(async move { Ok(Bytes::from(buf)) }).chain(rest))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One 188-byte packet carrying a PSI section, stuffed with 0xff.
    fn psi(pid: u16, section: &[u8]) -> Vec<u8> {
        let mut p = vec![0xffu8; TS];
        p[0] = SYNC;
        p[1] = 0x40 | ((pid >> 8) as u8 & 0x1f);
        p[2] = pid as u8;
        p[3] = 0x10; // payload only
        p[4] = 0; // pointer field
        p[5..5 + section.len()].copy_from_slice(section);
        p
    }

    /// A PSI section with its length filled in and a dummy CRC.
    fn table(table_id: u8, body: &[u8]) -> Vec<u8> {
        let len = body.len() + 4;
        let mut s = vec![table_id, 0xb0 | ((len >> 8) as u8 & 0x0f), len as u8];
        s.extend_from_slice(body);
        s.extend_from_slice(&[0, 0, 0, 0]);
        s
    }

    fn pat_packet(pmt: u16) -> Vec<u8> {
        // ts id, version, section 0 of 0, then program 1 -> pmt
        let body = [0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (pmt >> 8) as u8, pmt as u8];
        psi(0, &table(0x00, &body))
    }

    fn pmt_packet(pmt: u16, types: &[u8]) -> Vec<u8> {
        // program 1, version, sections, PCR PID 0x100, no programme info
        let mut body = vec![0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0x00];
        for (i, t) in types.iter().enumerate() {
            body.extend_from_slice(&[*t, 0xe1, i as u8, 0xf0, 0x00]);
        }
        psi(pmt, &table(0x02, &body))
    }

    fn filler() -> Vec<u8> {
        let mut p = vec![0u8; TS];
        p[0] = SYNC;
        p[1] = 0x1f;
        p[2] = 0xff; // null PID
        p[3] = 0x10;
        p
    }

    #[test]
    fn finds_hevc_in_the_programme_map() {
        let s = [
            filler(),
            pat_packet(0x1000),
            pmt_packet(0x1000, &[0x24, 0x0f]),
        ]
        .concat();
        assert_eq!(sniff(&s), Sniff::Hevc);
    }

    #[test]
    fn h264_is_left_alone() {
        let s = [pat_packet(0x1000), pmt_packet(0x1000, &[0x1b, 0x0f])].concat();
        assert_eq!(sniff(&s), Sniff::Other);
    }

    #[test]
    fn waits_for_the_map_and_reads_past_a_partial_packet() {
        let pat = pat_packet(0x42);
        assert_eq!(sniff(&pat), Sniff::NeedMore);
        // Joined mid-packet: the first 100 bytes are the tail of another.
        let s = [vec![0u8; 100], pat, pmt_packet(0x42, &[0x24])].concat();
        assert_eq!(sniff(&s), Sniff::Hevc);
    }

    #[test]
    fn a_map_before_its_pat_is_not_read() {
        // The PMT's PID is only known from the PAT.
        let s = [pmt_packet(0x42, &[0x24]), pat_packet(0x42)].concat();
        assert_eq!(sniff(&s), Sniff::NeedMore);
    }

    #[test]
    fn reads_past_an_adaptation_field() {
        let mut pmt = pmt_packet(0x42, &[0x24]);
        // Re-lay the payload after a 7-byte adaptation field.
        let payload = pmt[4..TS - 8].to_vec();
        pmt[3] = 0x30;
        pmt[4] = 7;
        pmt[5..12].fill(0xff);
        pmt[12..12 + payload.len()].copy_from_slice(&payload);
        assert_eq!(sniff(&[pat_packet(0x42), pmt].concat()), Sniff::Hevc);
    }

    #[test]
    fn what_is_not_a_transport_stream_is_left_alone() {
        let text = b"#EXTM3U\n#EXT-X-VERSION:3\n".repeat(40);
        assert_eq!(sniff(&text), Sniff::Other);
        assert_eq!(sniff(b"#EXTM3U"), Sniff::NeedMore);
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    #[test]
    fn an_ffmpeg_that_will_not_start_says_so() {
        let caps = Caps {
            ffmpeg: "/nowhere/ffmpeg".into(),
            hwaccel: None,
            encoder: "libx264",
            placebo: false,
        };
        let why = block_on(start(&caps, Bytes::new(), stream::empty()))
            .err()
            .expect("started a missing ffmpeg");
        assert!(why.starts_with("ffmpeg did not start"), "{why}");
    }

    #[test]
    fn a_stream_ffmpeg_cannot_read_is_refused_with_its_words() {
        // The real ffmpeg (BLAMMYTV_FFMPEG on CI), fed something that is not
        // video: the reason is ffmpeg's own last line, not a timeout.
        let why = block_on(async {
            let caps = caps().await.expect("no ffmpeg: set BLAMMYTV_FFMPEG");
            start(
                caps,
                Bytes::from_static(b"not a stream at all"),
                stream::empty(),
            )
            .await
            .err()
            .expect("converted nothing into something")
        });
        assert!(!why.is_empty() && !why.contains("20 seconds"), "{why}");
    }

    #[test]
    fn shows_the_streams_and_the_problems_and_nothing_else() {
        assert_eq!(
            said("[info]   Stream #0:0[0x100]: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160"),
            Said::Stream("Stream #0:0[0x100]: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160".into())
        );
        assert_eq!(
            said("[hevc @ 0x5607] [error] Could not find ref with POC 50"),
            Said::Problem("[hevc @ 0x5607] Could not find ref with POC 50".into())
        );
        assert_eq!(said("[info] Input #0, mpegts, from 'pipe:0':"), Said::Quiet);
        assert_eq!(said("[info]   Duration: N/A, start: 1.434667"), Said::Quiet);
        // Untagged (a crash, a loader): shown.
        assert_eq!(
            said("Assertion failed"),
            Said::Problem("Assertion failed".into())
        );
    }

    #[test]
    fn the_arguments_never_carry_a_url_and_use_what_was_found() {
        let caps = Caps {
            ffmpeg: "ffmpeg".into(),
            hwaccel: Some("d3d11va"),
            encoder: "h264_nvenc",
            placebo: true,
        };
        let a = args(&caps).join(" ");
        assert!(!a.contains("http"), "{a}");
        assert!(a.contains("-hwaccel d3d11va -i pipe:0"), "{a}");
        assert!(
            a.contains("-f mpegts -probesize") && !a.contains("nobuffer"),
            "{a}"
        );
        assert!(a.contains("-delay 0"), "{a}");
        assert!(a.contains("-i pipe:0") && a.ends_with("pipe:1"), "{a}");
        assert!(a.contains("-c:v h264_nvenc -preset p4"), "{a}");
        assert!(
            a.contains("libplacebo=") && a.contains("color_trc=bt709"),
            "{a}"
        );
        let cpu = args(&Caps {
            placebo: false,
            hwaccel: None,
            encoder: "libx264",
            ..caps
        })
        .join(" ");
        assert!(!cpu.contains("-hwaccel"), "{cpu}");
        assert!(
            cpu.contains("scale=w=-2:h=min(1080\\,ih)") && !cpu.contains("libplacebo"),
            "{cpu}"
        );
        assert!(a.contains(":peak_detect=0:"), "{a}");
        // Both pictures carry every BT.709 tag on the frames themselves.
        for chain in [&a, &cpu] {
            assert!(
                chain.contains(
                    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
                ),
                "{chain}"
            );
        }
        assert!(cpu.contains("-tune zerolatency"), "{cpu}");
    }
}
