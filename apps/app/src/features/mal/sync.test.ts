import { beforeEach, describe, expect, it, vi } from "vitest";

// A MAL tick against a stubbed MAL and a Kitsu mapping that can fail to
// load: the episode counts as handled only once it is pushed, or once the
// mapping loaded and has no entry for it.

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("CustomEvent", class {} as unknown as typeof CustomEvent);

/** The MAL writes the page made: [path, episodes]. */
const patched: [string, string][] = [];
vi.mock("./client", () => ({
  describe: () => "",
  malStatus: async () => ({ configured: true, connected: true }),
  malJson: async () => ({
    status: 200,
    data: { num_episodes: 24, my_list_status: { num_episodes_watched: 0 } },
    reply: { status: 200, body: "" },
  }),
  malRequest: async (_method: string, path: string, form: Record<string, string>) => {
    patched.push([path, form.num_watched_episodes]);
    return { status: 200, body: "" };
  },
}));

/** What the Kitsu mapping answers on each call (the last one repeats); null
 * is a failed load. */
type Kitsu = { [id: string]: number } | null;
let kitsuAnswers: (Kitsu | Promise<Kitsu>)[] = [];
let kitsuCalls = 0;
vi.mock("../stream/animemap", async (orig) => ({
  ...(await orig<typeof import("../stream/animemap")>()),
  ensureKitsuIndex: async () => kitsuAnswers[Math.min(kitsuCalls++, kitsuAnswers.length - 1)],
}));

let onEpisodeWatched: typeof import("./sync").onEpisodeWatched;
let onFilmWatched: typeof import("./sync").onFilmWatched;

beforeEach(async () => {
  store.clear();
  patched.length = 0;
  kitsuCalls = 0;
  // What is settled is kept for the run, in the module: start each over.
  vi.resetModules();
  ({ onEpisodeWatched, onFilmWatched } = await import("./sync"));
});

describe("a MAL tick when the mapping can't load", () => {
  it("is pushed on a later tick, once the mapping loads", async () => {
    kitsuAnswers = [null, { "1555": 21 }];
    await onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    expect(patched).toEqual([]);
    await onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    expect(patched).toEqual([["/anime/21/my_list_status", "5"]]);
  });

  it("is asked about no more once it is pushed", async () => {
    kitsuAnswers = [null, { "1555": 21 }];
    for (let i = 0; i < 4; i++) await onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    expect(patched).toHaveLength(1);
    expect(kitsuCalls).toBe(2);
  });

  it("is settled once the mapping loaded and has no entry for it", async () => {
    kitsuAnswers = [{ "1": 1 }];
    for (let i = 0; i < 3; i++) await onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    expect(patched).toEqual([]);
    expect(kitsuCalls).toBe(1);
  });

  it("stays unsettled while the mapping keeps failing", async () => {
    kitsuAnswers = [null];
    for (let i = 0; i < 3; i++) await onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    expect(kitsuCalls).toBe(3);
    expect(patched).toEqual([]);
  });

  it("does not start a second pass while one is waiting on the mapping", async () => {
    let release!: (m: Kitsu) => void;
    kitsuAnswers = [new Promise<Kitsu>((r) => (release = r))];
    const first = onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    // The 5s tick comes round again while the download is out.
    const second = onEpisodeWatched("kitsu:1555", "kitsu:1555:5");
    release({ "1555": 21 });
    await Promise.all([first, second]);
    expect(kitsuCalls).toBe(1);
    expect(patched).toHaveLength(1);
  });

  it("a film is the same: pushed on a later tick", async () => {
    kitsuAnswers = [null, { "3936": 5114 }];
    await onFilmWatched("kitsu:3936");
    expect(patched).toEqual([]);
    await onFilmWatched("kitsu:3936");
    expect(patched).toEqual([["/anime/5114/my_list_status", "1"]]);
  });
});
