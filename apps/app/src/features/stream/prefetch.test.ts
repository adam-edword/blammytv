import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamSource } from "./model";
import { dropPrefetch, PREFETCH_TTL_MS, prefetchSources, takePrefetched } from "./prefetch";

const src = (id: string): StreamSource => ({
  id,
  quality: "1080p",
  cached: true,
  cache: "cached",
  lines: [],
  streamUrl: `http://h/${id}`,
});

const T0 = 1_000_000;

beforeEach(() => dropPrefetch());

describe("the kept list for the next episode", () => {
  it("is handed over while it is under 180 seconds old", async () => {
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    const got = takePrefetched("tt1:1:2", T0 + PREFETCH_TTL_MS - 1);
    expect(got).not.toBeNull();
    expect((await got)?.map((s) => s.id)).toEqual(["a"]);
  });

  it("is stale at 180 seconds, and nothing is handed over", () => {
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    expect(takePrefetched("tt1:1:2", T0 + PREFETCH_TTL_MS)).toBeNull();
  });

  it("is not handed over for another episode", () => {
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    expect(takePrefetched("tt1:1:3", T0)).toBeNull();
  });

  it("is spent by taking it: the roll that used it starts a new play", () => {
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    expect(takePrefetched("tt1:1:2", T0)).not.toBeNull();
    expect(takePrefetched("tt1:1:2", T0)).toBeNull();
  });

  it("is forgotten when the ask is rejected, and never handed over", async () => {
    let fail: (e: Error) => void = () => {};
    prefetchSources("tt1:1:2", () => new Promise<StreamSource[]>((_, no) => (fail = no)), T0);
    fail(new Error("AIOStreams is busy"));
    // Let the rejection reach the handler that forgets it.
    await Promise.resolve();
    await Promise.resolve();
    expect(takePrefetched("tt1:1:2", T0)).toBeNull();
  });

  it("a rejected ask does not stop the next one: the end of the file tries again", async () => {
    let fail: (e: Error) => void = () => {};
    prefetchSources("tt1:1:2", () => new Promise<StreamSource[]>((_, no) => (fail = no)), T0);
    fail(new Error("nope"));
    await Promise.resolve();
    await Promise.resolve();
    const ask = vi.fn(async () => [src("b")]);
    prefetchSources("tt1:1:2", ask, T0 + 5_000);
    expect(ask).toHaveBeenCalledTimes(1);
    expect((await takePrefetched("tt1:1:2", T0 + 5_000))?.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("asking", () => {
  it("asks once for an episode: the end of the file leaves a young list alone", () => {
    const ask = vi.fn(async () => [src("a")]);
    prefetchSources("tt1:1:2", ask, T0);
    prefetchSources("tt1:1:2", ask, T0 + 90_000);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again once the kept list is stale", () => {
    const ask = vi.fn(async () => [src("a")]);
    prefetchSources("tt1:1:2", ask, T0);
    prefetchSources("tt1:1:2", ask, T0 + PREFETCH_TTL_MS);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("keeps one list at a time: another episode replaces it", async () => {
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    prefetchSources("tt1:1:3", async () => [src("b")], T0 + 1);
    expect((await takePrefetched("tt1:1:3", T0 + 2))?.map((s) => s.id)).toEqual(["b"]);
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    prefetchSources("tt1:1:3", async () => [src("b")], T0 + 1);
    expect(takePrefetched("tt1:1:2", T0 + 2)).toBeNull();
  });

  it("drops what is kept on request (a stop, a new play, a source switch)", () => {
    prefetchSources("tt1:1:2", async () => [src("a")], T0);
    dropPrefetch();
    expect(takePrefetched("tt1:1:2", T0)).toBeNull();
  });
});
