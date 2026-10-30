import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VlcProgress } from "../../lib/tauri";

// What native would send, and what vlc_open answers: both come from here.
const native = vi.hoisted(() => ({
  listeners: 0,
  send: null as null | ((p: VlcProgress) => void),
  open: vi.fn<(url: string, title: string, ua?: string, start?: number) => Promise<void>>(),
}));
vi.mock("../../lib/tauri", () => ({
  VLC_NOT_INSTALLED: "vlc not installed",
  tauriVlcOpen: native.open,
  onVlcProgress: (cb: (p: VlcProgress) => void) => {
    native.listeners++;
    native.send = cb;
    return Promise.resolve(() => {});
  },
}));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
const heard: string[] = [];
vi.stubGlobal("window", {
  dispatchEvent: (e: Event) => {
    heard.push(e.type);
    return true;
  },
});

const { applyVlcProgress, currentVlc, followVlc, onVlcSession, openInVlc, vlcTitle } = await import("./vlcSession");
const { loadWatching, recordWatching } = await import("./watching");
const { loadWatched, FILM_WATCHED } = await import("./watched");
const { TRAKT_SYNCED } = await import("../trakt/store");

const film = { itemId: "tt1", kind: "movie" as const, title: "Film", streamUrl: "http://h/a.mkv" };
const ep = {
  itemId: "tt2",
  kind: "series" as const,
  title: "Show",
  episodeId: "tt2:1:4",
  season: 1,
  streamUrl: "http://h/b.mkv",
};
const progress = (pos: number, len: number, state: VlcProgress["state"] = "playing"): VlcProgress => ({ pos, len, state });
const at = (id: string) => loadWatching().find((e) => e.id === id);

beforeEach(() => {
  store.clear();
  heard.length = 0;
  native.open.mockReset();
  // Nothing is followed between tests: a "gone" ends whatever is.
  applyVlcProgress(progress(0, 0, "gone"));
  recordWatching({ id: "tt1", title: "Film", kind: "movie", at: 1 });
  recordWatching({ id: "tt2", title: "Show", kind: "series", episodeId: "tt2:1:4", at: 2 });
  heard.length = 0;
});

describe("what a report does", () => {
  it("saves the position and length of a film that plays or is paused, for Continue Watching", () => {
    followVlc(film);
    applyVlcProgress(progress(600, 6000));
    expect(at("tt1")).toMatchObject({ posSec: 600, durSec: 6000 });
    applyVlcProgress(progress(900, 6000, "paused"));
    expect(at("tt1")).toMatchObject({ posSec: 900, durSec: 6000 });
    // And tells the screens that read the list.
    expect(heard).toEqual([TRAKT_SYNCED, TRAKT_SYNCED]);
  });

  it("keeps the length it had when VLC does not know it yet, and ignores a stopped 0", () => {
    followVlc(film);
    applyVlcProgress(progress(600, 6000));
    applyVlcProgress(progress(650, 0));
    expect(at("tt1")).toMatchObject({ posSec: 650, durSec: 6000 });
    applyVlcProgress(progress(0, 0, "stopped"));
    expect(at("tt1")).toMatchObject({ posSec: 650, durSec: 6000 });
  });

  it("counts an episode as watched at the player's 90% line, and not before", () => {
    followVlc(ep);
    applyVlcProgress(progress(2600, 3000));
    expect(loadWatched("tt2").has("tt2:1:4")).toBe(false);
    applyVlcProgress(progress(2700, 3000));
    expect(loadWatched("tt2").has("tt2:1:4")).toBe(true);
    expect(heard).not.toContain(FILM_WATCHED);
  });

  it("tells MyAnimeList a film is watched at the same line, and marks no episode", () => {
    followVlc(film);
    applyVlcProgress(progress(5000, 6000));
    expect(heard).not.toContain(FILM_WATCHED);
    applyVlcProgress(progress(5400, 6000));
    expect(heard).toContain(FILM_WATCHED);
    expect(loadWatched("tt1").size).toBe(0);
  });

  it("does nothing with no title followed", () => {
    applyVlcProgress(progress(5400, 6000));
    expect(at("tt1")).toEqual({ id: "tt1", title: "Film", kind: "movie", at: 1 });
    expect(heard).toEqual([]);
  });
});

