import { describe, expect, it, vi } from "vitest";
import type { XtreamPlaylist } from "../settings/playlists";

// The URL builders look credentials up via loadPlaylists(); mock it so the
// tests are independent of any persisted storage.
const PLAYLIST: XtreamPlaylist = {
  kind: "xtream",
  id: "pl1",
  name: "Meteor",
  enabled: true,
  server: "http://tv.example.com:8080/",
  username: "u ser",
  password: "p@ss",
};
vi.mock("../settings/playlists", () => ({
  loadPlaylists: () => [PLAYLIST],
}));

const { catchupStreamUrl, channelStreamUrl, formatTimeshiftStamp } =
  await import("./stream");

describe("formatTimeshiftStamp", () => {
  // 2026-07-08 19:05 UTC — an evening slot whose UTC and (test-run) local
  // wall-clocks are formatted independently.
  const at = new Date(Date.UTC(2026, 6, 8, 19, 5, 0));

  it("formats UTC as YYYY-MM-DD:HH-MM with zero padding, seconds dropped", () => {
    expect(formatTimeshiftStamp(at, "utc")).toBe("2026-07-08:19-05");
  });

  it("formats the machine's local wall-clock in the same shape", () => {
    const y = at.getFullYear();
    const mo = String(at.getMonth() + 1).padStart(2, "0");
    const d = String(at.getDate()).padStart(2, "0");
    const h = String(at.getHours()).padStart(2, "0");
    const mi = String(at.getMinutes()).padStart(2, "0");
    expect(formatTimeshiftStamp(at, "local")).toBe(`${y}-${mo}-${d}:${h}-${mi}`);
  });
});

describe("catchupStreamUrl", () => {
  const start = new Date(Date.UTC(2026, 6, 8, 19, 0, 0));

  it("builds the classic timeshift path with duration + start + stream id", () => {
    expect(catchupStreamUrl("pl1:369852", start, 30, "utc")).toBe(
      "http://tv.example.com:8080/timeshift/u%20ser/p%40ss/30/2026-07-08:19-00/369852.ts",
    );
  });

  it("builds the php scheme with query params when asked", () => {
    expect(catchupStreamUrl("pl1:369852", start, 30, "utc", "php")).toBe(
      "http://tv.example.com:8080/streaming/timeshift.php?username=u+ser&password=p%40ss&stream=369852&start=2026-07-08%3A19-00&duration=30",
    );
  });

  it("rounds the duration to whole minutes and floors at 1", () => {
    expect(catchupStreamUrl("pl1:1", start, 29.6, "utc")).toContain("/30/");
    expect(catchupStreamUrl("pl1:1", start, 0, "utc")).toContain("/1/");
  });

  it("honors the playlist's live extension", () => {
    // (channelStreamUrl shares the same ext handling — sanity that both agree.)
    expect(channelStreamUrl("pl1:1")).toBe(
      "http://tv.example.com:8080/live/u%20ser/p%40ss/1.ts",
    );
  });

  it("returns null for non-Xtream ids and unknown playlists", () => {
    expect(catchupStreamUrl("ch0", start, 30)).toBeNull(); // mock id, no ":"
    expect(catchupStreamUrl("pl1:", start, 30)).toBeNull(); // empty stream id
    expect(catchupStreamUrl("nope:5", start, 30)).toBeNull(); // no such playlist
  });
});
