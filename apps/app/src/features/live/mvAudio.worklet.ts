/**
 * The tap on multi-view's sound, inside the audio thread (mvAudio.ts has the
 * why): every 128-frame quantum of the sound tile's audio, as interleaved
 * stereo, over a MessagePort to the Worker that sends it to the native side.
 *
 * Nothing else happens here, and nothing is allocated up front: this runs
 * every 2.7ms at 48 kHz, and a long React render on the page's thread must
 * not be able to starve it, which is why the port goes to a Worker and not
 * to the page.
 *
 * Not connected to the context's destination, so the webview itself outputs
 * nothing: the node is still processed, because its input is connected (a
 * measured fact of Chromium 141, WebView2's engine: 348 quanta in a second,
 * every one with the real signal).
 *
 * A real bundled file, not a blob: the page's CSP is `script-src 'self'`.
 */

// The worklet scope has no DOM lib types, and these two are all it needs.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** Said once, to the node's own port: where the frames go. */
export interface TapInit {
  out: MessagePort;
}

class MvAudioTap extends AudioWorkletProcessor {
  private out: MessagePort | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<TapInit>) => {
      this.out = e.data.out;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const out = this.out;
    if (!out) return true;
    // Nothing connected (a tile with no sound yet) is an empty list: send
    // silence, so what is downstream keeps its rhythm and a source that
    // arrives later starts clean.
    const input = inputs[0] ?? [];
    const left = input[0];
    const right = input[1] ?? left;
    const n = left?.length ?? 128;
    const frames = new Float32Array(n * 2);
    if (left && right) {
      for (let i = 0; i < n; i++) {
        frames[2 * i] = left[i];
        frames[2 * i + 1] = right[i];
      }
    }
    out.postMessage(frames, [frames.buffer]);
    return true;
  }
}

registerProcessor("mv-audio-tap", MvAudioTap);
