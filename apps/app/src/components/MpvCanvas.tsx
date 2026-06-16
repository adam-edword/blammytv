import { useEffect, useRef, useState } from "react";
import {
  mpvCanvasStart,
  mpvCanvasFrame,
  mpvCanvasStop,
  mpvCanvasStats,
} from "../lib/desktop";
import { CloseIcon } from "./icons";

// Fullscreen-quad shaders. The vertex shader flips Y (our RGBA buffer is
// top-down; GL textures are bottom-up) so the picture is upright.
const VERT = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2((pos.x + 1.0) * 0.5, (1.0 - pos.y) * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;
const FRAG = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
void main() { gl_FragColor = texture2D(tex, uv); }`;

function makeGl(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(prog, "pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { gl, tex };
}

/**
 * Phase 2 step 2: a live libmpv → <canvas> layer that fills the theater.
 *
 * Pulls each decoded frame synchronously from the in-renderer addon (no IPC, no
 * clone) and uploads it straight to a WebGL texture (no putImageData / no extra
 * copy — the GPU does the scale). mpv plays audio natively. Sits above the
 * <video> but below the theater controls, so the HTML chrome composites on top.
 */
export function MpvCanvas({ url, onClose }: { url: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 1280, h: 720 });
  // Min ms between frame pulls — derived from the source fps so we never present
  // faster than the content (the win on high-refresh displays). Defaults to
  // ~60fps until the first stats sample tells us the real rate.
  const intervalRef = useRef(15.5);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [stats, setStats] = useState("");
  const [fps, setFps] = useState(0);

  // Keep the canvas's intrinsic size = its on-screen pixel size (capped), so the
  // readback is full resolution and the upload maps 1:1.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      let w = Math.round(rect.width * dpr);
      let h = Math.round(rect.height * dpr);
      w = Math.max(640, Math.min(3840, w));
      h = Math.max(360, Math.min(2160, h));
      w -= w % 2;
      h -= h % 2;
      sizeRef.current = { w, h };
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Poll mpv diagnostics (decoder, real fps, drops, timings, GL renderer) and
  // retune the frame-pull interval to the source fps — never present faster.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = mpvCanvasStats();
      if (s) {
        setStats(s);
        console.log("[mpv stats]", s);
        const m = s.match(/container-fps=([\d.]+)/);
        const fps = m ? parseFloat(m[1]) : NaN;
        if (fps > 1 && fps < 240) {
          // Small margin so the rAF tick nearest the frame boundary fires
          // (rAF granularity is ~4ms on a 240Hz panel) — i.e. don't undershoot.
          intervalRef.current = Math.max(6, 1000 / fps - 4);
        }
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let gotFirst = false;
    let texW = 0;
    let texH = 0;
    let lastDraw = -1;
    // Measure the actually-presented framerate (what the eye sees).
    let drawn = 0;
    let fpsSince = -1;

    const canvas = canvasRef.current;
    const ctx = canvas ? makeGl(canvas) : null;
    if (!ctx) {
      setError("WebGL unavailable.");
      return;
    }
    const { gl, tex } = ctx;

    const res = mpvCanvasStart(url);
    if (!res.ok) {
      setError(res.error ?? "Couldn't start libmpv player.");
      return;
    }

    const tick = (t: number) => {
      if (cancelled) return;
      if (t - lastDraw < intervalRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastDraw = t;
      const { w, h } = sizeRef.current;
      const buf = mpvCanvasFrame(w, h);
      if (buf && buf.length === w * h * 4) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (w !== texW || h !== texH) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          texW = w;
          texH = h;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        }
        gl.viewport(0, 0, canvas!.width, canvas!.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        drawn++;
        if (fpsSince < 0) fpsSince = t;
        else if (t - fpsSince >= 500) {
          setFps(Math.round((drawn * 1000) / (t - fpsSince)));
          drawn = 0;
          fpsSince = t;
        }
        if (!gotFirst) {
          gotFirst = true;
          setLive(true);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      mpvCanvasStop();
    };
  }, [url]);

  return (
    <div className="mpv-canvas">
      <canvas ref={canvasRef} className="mpv-canvas__view" />
      <div className="mpv-canvas__hud">
        <span>
          libmpv{" "}
          {live ? `• ${fps} fps` : error ? "• error" : "• starting…"}
        </span>
        <button
          className="mpv-canvas__close"
          type="button"
          aria-label="Close libmpv canvas"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      {error && <div className="mpv-canvas__error">{error}</div>}
      {stats && <div className="mpv-canvas__stats">{stats}</div>}
    </div>
  );
}
