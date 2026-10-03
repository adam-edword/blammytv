/// <reference lib="webworker" />

/**
 * Sends multi-view's sound to the native side (mvAudio.ts has the why;
 * mvaudio.rs is what answers).
 *
 * Takes the worklet's frames straight from it over a MessagePort, so the page's
 * thread is not in the audio path. Batches about BATCH_MS of them and POSTs
 * each batch to the native listener: interleaved f32 little-endian stereo, as
 * `text/plain`, which makes it a CORS "simple" request with no preflight.
 *
 * ONE POST AT A TIME, so batches arrive in order (two connections can
 * overtake each other). Over MAX_QUEUE waiting, the oldest goes: this is
 * sound that is being played, and late is as bad as lost.
 *
 * SAYS WHEN IT HAS FAILED, because a muted grid and a dead pipe is a silent
 * grid. `ready` is the first batch the native side took. `failed` is
 * FAIL_LIMIT batches in a row refused (the listener gone, the output dead:
 * 503) or a page that stopped sending while the context was meant to be
 * running. The page then plays the sound in the webview again.
 */

/** Said once, with the end of the channel the worklet writes to. */
export interface SendInit {
  port: MessagePort;
  url: string;
  rate: number;
}

export type ToSender =
  | { init: SendInit }
  /** The context is running (or not): the stall watch only counts then. */
  | { run: boolean };

export type FromSender = { ready: true } | { failed: string };

/** About how much sound a POST carries. */
const BATCH_MS = 20;
/** Batches waiting behind a slow POST before the oldest is dropped. */
const MAX_QUEUE = 10;
/** Batches refused in a row (a second or so) before giving up. */
const FAIL_LIMIT = 50;
/** No frames for this long while the context runs is a pipe that stopped. */
const STALL_MS = 2000;

let url = "";
let target = 0;
let chunks: Float32Array[] = [];
let held = 0;
const queue: Float32Array<ArrayBuffer>[] = [];
let busy = false;
let fails = 0;
let ready = false;
let dead = false;
let running = false;
let lastIn = 0;

const say = (m: FromSender) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function fail(why: string): void {
  if (dead) return;
  dead = true;
  queue.length = 0;
  say({ failed: why });
}

function frames(a: Float32Array): void {
  lastIn = performance.now();
  if (dead) return;
  chunks.push(a);
  held += a.length >> 1;
  if (held < target) return;
  const batch = new Float32Array(held * 2);
  let at = 0;
  for (const c of chunks) {
    batch.set(c, at);
    at += c.length;
  }
  chunks = [];
  held = 0;
  queue.push(batch);
  if (queue.length > MAX_QUEUE) queue.shift();
  void pump();
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  while (queue.length > 0 && !dead) {
    const batch = queue.shift() as Float32Array<ArrayBuffer>;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: batch,
      });
      if (!res.ok) throw new Error(`the sound listener answered ${res.status}`);
      fails = 0;
      if (!ready) {
        ready = true;
        say({ ready: true });
      }
    } catch (e) {
      if (++fails >= FAIL_LIMIT) fail(e instanceof Error ? e.message : String(e));
    }
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<ToSender>) => {
  const msg = e.data;
  if ("init" in msg) {
    const { port, url: to, rate } = msg.init;
    url = to;
    target = Math.round((rate * BATCH_MS) / 1000);
    port.onmessage = (f: MessageEvent<Float32Array>) => frames(f.data);
  } else {
    running = msg.run;
    // A context that has only just started owes nothing yet.
    lastIn = performance.now();
  }
};

setInterval(() => {
  if (running && !dead && performance.now() - lastIn > STALL_MS) {
    fail("the page stopped sending sound");
  }
}, 500);
