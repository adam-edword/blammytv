import { describe, expect, it } from "vitest";
import type { StreamSource } from "../../stream/model";
import { filterPills, viewSources } from "./sourceView";

const src = (id: string, quality: string, cache: StreamSource["cache"]): StreamSource => ({
  id,
  quality,
  cached: cache === "cached",
  cache,
  lines: [id],
  streamUrl: `http://x/${id}`,
});

const list = [
  src("a", "1080p", "uncached"),
  src("b", "720p", "cached"),
  src("c", "2160p", "cached"),
  src("d", "1080p", "cached"),
];

describe("filterPills", () => {
  it("is All, the qualities present highest first, then Cached", () => {
    expect(filterPills(list).map((p) => p.label)).toEqual(["All", "2160p", "1080p", "720p", "Cached"]);
  });
  it("has no Cached pill when nothing is cached, and no quality that is absent", () => {
    expect(filterPills([src("a", "1080p", "unknown")]).map((p) => p.label)).toEqual(["All", "1080p"]);
  });
});

describe("viewSources", () => {
  it("Best Match draws cached first and keeps the addon's order inside a group", () => {
    expect(viewSources(list, "all", "best").map((s) => s.id)).toEqual(["b", "c", "d", "a"]);
  });
  it("Quality is the resolution, highest first, ties in best-match order", () => {
    expect(viewSources(list, "all", "quality").map((s) => s.id)).toEqual(["c", "d", "a", "b"]);
  });
  it("a quality pill keeps that quality, and Cached keeps the cached ones", () => {
    expect(viewSources(list, "q:1080p", "best").map((s) => s.id)).toEqual(["d", "a"]);
    expect(viewSources(list, "cached", "best").map((s) => s.id)).toEqual(["b", "c", "d"]);
  });
});
