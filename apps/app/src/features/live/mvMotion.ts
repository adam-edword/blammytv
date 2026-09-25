import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { invert, type Box } from "./mvFlip";

/**
 * Multi-view's motion (plan 017, "Motion", P5).
 *
 * WHAT MOVES. A layout change (a tile added, removed, swapped into the big
 * spot, Grid to Focus) moves every tile from where it was drawn to its new
 * place (FLIP, on `transform` only), so you can follow a tile into the big
 * spot. A new tile fades and scales in from 0.96, never from nothing; a
 * closed one fades out a little faster, over its last frame.
 *
 * WHAT DOES NOT. Anything done from the keyboard (plan 017, "Keyboard":
 * they happen dozens of times a sitting, and motion on them reads as lag).
 * A resize or a seam drag, which follow the window or the pointer already.
 * With reduced motion nothing moves: what moved or arrived fades in where
 * it now is.
 *
 * INTERRUPTIBLE. "Where it was drawn" is read off the screen, transforms
 * and all, so a change in the middle of a move starts from wherever the
 * tile had got to rather than jumping back to its last resting place.
 *
 * The curves are tokens.css's strong ease-out and ease-in-out (Emil
 * Kowalski's; the house motion plans already use them).
 */

/** A tile moving to a new place. */
export const MOVE_MS = 260;
/** A tile arriving. */
export const ENTER_MS = 220;
/** A tile leaving: faster than arriving. */
export const EXIT_MS = 150;
/** Between tiles arriving together (Fill with live games). */
const STAGGER_MS = 40;
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
/** Every animation here carries this id, so starting a new one cancels
 * only ours and never a tile's own CSS transitions (its ring). */
const ID = "mv-motion";

let keyed = false;
if (typeof window !== "undefined") {
  // Capture phase, so the flag is set before any handler acts on the key.
  window.addEventListener("keydown", () => (keyed = true), true);
  window.addEventListener("pointerdown", () => (keyed = false), true);
}

/** Whether the viewer's last input was a key rather than the pointer. */
export function lastInputWasKey(): boolean {
  return keyed;
}

/** Where each moving part is drawn right now, keyed by its `data-mv`. */
export function snapshot(root: HTMLElement): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-mv]")) {
    out.set(el.dataset.mv as string, el.getBoundingClientRect());
  }
  return out;
}

const isCaption = (id: string) => id.startsWith("cap:");
const streamOf = (id: string) => id.slice(id.indexOf(":") + 1);

/** Move everything from `first` to where it is laid out now. */
export function play(root: HTMLElement, first: Map<string, DOMRect>): void {
  stop(root);
  const els = [...root.querySelectorAll<HTMLElement>("[data-mv]")];
  // Arrivals are staggered by stream, the caption with its tile.
  const arriving = new Map<string, number>();
  for (const el of els) {
    const id = el.dataset.mv as string;
    if (!first.has(id) && !isCaption(id)) arriving.set(streamOf(id), arriving.size * STAGGER_MS);
  }
  // The tile to follow is the one whose size changes most: into Focus's
  // big spot, out to fill the window, back from it. It passes over the
  // others rather than under them, its caption with it. A swap moves two
  // tiles by the same amount, and then the one growing wins.
  let lifted: string | null = null;
  let most = 0;
  for (const el of els) {
    const id = el.dataset.mv as string;
    const was = first.get(id);
    if (!was || isCaption(id)) continue;
    const now = el.getBoundingClientRect();
    const change = now.width * now.height - was.width * was.height;
    const score = Math.abs(change) + (change > 0 ? 1 : 0);
    if (Math.abs(change) > 1 && score > most) {
      most = score;
      lifted = streamOf(id);
    }
  }
  for (const el of els) {
    const id = el.dataset.mv as string;
    const was = first.get(id);
    const last = el.getBoundingClientRect();
    if (REDUCED_MOTION) {
      if (!was || invert(was, last, true)) fadeIn(el);
      continue;
    }
    if (!was) {
      const delay = arriving.get(streamOf(id)) ?? 0;
      el.animate(
        isCaption(id)
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "scale(0.96)", transformOrigin: "50% 50%" },
              { opacity: 1, transform: "none", transformOrigin: "50% 50%" },
            ],
        { duration: ENTER_MS, delay, easing: EASE_OUT, fill: "backwards", id: ID },
      );
      continue;
    }
    const from = invert(was, last, !isCaption(id));
    if (!from) continue;
    const move = el.animate(
      [
        { transform: from, transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" },
      ],
      { duration: MOVE_MS, easing: EASE_IN_OUT, id: ID },
    );
    if (streamOf(id) === lifted) {
      el.style.zIndex = "1";
      // Only once nothing of ours still moves it: a move cancelled by the
      // next one settles a tick later, after that one has lifted it again.
      const settle = () => {
        if (!el.getAnimations().some((a) => a.id === ID && a.playState === "running")) el.style.zIndex = "";
      };
      move.finished.then(settle, settle);
    }
  }
}

/** Stop any move in flight, leaving every tile at its laid-out place: for a
 * change that should not animate arriving in the middle of one. */
export function stop(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-mv]")) {
    for (const a of el.getAnimations()) if (a.id === ID) a.cancel();
  }
}

function fadeIn(el: HTMLElement): void {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT, id: ID });
}

/** A closed tile's stand-in while it fades: where it was, and its last
 * frame when it had one. */
export interface Ghost {
  key: string;
  box: Box;
  frame: HTMLCanvasElement | null;
}

/**
 * The stand-in for tile `id`, taken before it goes. Its `<video>` goes with
 * it (the stream is closed at once, handing the connection back), so the
 * picture that fades is a copy of the last frame.
 */
export function ghostOf(root: HTMLElement, id: string): Ghost | null {
  const el = root.querySelector<HTMLElement>(`[data-mv="tile:${CSS.escape(id)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  const video = el.querySelector("video");
  let frame: HTMLCanvasElement | null = null;
  if (video && video.videoWidth > 0) {
    frame = document.createElement("canvas");
    frame.width = Math.max(1, Math.round(r.width));
    frame.height = Math.max(1, Math.round(r.height));
    try {
      frame.getContext("2d")?.drawImage(video, 0, 0, frame.width, frame.height);
    } catch {
      frame = null;
    }
  }
  return {
    key: `${id}@${performance.now()}`,
    box: { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height },
    frame,
  };
}

/** Fade a stand-in out; resolves when it has gone. */
export function leave(el: HTMLElement): Promise<void> {
  const frames = REDUCED_MOTION
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(0.96)" },
      ];
  return el
    .animate(frames, { duration: EXIT_MS, easing: EASE_OUT, fill: "forwards", id: ID })
    .finished.then(
      () => undefined,
      () => undefined,
    );
}
