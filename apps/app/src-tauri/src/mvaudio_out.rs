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
                // Until the Stop drops its sender.
                let _ = stop_rx.recv();
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
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("no audio output device")?;
    let rate = device
        .default_output_config()
        .map_err(|e| format!("the audio output has no usable format: {e}"))?
        .sample_rate();
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
                // A glitch, or a route change cpal followed by itself.
                cpal::ErrorKind::Xrun
                | cpal::ErrorKind::DeviceChanged
                | cpal::ErrorKind::DeviceBusy
                | cpal::ErrorKind::RealtimeDenied => {}
                _ => {
                    eprintln!("[mvaudio] output stopped: {err}");
                    dead.fail();
                }
            },
            None,
        )
        .map_err(|e| format!("could not open the audio output: {e}"))?;
    stream
        .play()
        .map_err(|e| format!("could not start the audio output: {e}"))?;
    Ok((stream, rate))
}
