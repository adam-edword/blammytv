import { describe, expect, it } from "vitest";
import { EP1, EP2, EP3, FIX, SEVERANCE, ZZZ, ZZZ_EP, item } from "./fixture";
import type { JfItem } from "./items";
import { mediaSourceOf, playedFrom, reportBody, resumeFrom, resumeKey, undecoded, upNextFrom } from "./rules";

const MOVIE = FIX.movieId;
const SEV_KEY = "tt11280740";
/** The shows this device has read. */
const known = (jid: string) => (jid === SEVERANCE ? SEV_KEY : jid === ZZZ ? `jf:${ZZZ}` : undefined);

const withData = (i: JfItem, ud: Record<string, unknown>): JfItem => ({ ...i, UserData: { ...i.UserData, ...ud } }) as JfItem;
const TICKS = 10_000_000;

describe("reportBody", () => {
  it("carries the fields the 12.2 server took, and the real position in ticks", () => {
    expect(reportBody({ itemId: EP1, mediaSourceId: EP1, playSessionId: "ps" }, 12.5)).toEqual({
      ItemId: EP1,
      MediaSourceId: EP1,
      PlaySessionId: "ps",
      PositionTicks: 125_000_000,
      IsPaused: false,
      CanSeek: true,
      PlayMethod: "DirectPlay",
    });
  });

  it("leaves out a media source or play session it does not know, and says paused", () => {
    const b = reportBody({ itemId: EP1 }, 0, true);
    expect(b).not.toHaveProperty("MediaSourceId");
    expect(b).not.toHaveProperty("PlaySessionId");
    expect(b.IsPaused).toBe(true);
    expect(b.PositionTicks).toBe(0);
  });

  it("never carries a credential", () => {
    expect(JSON.stringify(reportBody({ itemId: EP1, mediaSourceId: EP1, playSessionId: "ps" }, 1))).not.toMatch(
      /token|api_?key|authorization/i,
    );
  });
});

describe("mediaSourceOf", () => {
  it("reads it off our stream address", () => {
    expect(mediaSourceOf(`http://h:8096/Videos/${EP1}/stream?static=true&mediaSourceId=${EP1}&tag=x`)).toBe(EP1);
  });
  it("is undefined for anything else", () => {
    expect(mediaSourceOf(undefined)).toBeUndefined();
    expect(mediaSourceOf("not a url")).toBeUndefined();
    expect(mediaSourceOf("http://h/Videos/a/stream?mediaSourceId=nope")).toBeUndefined();
    expect(mediaSourceOf("http://h/Videos/a/stream")).toBeUndefined();
  });
});

describe("resumeFrom", () => {
  const now = Date.UTC(2026, 9, 14);
  it("makes a point of an episode part way through, under its show's key", () => {
    const ep = withData(item(EP2), { PlaybackPositionTicks: 90 * TICKS, LastPlayedDate: "2026-10-13T12:00:00.0000000Z" });
    const { points, jids } = resumeFrom([ep], known, now);
    expect(points).toEqual([
      {
        id: SEV_KEY,
        episodeId: `${SEV_KEY}:1:2`,
        posSec: 90,
        durSec: 30.023,
        at: Date.UTC(2026, 9, 13, 12),
        title: "Severance",
        kind: "series",
        season: 1,
        episode: 2,
        epTitle: "Half Loop",
      },
    ]);
    expect(jids).toEqual({ [resumeKey(SEV_KEY, `${SEV_KEY}:1:2`)]: EP2 });
  });

  it("dates a point with no LastPlayedDate at the sync", () => {
    const ep = withData(item(EP2), { PlaybackPositionTicks: 5 * TICKS, LastPlayedDate: undefined });
    expect(resumeFrom([ep], known, now).points[0].at).toBe(now);
  });

  it("makes a point of a film, with its year", () => {
    const m = withData(item(MOVIE), { PlaybackPositionTicks: 600 * TICKS });
    const { points, jids } = resumeFrom([m], known, now);
    expect(points[0]).toMatchObject({ id: "tt2043923", kind: "movie", title: "The Turn", posSec: 600, year: 2016 });
    expect(points[0]).not.toHaveProperty("episodeId");
    expect(jids[resumeKey("tt2043923")]).toBe(MOVIE);
  });

  it("leaves out an item with no position, a show that is unread, and one with no title", () => {
    const unread = (jid: string) => (jid === SEVERANCE ? undefined : known(jid));
    const ep = withData(item(EP2), { PlaybackPositionTicks: 5 * TICKS });
    expect(resumeFrom([withData(item(EP2), { PlaybackPositionTicks: 0 })], known, now).points).toEqual([]);
    expect(resumeFrom([ep], unread, now).points).toEqual([]);
    expect(resumeFrom([{ ...withData(item(MOVIE), { PlaybackPositionTicks: 5 * TICKS }), Name: undefined }], known, now).points).toEqual([]);
    expect(resumeFrom([{ ...ep, SeriesName: undefined }], known, now).points).toEqual([]);
  });

  it("keys an episode of a show with no IMDb id by its own id", () => {
    const ep = withData(item(ZZZ_EP), { PlaybackPositionTicks: 5 * TICKS, Played: false });
    const { points } = resumeFrom([ep], known, now);
    expect(points[0]).toMatchObject({ id: `jf:${ZZZ}`, episodeId: `jf:${ZZZ_EP}` });
  });
});

