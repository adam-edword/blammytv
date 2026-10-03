//! Multi-view's sound, played from this process instead of the webview's.
//!
//! WHY IT EXISTS. Adam streams the app to Discord (a window share with
//! sound). Stream, Live TV and Sports play through libmpv inside
//! BlammyTV.exe, so Discord's per-app capture hears them. A multi-view tile
//! is a `<video>` in the webview, and WebView2 renders its audio in its own
//! process (msedgewebview2.exe, "Microsoft Edge WebView2" in the volume
//! mixer), which that capture misses: viewers got silence while Adam heard it
//! locally. Microsoft tracks it as a feature request with no fix
//! (MicrosoftEdge/WebView2Feedback#2236). So the sound tile's audio leaves the
//! webview as samples and is played here.
//!
//! THE SHAPE. The frontend (features/live/mvAudio.ts) takes a copy of the
//! sound tile's audio, applies the volume, and a Worker POSTs it, about 20ms a
//! batch, to the loopback listener below: interleaved f32 little-endian stereo
//! frames, at the rate `open` returned. The listener feeds a jitter buffer and
//! the output stream (mvaudio_out.rs, cpal) drains it.
//!
//! ITS OWN LISTENER, NOT THE STREAM PROXY'S PORT. Chromium allows six HTTP/1.1
//! connections per host and port, and four tiles' streams plus an hls.js burst
//! already live on the proxy's. Its own random port, a fresh 128-bit token in
//! the path, and the same checks as mvproxy.rs: bound to 127.0.0.1 only, the
//! Host header exactly `127.0.0.1:{port}`, and a bare reply to anything that
//! is not about the live route. Only the replies about it carry CORS.
//!
//! NO CPAL IN THIS FILE, so the host crate (scripts/mvproxy-host) can compile
//! it and run the tests below without an audio device. The output is handed in
//! as a function; the app passes mvaudio_out::start on Windows.
//!
//! NEVER LOGS THE TOKEN, and never a sample.

use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use futures_util::future::{select, Either};
use http_body_util::{BodyExt, Empty, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use serde::Serialize;

type Body = Empty<Bytes>;

/// Bytes in one stereo frame: two f32.
const FRAME_BYTES: usize = 8;

/// The most one POST may carry. The frontend sends about 20ms (7.5 KiB at
/// 48 kHz), so this is room for a Worker that fell behind, and nothing like
/// room for a memory problem.
pub const MAX_BODY: usize = 64 * 1024;

/// How long a request may take to send its body. A batch is a few KiB on
/// loopback; a client that sends less than that in this long is not one.
const BODY_TIMEOUT: Duration = Duration::from_secs(2);

/// How long a connection may take to send a request head, as in mvproxy.rs.
const HEADER_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(1)
} else {
    Duration::from_secs(10)
};

// ------------------------------------------------------------ jitter buffer

/// What the buffer waits for before it starts, and again after an underrun.
/// The frontend sends a batch every 20ms, so 30ms is two batches in hand.
pub const PREFILL_MS: u32 = 30;
/// Where it trims back to when it has built up too much.
pub const TARGET_MS: u32 = 40;
/// More than this buffered means the clocks drifted or a stall ended in a
/// burst: the oldest audio goes, down to TARGET_MS, so the delay does not
/// stay where the stall left it.
pub const CEILING_MS: u32 = 100;

/// What `mv_audio_stats` says, for working out on a real machine why it
/// sounds the way it does.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub open: bool,
    pub rate: u32,
    /// Audio waiting to play, in milliseconds.
    pub buffered_ms: u32,
    /// Times the output wanted more than there was. Each one is a gap.
    pub underruns: u64,
    /// Times the buffer passed CEILING_MS and was cut back. Each one is a skip.
    pub overruns: u64,
    /// The audio those cuts threw away, in milliseconds.
    pub dropped_ms: u64,
    /// Batches received.
    pub chunks: u64,
}

