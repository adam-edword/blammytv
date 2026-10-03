import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

/** What Trakt answers to a history POST, by the movie's IMDb id; a missing
 * entry is no answer at all (the request threw). */
let answers: Record<string, number | "throw"> = {};
const sent: string[] = [];
vi.mock("./client", () => ({
  traktStatus: async () => ({ configured: true, connected: true }),
  traktJson: async (_method: string, _path: string, body: { movies: { ids: { imdb: string } }[] }) => {
    const imdb = body.movies[0].ids.imdb;
    sent.push(imdb);
    const a = answers[imdb];
    if (a === "throw" || a === undefined) throw new Error("no answer");
    return { status: a, data: null, reply: { status: a, body: "" } };
  },
}));

const { sendQueued } = await import("./sync");
const { dropFromQueue, loadQueue, queueWatch } = await import("./store");

const watch = (imdb: string) => ({ movies: [{ ids: { imdb } }] });
const imdbs = (list: { movies?: { ids: { imdb: string } }[] }[]) => list.map((b) => b.movies?.[0].ids.imdb);

describe("the queue drain", () => {
  beforeEach(() => {
    mem.clear();
    answers = {};
    sent.length = 0;
  });

  it("drops what Trakt took, and what it will never take", async () => {
    answers = { tt201: 201, tt404: 404, tt409: 409, tt422: 422 };
    const out = await sendQueued([watch("tt201"), watch("tt404"), watch("tt409"), watch("tt422")]);
    expect(imdbs(out)).toEqual(["tt201", "tt404", "tt409", "tt422"]);
  });

  it("keeps a 401, 403 and 408, which it used to drop", async () => {
    answers = { tt401: 401, tt403: 403, tt408: 408 };
    expect(await sendQueued([watch("tt401"), watch("tt403"), watch("tt408")])).toEqual([]);
  });

  it("keeps the 429, the 5xx and the no-answer it always kept", async () => {
    answers = { tt429: 429, tt500: 500, tt503: 503, ttnone: "throw" };
    expect(await sendQueued([watch("tt429"), watch("tt500"), watch("tt503"), watch("ttnone")])).toEqual([]);
  });

  it("tries every entry, so one kept watch does not hold up the next", async () => {
    answers = { tt403: 403, tt201: 201 };
    const out = await sendQueued([watch("tt403"), watch("tt201")]);
    expect(sent).toEqual(["tt403", "tt201"]);
    expect(imdbs(out)).toEqual(["tt201"]);
  });

  it("leaves a kept watch in the queue once what was sent is dropped", async () => {
    queueWatch(watch("tt403"));
    queueWatch(watch("tt201"));
    answers = { tt403: 403, tt201: 201 };
    dropFromQueue(await sendQueued(loadQueue()));
    expect(loadQueue()).toEqual([watch("tt403")]);
  });
});