describe("playedFrom", () => {
  it("counts only UserData.Played, never PlayCount", () => {
    const played = withData(item(EP1), { Played: true, PlayCount: 1 });
    const manyStops = withData(item(EP2), { Played: false, PlayCount: 9 });
    const p = playedFrom([played, manyStops], known);
    expect(p.episodes).toEqual({ [SEV_KEY]: [`${SEV_KEY}:1:1`] });
    expect(p.films).toEqual([]);
  });

  it("ticks a film under its key, and an episode of a show with no IMDb id under its own", () => {
    const p = playedFrom([item(MOVIE), item(ZZZ_EP)], known);
    expect(p.films).toEqual(["tt2043923"]);
    expect(p.episodes).toEqual({ [`jf:${ZZZ}`]: [`jf:${ZZZ_EP}`] });
  });

  it("orders episodes by season then number, whatever order the server gave", () => {
    const all = [EP3, EP1, EP2].map((id) => withData(item(id), { Played: true }));
    expect(playedFrom(all, known).episodes[SEV_KEY]).toEqual([`${SEV_KEY}:1:1`, `${SEV_KEY}:1:2`, `${SEV_KEY}:1:3`]);
  });

  it("counts an episode of an unread show as skipped, and does not guess its key", () => {
    const p = playedFrom([withData(item(EP1), { Played: true })], () => undefined);
    expect(p).toEqual({ episodes: {}, films: [], skipped: 1 });
  });

  it("ticks an episode once however many times it is listed", () => {
    const e = withData(item(EP1), { Played: true });
    expect(playedFrom([e, e], known).episodes[SEV_KEY]).toEqual([`${SEV_KEY}:1:1`]);
  });
});

describe("upNextFrom", () => {
  it("makes a card of an episode, with the show's art path and the episode's label", () => {
    const [c] = upNextFrom([item(EP2)], known);
    expect(c).toMatchObject({
      seriesId: SEV_KEY,
      episodeId: `${SEV_KEY}:1:2`,
      seriesTitle: "Severance",
      label: expect.stringContaining("Half Loop"),
    });
    expect(c.imagePath).toMatch(new RegExp(`^/Items/${SEVERANCE}/Images/Primary\\?tag=[0-9a-f]{32}$`));
    expect(JSON.stringify(c)).not.toMatch(/token|api_?key/i);
  });

  it("leaves out a film, and an episode of a show that is unread", () => {
    expect(upNextFrom([item(MOVIE)], known)).toEqual([]);
    expect(upNextFrom([item(EP2)], () => undefined)).toEqual([]);
  });
});

describe("undecoded", () => {
  it("counts what is not a film, a show or an episode of a known show", () => {
    const folder = { Id: "a".repeat(32), Type: "Folder" } as JfItem;
    expect(undecoded([item(EP1), item(MOVIE), folder], known)).toBe(1);
    expect(undecoded([item(EP1)], () => undefined)).toBe(1);
  });
});
