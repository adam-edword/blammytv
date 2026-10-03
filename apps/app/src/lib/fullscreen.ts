import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadList, save } from "./storage";
import { tauriIsFullscreen, tauriSetFullscreen } from "./tauri";

/**
 * Fullscreen, checked: switch the window, then make sure the PAGE came with it.
 *
 * WHY. A friend, 2026-10-02, release build, Windows: in the Sports theater the
 * Fullscreen button sometimes made the window fullscreen while the picture
 * and the controls stayed at the old window's size, pinned top-left, black
 * around them. Leaving fullscreen and clicking it again fixed it. Adam can't
 * make it happen.
 *
 * What the screenshot says: the controls and the picture share one rect, the
 * old client size, laid out the way the theater lays out in fullscreen (side
 * column gone, no padding). So the page laid itself out at the old size. And
 * InvertedPlayer re-measures the slot every frame, so the second try working
 * means that loop was alive the whole time. The page never heard the new size.
 * That is a WebView2 and Tauri resize race, not our layout.
 *
 * So after any switch the app makes, wait for it to settle and compare the
 * window's real client size with the page's, both in physical pixels. If they
 * disagree and the window is in the state we asked for, do by code what the
 * friend did by hand (off then on, or on then off), once, and keep a record.
 * If this guess is wrong the check never fires, and the record staying empty
 * is also an answer. Read it from devtools with `btvFullscreen()`.
 */

/** Long enough for the OS animation and the webview's resize to land. */
const SETTLE_MS = 500;
/** Physical px, each axis. The page's size is a rounded product. */
const TOLERANCE = 2;
/** One repair per switch. A window that stays wrong is a result, not a loop. */
const MAX_REPAIRS = 1;

const KEY = "fullscreenChecks";
const VERSION = 1;
const KEEP = 20;

/** One mismatch. Numbers only. `fixed` is true when the re-check agreed. */
export interface FullscreenCheck {
  t: number;
  /** The state we asked for. */
  on: boolean;
  /** The page's size when it disagreed, physical px. */
  page: [number, number];
  /** The window's client size at the same moment, physical px. */
  win: [number, number];
  fixed: boolean;
}

const isPair = (x: unknown): x is [number, number] =>
  Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === "number");

const isCheck = (x: unknown): x is FullscreenCheck => {
  const c = x as Partial<FullscreenCheck> | null;
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.t === "number" &&
    typeof c.on === "boolean" &&
    typeof c.fixed === "boolean" &&
    isPair(c.page) &&
    isPair(c.win)
  );
};

/** The last few mismatches, oldest first. Empty means none ever disagreed. */
export function loadFullscreenChecks(): FullscreenCheck[] {
  return loadList(KEY, VERSION, isCheck);
}

/** Do the page and the window agree on a size, within a couple of pixels? */
export function sizesAgree(page: [number, number], win: [number, number]): boolean {
  return Math.abs(page[0] - win[0]) <= TOLERANCE && Math.abs(page[1] - win[1]) <= TOLERANCE;
}

interface Look {
  page: [number, number];
  win: [number, number];
  fullscreen: boolean;
}

/**
 * Both sizes and the window's state, or null when anything won't say. The
 * browser build has no window to ask and the harness stub answers undefined:
 * both mean "can't tell", and "can't tell" does nothing.
 */
async function look(): Promise<Look | null> {
  try {
    const [size, fullscreen] = await Promise.all([
      getCurrentWindow().innerSize(),
      tauriIsFullscreen(),
    ]);
    const win: [number, number] = [size.width, size.height];
    if (typeof fullscreen !== "boolean") return null;
    if (!win.every((n) => Number.isFinite(n) && n > 0)) return null;
    const dpr = window.devicePixelRatio || 1;
    const page: [number, number] = [
      Math.round(window.innerWidth * dpr),
      Math.round(window.innerHeight * dpr),
    ];
    return { page, win, fullscreen };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The newest switch. An older one's pending check sees it moved and stands down. */
let generation = 0;

/**
 * Switch the window in or out of fullscreen, then check it landed.
 *
 * A failed switch rejects, as `tauriSetFullscreen` does, and callers keep
 * their own catch. The check after it never throws.
 */
export async function setFullscreenChecked(on: boolean): Promise<void> {
  const mine = ++generation;
  await tauriSetFullscreen(on);

  // The first mismatch is the one worth keeping: what was wrong, and then
  // whether the repair put it right.
  let first: Look | null = null;
  let fixed = false;
  for (let repairs = 0; ; repairs++) {
    await sleep(SETTLE_MS);
    const seen = await look();
    // A newer switch owns the window now. A window that is not in the state
    // we asked for was moved on (or never went): not ours to repair.
    if (mine !== generation || !seen || seen.fullscreen !== on) break;
    if (sizesAgree(seen.page, seen.win)) {
      if (first) {
        fixed = true;
        console.info(`[fs] after switching again the page agrees: ${seen.page.join("x")}`);
      }
      break;
    }
    first ??= seen;
    if (repairs >= MAX_REPAIRS) {
      console.info(
        `[fs] still disagrees: page ${seen.page.join("x")}, window ${seen.win.join("x")}`,
      );
      break;
    }
    console.info(
      `[fs] asked for fullscreen=${on}: page ${seen.page.join("x")}, ` +
        `window ${seen.win.join("x")} (physical px), switching again`,
    );
    await tauriSetFullscreen(!on);
    if (mine !== generation) break;
    await tauriSetFullscreen(on);
  }

  if (first) {
    const entry: FullscreenCheck = {
      t: Date.now(),
      on,
      page: first.page,
      win: first.win,
      fixed,
    };
    save(KEY, VERSION, [...loadFullscreenChecks(), entry].slice(-KEEP));
  }
}