describe("gone", () => {
  it("saves the last position, ends the session, and drops what comes after", () => {
    followVlc(film);
    expect(currentVlc()).toBe(film);
    const seen: Array<unknown> = [];
    const off = onVlcSession(() => seen.push(currentVlc()));
    applyVlcProgress(progress(3000, 6000, "gone"));
    expect(at("tt1")).toMatchObject({ posSec: 3000, durSec: 6000 });
    expect(currentVlc()).toBeNull();
    expect(seen).toEqual([null]);
    applyVlcProgress(progress(4000, 6000));
    expect(at("tt1")).toMatchObject({ posSec: 3000 });
    off();
  });

  it("reads a gone with no position as the end and keeps what was saved", () => {
    followVlc(film);
    applyVlcProgress(progress(3000, 6000));
    applyVlcProgress(progress(0, 0, "gone"));
    expect(at("tt1")).toMatchObject({ posSec: 3000, durSec: 6000 });
    expect(currentVlc()).toBeNull();
  });
});

describe("one session at a time", () => {
  it("follows the newest title: the one before gets nothing more", () => {
    followVlc(film);
    applyVlcProgress(progress(600, 6000));
    followVlc(ep);
    expect(currentVlc()).toBe(ep);
    applyVlcProgress(progress(100, 3000));
    expect(at("tt2")).toMatchObject({ posSec: 100, durSec: 3000 });
    expect(at("tt1")).toMatchObject({ posSec: 600 });
    applyVlcProgress(progress(120, 3000, "gone"));
    expect(at("tt1")).toMatchObject({ posSec: 600 });
    expect(currentVlc()).toBeNull();
  });

  it("listens to native once for the life of the app", () => {
    followVlc(film);
    followVlc(ep);
    followVlc(film);
    expect(native.listeners).toBe(1);
  });

  it("tells watchers when the title changes, not on each report", () => {
    let n = 0;
    const off = onVlcSession(() => n++);
    followVlc(film);
    applyVlcProgress(progress(10, 100));
    applyVlcProgress(progress(20, 100));
    expect(n).toBe(1);
    off();
    followVlc(ep);
    expect(n).toBe(1);
  });
});

describe("openInVlc", () => {
  it("asks native for the address, name, User-Agent and start, then follows the title", async () => {
    native.open.mockResolvedValue();
    const out = await openInVlc(film, "Film", "Agent/1", 612);
    expect(out).toBeNull();
    expect(native.open).toHaveBeenCalledWith("http://h/a.mkv", "Film", "Agent/1", 612);
    expect(currentVlc()).toBe(film);
  });

  it("says VLC is not installed, and follows nothing", async () => {
    native.open.mockRejectedValue("vlc not installed");
    expect(await openInVlc(film, "Film")).toEqual({ missing: true });
    expect(currentVlc()).toBeNull();
  });

  it("gives any other refusal in its own words, with a login scrubbed out", async () => {
    native.open.mockRejectedValue("vlc did not start: permission denied (http://h/x?password=secret)");
    const out = await openInVlc(film, "Film");
    expect(out).toMatchObject({ missing: false });
    expect(JSON.stringify(out)).toContain("vlc did not start");
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(currentVlc()).toBeNull();
  });

  it("leaves the title already followed alone when a second open is refused", async () => {
    native.open.mockResolvedValueOnce();
    await openInVlc(film, "Film");
    native.open.mockRejectedValueOnce("vlc not installed");
    await openInVlc(ep, "Show");
    expect(currentVlc()).toBe(film);
  });
});

describe("vlcTitle", () => {
  it("is the film's title, or Show · S1 E4 · Episode", () => {
    expect(vlcTitle("Film")).toBe("Film");
    expect(vlcTitle("Show", { season: 1, episode: 4, title: "Four" })).toBe("Show · S1 E4 · Four");
  });
});
