import { useEffect, useState } from "react";
import { httpGetBytes } from "./http";

/**
 * Where a logo's ink sits across its width, so a logo lines up with the
 * text under it by its ink and not by its file's edge (Adam, v0.10.20:
 * "left justify the logo over the episode title"). Show logos often come
 * as wide transparent PNGs with the mark in the middle: in his screenshot,
 * Demon Slayer's emblem started about 93px right of the episode title it
 * sits over, with the image box itself flush left.
 *
 * `left` and `right` are the transparent share of the width on each side,
 * 0 to 1.
 */
export interface InkSpan {
  left: number;
  right: number;
}

/** At least this opaque is ink. A soft shadow's faint outer edge is not. */
const ALPHA_MIN = 16;

/** The first and last columns with ink in an RGBA buffer, as shares of the
 * width. Null when nothing in it is ink. A file with no alpha at all is ink
 * edge to edge, so it comes back as zero on both sides. */
export function inkSpan(rgba: Uint8ClampedArray, w: number, h: number): InkSpan | null {
  let lo = w;
  let hi = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < lo; x++) {
      if (rgba[row + x * 4 + 3] >= ALPHA_MIN) {
        lo = x;
        break;
      }
    }
    for (let x = w - 1; x > hi; x--) {
      if (rgba[row + x * 4 + 3] >= ALPHA_MIN) {
        hi = x;
        break;
      }
    }
  }
  if (hi < 0) return null;
  return { left: lo / w, right: (w - 1 - hi) / w };
}

/** Read at this width: one of its pixels is well under one on screen. */
const READ_W = 256;
const measured = new Map<string, Promise<InkSpan | null>>();

/** A logo's ink span, read once per URL for the session. Null when it
 * can't be read, which leaves the logo exactly as it was. */
export function logoInk(url: string): Promise<InkSpan | null> {
  let p = measured.get(url);
  if (!p) {
    p = read(url).catch(() => null);
    measured.set(url, p);
  }
  return p;
}

async function read(url: string): Promise<InkSpan | null> {
  // Through Rust in the app. A canvas refuses to hand back a cross-site
  // image's pixels unless its host sends CORS headers, and a logo's host
  // is anyone's.
  const bytes = await httpGetBytes(url, undefined, 10);
  const bmp = await createImageBitmap(new Blob([bytes]), { resizeWidth: READ_W });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return inkSpan(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

/** Past this, a logo still being read shows as its file is. */
const GIVE_UP_MS = 1500;

/**
 * For a logo on screen: its ink span, and whether the answer is in, so the
 * logo can wait for it instead of jumping sideways once it lands. After
 * GIVE_UP_MS it shows untrimmed, and a late answer is left for the next
 * time the same logo comes up (it is cached) rather than moving this one.
 */
export function useLogoInk(url: string | undefined): { span: InkSpan | null; ready: boolean } {
  const [state, setState] = useState<{ url?: string; span: InkSpan | null; ready: boolean }>({
    span: null,
    ready: false,
  });
  useEffect(() => {
    if (!url) return;
    let settled = false;
    const settle = (span: InkSpan | null) => {
      if (settled) return;
      settled = true;
      setState({ url, span, ready: true });
    };
    setState({ url, span: null, ready: false });
    const t = window.setTimeout(() => settle(null), GIVE_UP_MS);
    void logoInk(url).then(settle);
    return () => {
      settled = true;
      window.clearTimeout(t);
    };
  }, [url]);
  return state.url === url ? state : { span: null, ready: false };
}