/// Interleaved stereo frames in, frames out to the output callback. Pure: no
/// clock, no device, so the tests below drive it with plain numbers.
///
/// It plays once PREFILL_MS is buffered. On an underrun it plays what is left,
/// then silence, and waits for PREFILL_MS again rather than playing each
/// arriving scrap (that is the crackle loop). Past CEILING_MS it drops the
/// oldest audio down to TARGET_MS.
pub struct Jitter {
    q: VecDeque<f32>,
    playing: bool,
    rate: u32,
    /// The three thresholds, in samples (two a frame).
    prefill: usize,
    target: usize,
    ceiling: usize,
    underruns: u64,
    overruns: u64,
    dropped: u64,
    chunks: u64,
}

fn samples_in(rate: u32, ms: u32) -> usize {
    rate as usize * ms as usize / 1000 * 2
}

impl Jitter {
    pub fn new(rate: u32) -> Self {
        Self::tuned(rate, PREFILL_MS, TARGET_MS, CEILING_MS)
    }

    pub fn tuned(rate: u32, prefill_ms: u32, target_ms: u32, ceiling_ms: u32) -> Self {
        debug_assert!(prefill_ms <= target_ms && target_ms < ceiling_ms);
        Jitter {
            q: VecDeque::new(),
            playing: false,
            rate,
            prefill: samples_in(rate, prefill_ms),
            target: samples_in(rate, target_ms),
            ceiling: samples_in(rate, ceiling_ms),
            underruns: 0,
            overruns: 0,
            dropped: 0,
            chunks: 0,
        }
    }

    /// Take in a batch. Whole frames only: a trailing lone sample is dropped,
    /// so the channels can never swap. A sample that is not a number, or is
    /// past full scale, is made safe here: whatever reaches the speakers was
    /// sent by a page, and a NaN or a 1e30 is a loud noise.
    pub fn push(&mut self, samples: &[f32]) {
        let whole = samples.len() & !1;
        self.chunks += 1;
        self.q.extend(samples[..whole].iter().map(|&s| {
            if s.is_finite() {
                s.clamp(-1.0, 1.0)
            } else {
                0.0
            }
        }));
        if self.q.len() > self.ceiling {
            let cut = (self.q.len() - self.target) & !1;
            self.q.drain(..cut);
            self.overruns += 1;
            self.dropped += (cut / 2) as u64;
        }
    }

    /// Fill the output callback's buffer.
    pub fn pull(&mut self, out: &mut [f32]) {
        if !self.playing {
            if self.q.len() < self.prefill {
                out.fill(0.0);
                return;
            }
            self.playing = true;
        }
        let n = out.len().min(self.q.len());
        for (o, s) in out.iter_mut().zip(self.q.drain(..n)) {
            *o = s;
        }
        if n < out.len() {
            out[n..].fill(0.0);
            self.playing = false;
            self.underruns += 1;
        }
    }

    pub fn stats(&self) -> Stats {
        let frames = (self.q.len() / 2) as u64;
        Stats {
            open: true,
            rate: self.rate,
            buffered_ms: (frames * 1000 / self.rate.max(1) as u64) as u32,
            underruns: self.underruns,
            overruns: self.overruns,
            dropped_ms: self.dropped * 1000 / self.rate.max(1) as u64,
            chunks: self.chunks,
        }
    }
}

