import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecRecord } from "../../lib/tauri";
import type { Channel, Programme } from "../live/model";

const MIN = 60_000;
const NOW = new Date("2026-10-30T20:00:00Z").getTime();

let list: RecRecord[] = [];
const startRecording = vi.fn((_a: unknown) => Promise.resolve("r1"));
const scheduleRecording = vi.fn((_a: unknown) => Promise.resolve({ id: "s1" }));
const deleteRecording = vi.fn((_id: string) => Promise.resolve());
const resolveStreamUrl = vi.fn((_c: unknown): Promise<string | null> => Promise.resolve("http://x/live/u/p/7.ts"));

vi.mock("./store", () => ({
  listNow: () => list,
  playlistOf: (id: string) => id.slice(0, id.indexOf(":")),
  startRecording: (a: unknown) => startRecording(a),
  scheduleRecording: (a: unknown) => scheduleRecording(a),
  deleteRecording: (id: string) => deleteRecording(id),
}));
vi.mock("../live/stream", () => ({
  resolveStreamUrl: (c: unknown) => resolveStreamUrl(c),
  streamUserAgent: () => "Agent/1.0",
}));
vi.mock("../settings/recordingsFolder", () => ({ loadRecordingsFolder: () => "D:\\TV" }));
vi.mock("../settings/clockFormat", () => ({ loadClockFormat: () => "24h" }));

import { cancelProgramme, recordProgramme } from "./recordProgramme";

const channel: Channel = { id: "p1:7", name: "BBC One", quality: null, folderId: "", archiveDays: 0 };
const prog = (from: number, len: number): Programme => ({
  title: "News",
  start: new Date(NOW + from),
  end: new Date(NOW + from + len),
});
const running = (o: Partial<RecRecord> = {}): RecRecord => ({
  id: "r",
  channel: "ITV",
  programme: null,
  playlistId: "p1",
  startedAt: NOW - 5 * MIN,
  endedAt: null,
  path: "C:\\v\\r.ts",
  bytes: 0,
  status: "recording",
  reason: null,
  buffer: false,
  ...o,
});

beforeEach(() => {
  list = [];
  startRecording.mockReset().mockResolvedValue("r1");
  scheduleRecording.mockReset().mockResolvedValue({ id: "s1" });
  deleteRecording.mockReset().mockResolvedValue(undefined);
  resolveStreamUrl.mockReset().mockResolvedValue("http://x/live/u/p/7.ts");
});

