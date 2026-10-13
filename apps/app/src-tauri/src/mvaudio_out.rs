//! The output side of multi-view's sound (mvaudio.rs has the why): the
//! default output device, opened by this process, so what it plays is
//! BlammyTV.exe's own audio and Discord's per-app capture hears it.
//!
//! cpal does the device work (WASAPI here). Stereo f32 at the device's own
//! rate, which is the rate `mv_audio_open` tells the page to render at, so
//! neither side resamples. The stream lives on a thread of its own: a cpal
//! stream is dropped to stop it, and this way it is built, run and dropped on
//! the one thread, whichever thread the command arrived on.
//!
//! WASAPI never rebinds a stream. When the default device changes, or goes,
//! cpal reports `StreamInvalidated` and the stream is finished: `fail` makes
//! the listener answer 503, and the page plays the sound itself again. The
//! next `mv_audio_open` builds a fresh one on whatever the default is now.
//!
//! It needs a device, so none of it runs on CI (the runner has no audio): it
//! is type-checked by `node scripts/check-rust.mjs`, and without a device it
//! fails with a plain message, which the page treats as "play it directly".

use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::mvaudio::{Output, Shared};

/// How long the device may take to open. WASAPI answers in tens of
/// milliseconds; this is for one that never will.
const OPEN_MS: u64 = 5_000;

/// When the output says in the log how it is doing: long enough for the page
/// to have started sending, short enough that a quick look at multi-view
/// gets there.
const REPORT_AFTER: Duration = Duration::from_secs(5);

/// Stops the stream's thread when the output is dropped.
struct Stop {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Stop {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Open the default output and start it draining `shared`.
pub fn start(shared: Arc<Shared>) -> Result<Output, String> {
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<u32, String>>(1);
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let thread = std::thread::Builder::new()
        .name("mvaudio-out".into())
        .spawn(move || match build(&shared) {
            Ok((stream, rate)) => {
                let _ = ready_tx.send(Ok(rate));
                // Until the Stop drops its sender, with one look at how it
                // is going on the way, for the log.
                if let Err(mpsc::RecvTimeoutError::Timeout) = stop_rx.recv_timeout(REPORT_AFTER) {
                    log::info!(
                        "[mvaudio] after {}s: {}",
                        REPORT_AFTER.as_secs(),
                        shared.stats().line()
                    );
                    let _ = stop_rx.recv();
                }
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        })
        .map_err(|e| format!("could not start the audio output: {e}"))?;
    match ready_rx.recv_timeout(Duration::from_millis(OPEN_MS)) {
        Ok(Ok(rate)) => Ok(Output::new(
            rate,
            Stop {
                stop: Some(stop_tx),
                thread: Some(thread),
            },
        )),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        // Not joined: the thread may still be inside the device. It drops
        // the stream as soon as it gets here, because the sender is gone.
        Err(_) => Err("the audio output did not open".to_string()),
    }
}

fn build(shared: &Arc<Shared>) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("no audio output device")?;
    let format = device
        .default_output_config()
        .map_err(|e| format!("the audio output has no usable format: {e}"))?;
    let rate = format.sample_rate();
    let config = cpal::StreamConfig {
        channels: 2,
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    };
    // Before the stream can call back: the buffer's thresholds are in frames.
    shared.set_rate(rate);
    let (feed, dead) = (shared.clone(), shared.clone());
    let stream = device
        .build_output_stream::<f32, _, _>(
            config,
            move |data, _| feed.pull(data),
            move |err| match err.kind() {
                // A glitch.
                cpal::ErrorKind::Xrun => {}
                // A route change cpal followed by itself, or a note about
                // the device or the thread: kept going, and said.
                cpal::ErrorKind::DeviceChanged
                | cpal::ErrorKind::DeviceBusy
                | cpal::ErrorKind::RealtimeDenied => log::info!("[mvaudio] output: {err}"),
                _ => {
                    log::error!("[mvaudio] output stopped: {err}");
                    dead.fail();
                }
            },
            None,
        )
        .map_err(|e| format!("could not open the audio output: {e}"))?;
    stream
        .play()
        .map_err(|e| format!("could not start the audio output: {e}"))?;
    log::info!(
        "[mvaudio] output: {}",
        where_it_plays(&host, &device, &format)
    );
    Ok((stream, rate))
}

/// Where the sound went, for the log: a multi-view that is silent while the
/// player is not has to be told apart on a real machine, and the two find
/// "the default" differently. This stream is on Windows' default for apps,
/// which cpal names by the Console role's device. mpv opens the Multimedia
/// role's device itself (its ao_wasapi_utils.c asks GetDefaultAudioEndpoint
/// for eRender, eMultimedia). On a plain machine the two are one device.
fn where_it_plays(
    host: &cpal::Host,
    device: &cpal::Device,
    format: &cpal::SupportedStreamConfig,
) -> String {
    let name = |d: &cpal::Device| {
        d.description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| "?".to_string())
    };
    let ours = device.id().ok().map(|i| i.id().to_string());
    let player = match (multimedia_default(), ours) {
        (Some(p), Some(o)) if p == o => "the player's device too".to_string(),
        (Some(p), _) => {
            let n = host
                .output_devices()
                .ok()
                .and_then(|mut all| all.find(|d| d.id().is_ok_and(|i| i.id() == p)))
                .map_or_else(|| "?".to_string(), |d| name(&d));
            format!("the player's is \"{n}\"")
        }
        (None, _) => "the player's is unknown".to_string(),
    };
    format!(
        "Windows' default for apps, now \"{}\", {} Hz, {} ch; {player}",
        name(device),
        format.sample_rate(),
        format.channels()
    )
}

/// The id of the device mpv plays on: the Multimedia role's default, in the
/// form cpal's ids take (the endpoint's id string).
fn multimedia_default() -> Option<String> {
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED,
    };
    // SAFETY: COM is started for this thread and stopped again only if this
    // started it (S_OK or S_FALSE; a thread already in the other mode is
    // usable as it is). The id string is the caller's to free, once.
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let id = (|| {
            let e: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let raw = e
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .ok()?
                .GetId()
                .ok()?;
            let id = raw.to_string().ok();
            CoTaskMemFree(Some(raw.0 as *const _));
            id
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        id
    }
}