/// A POST's body as samples, or why it is refused: whole stereo frames of f32
/// little-endian, none more than MAX_BODY. An empty body is a batch of no
/// frames, which is fine.
pub fn decode(body: &[u8]) -> Result<Vec<f32>, &'static str> {
    if body.len() > MAX_BODY {
        return Err("too large");
    }
    if body.len() % FRAME_BYTES != 0 {
        return Err("not whole stereo frames");
    }
    Ok(body
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

// ---------------------------------------------------------------- the sink

/// What the listener and the output share: the buffer between them, and
/// whether the output has died.
pub struct Shared {
    jitter: Mutex<Jitter>,
    failed: AtomicBool,
}

impl Shared {
    fn new() -> Self {
        Shared {
            jitter: Mutex::new(Jitter::new(48_000)),
            failed: AtomicBool::new(false),
        }
    }

    // A poisoned lock means a panic with it held, and the audio thread is
    // the last place to panic over that: carry on with what is there.
    fn jitter(&self) -> std::sync::MutexGuard<'_, Jitter> {
        self.jitter.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The output opened and this is its rate. Before it plays.
    pub fn set_rate(&self, rate: u32) {
        *self.jitter() = Jitter::new(rate);
    }

    /// The output callback.
    pub fn pull(&self, out: &mut [f32]) {
        self.jitter().pull(out);
    }

    /// The output died (its device went away). The listener answers 503 from
    /// here on, and the frontend, hearing that, plays the sound itself again.
    pub fn fail(&self) {
        self.failed.store(true, Ordering::SeqCst);
    }

    fn failed(&self) -> bool {
        self.failed.load(Ordering::SeqCst)
    }
}

/// An open output stream. Dropping it stops the stream and frees the device.
pub struct Output {
    pub rate: u32,
    _hold: Box<dyn Send>,
}

impl Output {
    pub fn new(rate: u32, hold: impl Send + 'static) -> Self {
        Output {
            rate,
            _hold: Box::new(hold),
        }
    }
}

/// What `mv_audio_open` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Opened {
    pub url: String,
    pub rate: u32,
}

/// The output and the listener, up together and down together.
pub struct Sink {
    opened: Opened,
    shared: Arc<Shared>,
    stop: tokio::sync::watch::Sender<bool>,
    listener: Option<JoinHandle<()>>,
    // Last, so the listener has stopped answering before the device goes.
    _output: Output,
}

impl Sink {
    /// Open the output first, so a machine with no device leaves no listener
    /// behind, then bind a loopback port of its own and start answering.
    pub fn start(
        output: impl FnOnce(Arc<Shared>) -> Result<Output, String>,
    ) -> Result<Sink, String> {
        let shared = Arc::new(Shared::new());
        let output = output(shared.clone())?;
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .map_err(|e| format!("audio listener could not bind: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let mut raw = [0u8; 16];
        getrandom::fill(&mut raw).map_err(|e| format!("no randomness: {e}"))?;
        let token: String = raw.iter().map(|b| format!("{b:02x}")).collect();
        let (stop, stopped) = tokio::sync::watch::channel(false);
        let handle = {
            let (shared, token) = (shared.clone(), token.clone());
            std::thread::Builder::new()
                .name("mvaudio".into())
                .spawn(move || {
                    // One thread is plenty: a batch every 20ms.
                    let rt = match tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                    {
                        Ok(rt) => rt,
                        Err(e) => {
                            eprintln!("[mvaudio] no runtime: {e}");
                            return;
                        }
                    };
                    rt.block_on(serve(listener, port, token, shared, stopped));
                })
                .map_err(|e| e.to_string())?
        };
        println!(
            "[mvaudio] listening on 127.0.0.1:{port}, output at {} Hz",
            output.rate
        );
        Ok(Sink {
            opened: Opened {
                url: format!("http://127.0.0.1:{port}/a/{token}"),
                rate: output.rate,
            },
            shared,
            stop,
            listener: Some(handle),
            _output: output,
        })
    }

    pub fn opened(&self) -> Opened {
        self.opened.clone()
    }

    pub fn stats(&self) -> Stats {
        self.shared.jitter().stats()
    }

    pub fn failed(&self) -> bool {
        self.shared.failed()
    }
}

impl Drop for Sink {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
        if let Some(h) = self.listener.take() {
            let _ = h.join();
        }
    }
}

// The one sink, when there is one.
static SINK: Mutex<Option<Sink>> = Mutex::new(None);

fn slot() -> std::sync::MutexGuard<'static, Option<Sink>> {
    SINK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Open the output and the listener, or hand back the open ones. A sink whose
/// output has died is not reused: opening again is how the frontend gets a
/// stream on whatever the default device is now.
pub fn open(output: impl FnOnce(Arc<Shared>) -> Result<Output, String>) -> Result<Opened, String> {
    let mut slot = slot();
    if let Some(s) = slot.as_ref() {
        if !s.failed() {
            return Ok(s.opened());
        }
        *slot = None;
    }
    let sink = Sink::start(output)?;
    let opened = sink.opened();
    *slot = Some(sink);
    Ok(opened)
}

/// Stop the stream and the listener and free the device. Nothing open is
/// fine.
pub fn close() {
    let sink = slot().take();
    drop(sink);
}

pub fn stats() -> Stats {
    slot().as_ref().map(Sink::stats).unwrap_or_default()
}

// ------------------------------------------------------------- the listener

async fn serve(
    listener: std::net::TcpListener,
    port: u16,
    token: String,
    shared: Arc<Shared>,
    mut stopped: tokio::sync::watch::Receiver<bool>,
) {
    let listener = match tokio::net::TcpListener::from_std(listener) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[mvaudio] listener: {e}");
            return;
        }
    };
    let token: Arc<str> = token.into();
    let mut http = hyper::server::conn::http1::Builder::new();
    http.timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT);
    loop {
        let accepted = {
            let accept = Box::pin(listener.accept());
            let stop = Box::pin(stopped.changed());
            match select(accept, stop).await {
                Either::Left((a, _)) => a,
                // Told to stop, or the sink is gone: either way, done. The
                // runtime goes with this and every connection it holds.
                Either::Right(_) => return,
            }
        };
        let Ok((tcp, _)) = accepted else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        let http = http.clone();
        let (token, shared) = (token.clone(), shared.clone());
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| {
                handle(req, port, token.clone(), shared.clone())
            });
            let _ = http
                .serve_connection(hyper_util::rt::TokioIo::new(tcp), svc)
                .await;
        });
    }
}