describe("Record on a programme to come", () => {
  it("keeps it with the programme's own times, not the padded ones (native adds the minute)", async () => {
    const p = prog(60 * MIN, 30 * MIN);
    const said = await recordProgramme(channel, p, { max: 2 }, NOW);
    expect(scheduleRecording).toHaveBeenCalledWith({
      channelId: "p1:7",
      channel: "BBC One",
      programme: "News",
      playlistId: "p1",
      start: p.start.getTime(),
      end: p.end.getTime(),
    });
    expect(startRecording).not.toHaveBeenCalled();
    expect(said).toMatch(/^Scheduled to record News \(.+\)\.$/);
  });

  it("says a clash now, and keeps nothing", async () => {
    list = [running({ startedAt: NOW - MIN })]; // runs until someone stops it
    const said = await recordProgramme(channel, prog(60 * MIN, 30 * MIN), { max: 1 }, NOW);
    expect(said).toBe(
      "Couldn’t schedule: 1 other recording overlaps this one, and your line allows 1 stream at once.",
    );
    expect(scheduleRecording).not.toHaveBeenCalled();
  });

  it("does not call a recording that will be over by then a clash", async () => {
    list = [running({ stopAt: NOW + 30 * MIN })];
    await recordProgramme(channel, prog(60 * MIN, 30 * MIN), { max: 1 }, NOW);
    expect(scheduleRecording).toHaveBeenCalledTimes(1);
  });

  it("does not call two programmes back to back a clash on a one-stream line, though the padding meets", async () => {
    const first = prog(30 * MIN, 30 * MIN);
    list = [
      running({
        id: "s0",
        status: "scheduled",
        startedAt: first.start.getTime(),
        stopAt: first.end.getTime() + MIN,
      }),
    ];
    const said = await recordProgramme(channel, prog(60 * MIN, 30 * MIN), { max: 1 }, NOW);
    expect(said).toMatch(/^Scheduled to record News/);
    expect(scheduleRecording).toHaveBeenCalledTimes(1);
    // Starting a millisecond before the first one ends is a real overlap.
    scheduleRecording.mockClear();
    expect(await recordProgramme(channel, prog(60 * MIN - 1, 30 * MIN), { max: 1 }, NOW)).toMatch(
      /^Couldn’t schedule: 1 other recording overlaps/,
    );
    expect(scheduleRecording).not.toHaveBeenCalled();
  });

  it("goes ahead when the line reports no limit", async () => {
    list = [running(), running({ id: "r2" })];
    await recordProgramme(channel, prog(60 * MIN, 30 * MIN), null, NOW);
    expect(scheduleRecording).toHaveBeenCalledTimes(1);
  });

  it("says why native refused", async () => {
    scheduleRecording.mockRejectedValue("that programme is over");
    const said = await recordProgramme(channel, prog(60 * MIN, 30 * MIN), null, NOW);
    expect(said).toBe("Couldn’t schedule: that programme is over.");
  });
});

describe("Record on a programme that is on", () => {
  it("starts now, as Record in the player does, and stops a minute after the programme", async () => {
    const p = prog(-10 * MIN, 30 * MIN);
    const said = await recordProgramme(channel, p, { max: 2 }, NOW);
    expect(startRecording).toHaveBeenCalledWith({
      url: "http://x/live/u/p/7.ts",
      userAgent: "Agent/1.0",
      channel: "BBC One",
      programme: "News",
      playlistId: "p1",
      folder: "D:\\TV",
      until: p.end.getTime(),
    });
    expect(scheduleRecording).not.toHaveBeenCalled();
    expect(said).toBe("Recording News.");
  });

  it("counts the line from now, so a recording that stops before the programme ends does not block it", async () => {
    list = [running({ stopAt: NOW + 5 * MIN })];
    expect(await recordProgramme(channel, prog(-10 * MIN, 30 * MIN), { max: 1 }, NOW)).toMatch(
      /^Couldn’t record: 1 other recording overlaps/,
    );
    list = [running({ stopAt: NOW - 1 })];
    expect(await recordProgramme(channel, prog(-10 * MIN, 30 * MIN), { max: 1 }, NOW)).toBe("Recording News.");
  });

  it("says when there is no link", async () => {
    resolveStreamUrl.mockResolvedValue(null);
    const said = await recordProgramme(channel, prog(-10 * MIN, 30 * MIN), null, NOW);
    expect(said).toBe("Couldn’t record: there is no link for this channel.");
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("says why native could not start it, with the fix for a full disk", async () => {
    startRecording.mockRejectedValue("not enough free disk space (recording needs 2 GB)");
    const said = await recordProgramme(channel, prog(-10 * MIN, 30 * MIN), null, NOW);
    expect(said).toBe(
      "Couldn’t record: not enough free disk space (recording needs 2 GB). Pick another folder in Settings → Playback.",
    );
  });
});

describe("Cancel Recording", () => {
  it("deletes the scheduled record and says so", async () => {
    expect(await cancelProgramme("s1")).toBe("Recording canceled.");
    expect(deleteRecording).toHaveBeenCalledWith("s1");
  });

  it("says why it could not", async () => {
    deleteRecording.mockRejectedValue("no such recording");
    expect(await cancelProgramme("s1")).toBe("Couldn’t cancel: no such recording.");
  });
});