/// A bare reply: no CORS. A wrong Host or token, or a method nobody sends,
/// gets one, so a web page in any browser on this machine can't read that the
/// listener is here (as mvproxy.rs's N4).
fn reply(status: StatusCode) -> Response<Body> {
    let mut res = Response::new(Body::new());
    *res.status_mut() = status;
    res
}

/// A reply about the live route, which the Worker reads: CORS on.
fn route_reply(status: StatusCode) -> Response<Body> {
    let mut res = reply(status);
    let h = res.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

/// Equal strings, in time that does not say where they first differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

async fn handle(
    req: Request<Incoming>,
    port: u16,
    token: Arc<str>,
    shared: Arc<Shared>,
) -> Result<Response<Body>, Infallible> {
    let host_ok = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h == format!("127.0.0.1:{port}"));
    if !host_ok {
        return Ok(reply(StatusCode::MISDIRECTED_REQUEST));
    }
    let on_route = req
        .uri()
        .path()
        .strip_prefix("/a/")
        .is_some_and(|t| same(t, &token));
    if !on_route {
        return Ok(reply(StatusCode::NOT_FOUND));
    }
    // The frontend's POST is a CORS "simple" request (text/plain), so no
    // preflight is expected. Answered anyway, as mvproxy.rs does for its GET:
    // a webview that asked would otherwise lose the sound without a word.
    if req.method() == Method::OPTIONS {
        let mut res = route_reply(StatusCode::NO_CONTENT);
        let h = res.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("POST, OPTIONS"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("*"),
        );
        h.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("600"),
        );
        return Ok(res);
    }
    if req.method() != Method::POST {
        return Ok(reply(StatusCode::METHOD_NOT_ALLOWED));
    }
    // The output died: say so, and the page plays the sound itself again.
    if shared.failed() {
        return Ok(route_reply(StatusCode::SERVICE_UNAVAILABLE));
    }
    let body = Limited::new(req.into_body(), MAX_BODY);
    let bytes = match tokio::time::timeout(BODY_TIMEOUT, body.collect()).await {
        Ok(Ok(all)) => all.to_bytes(),
        // Over MAX_BODY, cut off, or too slow.
        _ => return Ok(route_reply(StatusCode::BAD_REQUEST)),
    };
    match decode(&bytes) {
        Ok(samples) => {
            shared.jitter().push(&samples);
            Ok(route_reply(StatusCode::NO_CONTENT))
        }
        Err(_) => Ok(route_reply(StatusCode::BAD_REQUEST)),
    }
}

// -------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    //! The buffer with plain numbers, and the listener driven for real: raw
    //! HTTP on loopback, and what is asserted is what a webview would see.
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpStream;

    // ---- the jitter buffer

    /// A stereo ramp, `n` frames long, whose left sample says where in the
    /// stream it is (`from` + frame number) and whose right is its negative.
    fn ramp(from: usize, n: usize) -> Vec<f32> {
        (from..from + n)
            .flat_map(|i| [i as f32 / 100_000.0, -(i as f32) / 100_000.0])
            .collect()
    }

    /// 1 kHz, so a frame is a millisecond and the thresholds read as frames:
    /// prefill 30, target 40, ceiling 100.
    fn jitter() -> Jitter {
        Jitter::tuned(1000, 30, 40, 100)
    }

    #[test]
    fn it_waits_for_the_prefill_and_plays_silence_meanwhile() {
        let mut j = jitter();
        j.push(&ramp(0, 29));
        let mut out = [9.0f32; 8];
        j.pull(&mut out);
        assert_eq!(out, [0.0; 8], "played before it had 30ms");
        j.push(&ramp(29, 1));
        let mut out = [9.0f32; 8];
        j.pull(&mut out);
        assert_eq!(out.to_vec(), ramp(0, 4), "the first frames, in order");
        assert_eq!(
            j.stats().underruns,
            0,
            "waiting to start is not an underrun"
        );
    }

    #[test]
    fn an_underrun_plays_what_is_left_then_waits_for_the_prefill_again() {
        let mut j = jitter();
        j.push(&ramp(0, 30));
        let mut out = vec![9.0f32; 40 * 2];
        j.pull(&mut out);
        assert_eq!(out[..60].to_vec(), ramp(0, 30), "what there was");
        assert!(out[60..].iter().all(|&s| s == 0.0), "then silence");
        assert_eq!(j.stats().underruns, 1);

        // Ten more frames is not 30ms: no playing a scrap at a time. Pulled
        // again and again, it is still one underrun.
        j.push(&ramp(30, 10));
        for _ in 0..5 {
            let mut out = [9.0f32; 8];
            j.pull(&mut out);
            assert_eq!(out, [0.0; 8], "crackled while refilling");
        }
        assert_eq!(j.stats().underruns, 1, "the wait counted again");

        j.push(&ramp(40, 20));
        let mut out = [9.0f32; 4];
        j.pull(&mut out);
        assert_eq!(out.to_vec(), ramp(30, 2), "plays on from where it was");
    }

    #[test]
    fn past_the_ceiling_the_oldest_goes_and_the_newest_stays() {
        let mut j = jitter();
        j.push(&ramp(0, 90));
        assert_eq!(j.stats().overruns, 0, "90ms is under the ceiling");
        j.push(&ramp(90, 30)); // 120ms
        let s = j.stats();
        assert_eq!((s.overruns, s.buffered_ms, s.dropped_ms), (1, 40, 80));
        // The 40 frames left are the newest 40.
        let mut out = vec![0.0f32; 40 * 2];
        j.pull(&mut out);
        assert_eq!(out, ramp(80, 40));
    }

    #[test]
    fn a_ceiling_exactly_met_is_not_an_overrun() {
        let mut j = jitter();
        j.push(&ramp(0, 100));
        assert_eq!(j.stats().overruns, 0);
        j.push(&ramp(100, 1));
        assert_eq!(j.stats().overruns, 1);
    }

    #[test]
    fn chunks_and_pulls_of_odd_sizes_come_out_whole_and_in_order() {
        let mut j = Jitter::tuned(1000, 30, 40, 100_000);
        let mut all = Vec::new();
        let mut at = 0;
        for size in [1, 7, 3, 64, 5, 13, 2, 41, 9] {
            j.push(&ramp(at, size));
            all.extend(ramp(at, size));
            at += size;
        }
        let mut got = Vec::new();
        // Pulls that are not the chunks' size, nor each other's.
        for size in [6, 10, 22, 2, 50, 4, 8, 16] {
            let mut out = vec![0.0f32; size];
            j.pull(&mut out);
            got.extend(out);
        }
        assert_eq!(got, all[..got.len()], "reordered or lost a sample");
        assert_eq!(got.len(), 118, "the whole of it came out");
    }

    #[test]
    fn a_trailing_lone_sample_is_dropped_so_the_channels_cannot_swap() {
        let mut j = jitter();
        let mut batch = ramp(0, 40);
        batch.push(0.5); // half a frame
        j.push(&batch);
        j.push(&ramp(40, 20));
        let mut out = vec![0.0f32; 60 * 2];
        j.pull(&mut out);
        assert_eq!(out, ramp(0, 60));
    }

    #[test]
    fn what_a_speaker_must_never_get_is_made_safe() {
        let mut j = jitter();
        let mut bad = ramp(0, 40);
        bad[0] = f32::NAN;
        bad[1] = f32::INFINITY;
        bad[2] = 1e30;
        bad[3] = -7.0;
        j.push(&bad);
        let mut out = [9.0f32; 4];
        j.pull(&mut out);
        assert_eq!(out, [0.0, 0.0, 1.0, -1.0]);
    }

    #[test]
    fn stats_say_what_is_buffered_in_milliseconds() {
        let mut j = Jitter::new(48_000);
        j.push(&ramp(0, 960)); // 20ms
        let s = j.stats();
        assert_eq!((s.buffered_ms, s.chunks, s.rate), (20, 1, 48_000));
    }

    // ---- the request's body

    #[test]
    fn decode_takes_whole_frames_up_to_the_cap() {
        let frames: Vec<u8> = [0.25f32, -0.5, 1.0, 0.0]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        assert_eq!(decode(&frames).unwrap(), vec![0.25, -0.5, 1.0, 0.0]);
        assert_eq!(decode(&[]).unwrap(), Vec::<f32>::new());
        assert!(decode(&vec![0u8; MAX_BODY]).is_ok(), "exactly the cap");
        assert!(decode(&vec![0u8; MAX_BODY + FRAME_BYTES]).is_err());
        for odd in [1, 4, 7, 9, 12] {
            assert!(decode(&vec![0u8; odd]).is_err(), "{odd} bytes");
        }
    }

    // ---- the listener

    fn fake_output(shared: Arc<Shared>) -> Result<Output, String> {
        shared.set_rate(48_000);
        Ok(Output::new(48_000, ()))
    }

    /// One raw request on a fresh connection: the status, the headers
    /// (lowercased names), the body's length.
    fn request(
        url: &str,
        method: &str,
        path: Option<&str>,
        host: Option<&str>,
        body: &[u8],
    ) -> (u16, std::collections::HashMap<String, String>) {
        let rest = url.strip_prefix("http://").unwrap();
        let (addr, own_path) = rest.split_at(rest.find('/').unwrap());
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        write!(
            s,
            "{method} {} HTTP/1.1\r\nHost: {}\r\nOrigin: http://tauri.localhost\r\n\
             Content-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            path.unwrap_or(own_path),
            host.unwrap_or(addr),
            body.len()
        )
        .unwrap();
        // The listener may answer before it has read all of an oversized body
        // and close: a reset on the write is the reply being early.
        let _ = s.write_all(body);
        let mut r = BufReader::new(s);
        let mut status = String::new();
        r.read_line(&mut status).unwrap();
        let code = status.split_whitespace().nth(1).unwrap().parse().unwrap();
        let mut headers = std::collections::HashMap::new();
        loop {
            let mut h = String::new();
            r.read_line(&mut h).unwrap();
            let h = h.trim_end();
            if h.is_empty() {
                break;
            }
            let (k, v) = h.split_once(':').unwrap();
            headers.insert(k.to_ascii_lowercase(), v.trim().to_string());
        }
        let mut rest = Vec::new();
        let _ = r.read_to_end(&mut rest);
        assert!(rest.is_empty(), "a reply with a body: {rest:?}");
        (code, headers)
    }

    fn bytes_of(samples: &[f32]) -> Vec<u8> {
        samples.iter().flat_map(|f| f.to_le_bytes()).collect()
    }

    fn post(url: &str, samples: &[f32]) -> u16 {
        request(url, "POST", None, None, &bytes_of(samples)).0
    }

    #[test]
    fn a_batch_is_answered_204_with_cors_and_reaches_the_buffer() {
        let sink = Sink::start(fake_output).unwrap();
        let opened = sink.opened();
        assert_eq!(opened.rate, 48_000);
        assert!(
            opened.url.starts_with("http://127.0.0.1:"),
            "{}",
            opened.url
        );
        let (code, h) = request(&opened.url, "POST", None, None, &bytes_of(&ramp(0, 960)));
        assert_eq!(code, 204);
        assert_eq!(
            h.get("access-control-allow-origin").map(String::as_str),
            Some("*")
        );
        let s = sink.stats();
        assert_eq!((s.chunks, s.buffered_ms), (1, 20));
        // The frames are the ones sent, in order.
        assert_eq!(post(&opened.url, &ramp(960, 960)), 204);
        let mut out = vec![0.0f32; 8];
        sink.shared.pull(&mut out);
        assert_eq!(out, ramp(0, 4));
    }

    #[test]
    fn a_wrong_token_is_a_bare_404_and_nothing_is_taken() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        let base = url.rsplit_once('/').unwrap().0.to_string();
        let wrong = format!("{base}/{}", "0".repeat(32));
        let (code, h) = request(&wrong, "POST", None, None, &bytes_of(&ramp(0, 10)));
        assert_eq!(code, 404);
        assert!(
            !h.contains_key("access-control-allow-origin"),
            "a bare reply"
        );
        // A prefix of the right token, and the right one with something after.
        let short = &url[..url.len() - 1];
        assert_eq!(
            request(short, "POST", None, None, &bytes_of(&ramp(0, 10))).0,
            404
        );
        let long = format!("{url}/x");
        assert_eq!(
            request(&long, "POST", None, None, &bytes_of(&ramp(0, 10))).0,
            404
        );
        assert_eq!(sink.stats().chunks, 0);
    }

    #[test]
    fn a_rebound_hostname_is_refused_before_the_token_is_looked_at() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        let body = bytes_of(&ramp(0, 10));
        for host in ["evil.example", "localhost:80", "127.0.0.1", "127.0.0.1:1"] {
            let (code, h) = request(&url, "POST", None, Some(host), &body);
            assert_eq!(code, 421, "Host: {host}");
            assert!(!h.contains_key("access-control-allow-origin"));
        }
        assert_eq!(sink.stats().chunks, 0);
    }

    #[test]
    fn a_body_that_is_not_whole_frames_or_is_too_big_is_a_400() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        for len in [1usize, 4, 7, 12, 4099] {
            let (code, h) = request(&url, "POST", None, None, &vec![0u8; len]);
            assert_eq!(code, 400, "{len} bytes");
            assert_eq!(
                h.get("access-control-allow-origin").map(String::as_str),
                Some("*")
            );
        }
        let (code, _) = request(&url, "POST", None, None, &vec![0u8; MAX_BODY + FRAME_BYTES]);
        assert_eq!(code, 400, "past the cap");
        assert_eq!(sink.stats().chunks, 0, "a refused batch is not taken");
        // The cap itself, and an empty batch, are fine.
        assert_eq!(
            request(&url, "POST", None, None, &vec![0u8; MAX_BODY]).0,
            204
        );
        assert_eq!(request(&url, "POST", None, None, &[]).0, 204);
    }

    #[test]
    fn only_post_is_taken_and_options_is_answered_for_a_preflight() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        for method in ["GET", "PUT", "DELETE"] {
            let (code, h) = request(&url, method, None, None, &[]);
            assert_eq!(code, 405, "{method}");
            assert!(!h.contains_key("access-control-allow-origin"));
        }
        let (code, h) = request(&url, "OPTIONS", None, None, &[]);
        assert_eq!(code, 204);
        assert_eq!(
            h.get("access-control-allow-origin").map(String::as_str),
            Some("*")
        );
        assert!(h["access-control-allow-methods"].contains("POST"));
        assert_eq!(sink.stats().chunks, 0);
    }

    #[test]
    fn samples_a_speaker_must_not_get_are_made_safe_end_to_end() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        let mut batch = ramp(0, 1500);
        batch[0] = f32::NAN;
        batch[1] = 3.5;
        assert_eq!(post(&url, &batch), 204);
        let mut out = [9.0f32; 4];
        sink.shared.pull(&mut out);
        assert_eq!(out[..2], [0.0, 1.0]);
    }

    #[test]
    fn a_dead_output_is_a_503_so_the_page_takes_the_sound_back() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        assert_eq!(post(&url, &ramp(0, 10)), 204);
        assert!(!sink.failed());
        sink.shared.fail();
        assert!(sink.failed());
        let (code, h) = request(&url, "POST", None, None, &bytes_of(&ramp(0, 10)));
        assert_eq!(code, 503);
        assert_eq!(
            h.get("access-control-allow-origin").map(String::as_str),
            Some("*")
        );
        assert_eq!(sink.stats().chunks, 1, "nothing taken after it died");
    }

    #[test]
    fn a_keep_alive_connection_carries_batch_after_batch() {
        let sink = Sink::start(fake_output).unwrap();
        let rest = sink.opened().url;
        let rest = rest.strip_prefix("http://").unwrap().to_string();
        let (addr, path) = rest.split_at(rest.find('/').unwrap());
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut r = BufReader::new(s.try_clone().unwrap());
        let body = bytes_of(&ramp(0, 960));
        for i in 0..5 {
            write!(
                s,
                "POST {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n",
                body.len()
            )
            .unwrap();
            s.write_all(&body).unwrap();
            let mut status = String::new();
            r.read_line(&mut status).unwrap();
            assert!(status.contains("204"), "batch {i}: {status}");
            loop {
                let mut h = String::new();
                r.read_line(&mut h).unwrap();
                if h.trim_end().is_empty() {
                    break;
                }
            }
        }
        assert_eq!(sink.stats().chunks, 5);
    }

    #[test]
    fn dropping_the_sink_frees_the_port() {
        let sink = Sink::start(fake_output).unwrap();
        let url = sink.opened().url;
        let addr = url
            .strip_prefix("http://")
            .unwrap()
            .split('/')
            .next()
            .unwrap()
            .to_string();
        assert!(TcpStream::connect(&addr).is_ok());
        drop(sink);
        assert!(TcpStream::connect(&addr).is_err(), "still listening");
    }

    #[test]
    fn no_output_device_is_a_plain_message_and_no_listener() {
        let err = Sink::start(|_| Err("no audio output device".to_string()))
            .err()
            .expect("opened with no device");
        assert_eq!(err, "no audio output device");
    }

    /// The only test that touches the global sink.
    #[test]
    fn open_reuses_an_open_sink_close_frees_it_and_a_dead_one_is_replaced() {
        close();
        assert!(!stats().open, "nothing open");
        let a = open(fake_output).unwrap();
        // Reused: the output function is not even called.
        let b = open(|_| Err("called again".to_string())).unwrap();
        assert_eq!(a, b);
        assert!(stats().open);
        assert_eq!(post(&a.url, &ramp(0, 100)), 204);
        assert_eq!(stats().chunks, 1);

        close();
        close(); // idempotent
        assert!(!stats().open);
        assert_eq!(stats(), Stats::default());
        let addr = a
            .url
            .strip_prefix("http://")
            .unwrap()
            .split('/')
            .next()
            .unwrap();
        assert!(
            TcpStream::connect(addr).is_err(),
            "closed, and still listening"
        );

        let c = open(fake_output).unwrap();
        assert_ne!(a.url, c.url, "a fresh token on a fresh open");
        slot().as_ref().unwrap().shared.fail();
        let d = open(fake_output).unwrap();
        assert_ne!(c.url, d.url, "a dead output is not handed out again");
        close();
    }
}
