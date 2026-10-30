import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecRecord } from "../../lib/tauri";

// The native side: what rec_list answers, the events it sends, and the calls.
let listAnswer: RecRecord[] = [];
let emit: (r: RecRecord) => void = () => {};
const tauriRecList = vi.fn(() => Promise.resolve(listAnswer));
const tauriRecStart = vi.fn((_a: unknown) => Promise.resolve("r2"));
const tauriRecBufferStart = vi.fn((_a: unknown) => Promise.resolve("buf"));
const tauriRecStop = vi.fn((id: string) => Promise.resolve(rec({ id, status: "done", endedAt: 9 })));
const tauriRecDelete = vi.fn((_id: string) => Promise.resolve());
const tauriRecSchedule = vi.fn((_a: unknown) => Promise.resolve(rec({ id: "s1", status: "scheduled" })));
// claim.ts brings the playlists with it; what the store hands it is the subject here.
const claimDue = vi.fn((_r: RecRecord) => Promise.resolve());
vi.mock("./claim", () => ({ claimDue: (r: RecRecord) => claimDue(r) }));
vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
  onRecUpdate: (cb: (r: RecRecord) => void) => {
    emit = cb;
    return Promise.resolve(() => {});
  },
  tauriRecList: () => tauriRecList(),
  tauriRecStart: (a: unknown) => tauriRecStart(a),
  tauriRecBufferStart: (a: unknown) => tauriRecBufferStart(a),
  tauriRecStop: (id: string) => tauriRecStop(id),
  tauriRecDelete: (id: string) => tauriRecDelete(id),
  tauriRecSchedule: (a: unknown) => tauriRecSchedule(a),
}));

const rec = (o: Partial<RecRecord> & { id: string }): RecRecord => ({
  channel: "BBC One",
  programme: null,
  playlistId: "p1",
  startedAt: 1000,
  endedAt: null,
  path: "C:\\v\\a.ts",
  bytes: 0,
  status: "recording",
  reason: null,
  buffer: false,
  ...o,
});

/** A fresh store, as a fresh app launch has it, started the way the first hook starts it. */
async function fresh(settle = true) {
  vi.resetModules();
  const mod = await import("./store");
  const off = mod.watch(() => {});
  if (settle) await flush();
  return { mod, list: () => mod.listNow(), keys: () => mod.keysNow(), close: off };
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  listAnswer = [];
  tauriRecList.mockClear();
  tauriRecStart.mockClear();
  tauriRecBufferStart.mockClear();
  tauriRecStop.mockClear();
  tauriRecDelete.mockClear();
  tauriRecSchedule.mockClear();
  claimDue.mockClear();
});

describe("upsert and merge", () => {
  it("keeps the newest first, whatever order they arrive in", async () => {
    const { mod } = await fresh();
    let l = mod.upsert([], rec({ id: "a", startedAt: 100 }));
    l = mod.upsert(l, rec({ id: "b", startedAt: 300 }));
    l = mod.upsert(l, rec({ id: "c", startedAt: 200 }));
    expect(l.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("replaces a record with its id rather than adding a second", async () => {
    const { mod } = await fresh();
    const l = mod.upsert([rec({ id: "a", bytes: 1 })], rec({ id: "a", bytes: 5, status: "done" }));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ bytes: 5, status: "done" });
  });

  it("orders a tie by id, the same way every time", async () => {
    const { mod } = await fresh();
    const a = mod.merge([], [rec({ id: "x" }), rec({ id: "y" })]);
    const b = mod.merge([], [rec({ id: "y" }), rec({ id: "x" })]);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });

  it("merges a list in, the list's version replacing the same id", async () => {
    const { mod } = await fresh();
    const l = mod.merge([rec({ id: "a", bytes: 1 })], [rec({ id: "a", bytes: 9 }), rec({ id: "b", startedAt: 5000 })]);
    expect(l.map((r) => [r.id, r.bytes])).toEqual([
      ["b", 0],
      ["a", 9],
    ]);
  });
});

describe("a running recording, found by its channel and playlist", () => {
  it("finds the running one of that playlist's channel, and no other", async () => {
    const { mod } = await fresh();
    const l = [
      rec({ id: "a", channel: "BBC One", playlistId: "p1" }),
      rec({ id: "b", channel: "BBC One", playlistId: "p2" }),
      rec({ id: "c", channel: "BBC Two", playlistId: "p1" }),
      rec({ id: "d", channel: "ITV", playlistId: "p1", status: "done" }),
    ];
    expect(mod.findRunning(l, "p1", "BBC One")?.id).toBe("a");
    expect(mod.findRunning(l, "p2", "BBC One")?.id).toBe("b");
    expect(mod.findRunning(l, "p1", "ITV")).toBeUndefined(); // finished is not running
    expect(mod.findRunning(l, "p3", "BBC One")).toBeUndefined();
  });

  it("keys the running ones, so a finished one lights nothing", async () => {
    const { mod } = await fresh();
    const keys = mod.runningKeys([
      rec({ id: "a", channel: "BBC One" }),
      rec({ id: "b", channel: "ITV", status: "partial" }),
    ]);
    expect([...keys]).toEqual([mod.recKey("p1", "BBC One")]);
  });

  it("names the playlist in a channel id", async () => {
    const { mod } = await fresh();
    expect(mod.playlistOf("p1:1234")).toBe("p1");
    expect(mod.playlistOf("ch0")).toBe("");
  });
});

describe("the store", () => {
  it("loads once with rec_list, then follows events without asking again", async () => {
    listAnswer = [rec({ id: "a", status: "done", startedAt: 10 })];
    const s = await fresh();
    expect(s.list().map((r) => r.id)).toEqual(["a"]);
    emit(rec({ id: "b", startedAt: 20, bytes: 100 }));
    expect(s.list().map((r) => r.id)).toEqual(["b", "a"]);
    emit(rec({ id: "b", startedAt: 20, bytes: 900, status: "done", endedAt: 30 }));
    expect(s.list()[0]).toMatchObject({ id: "b", bytes: 900, status: "done" });
    expect(tauriRecList).toHaveBeenCalledTimes(1);
    s.close();
  });

  it("does not let a late rec_list put back a row an event has already moved on", async () => {
    let answer!: (l: RecRecord[]) => void;
    tauriRecList.mockImplementationOnce(() => new Promise<RecRecord[]>((r) => (answer = r)));
    const s = await fresh(false);
    emit(rec({ id: "a", status: "done", bytes: 500, endedAt: 9 })); // the event, first
    answer([rec({ id: "a", status: "recording", bytes: 10 }), rec({ id: "z", startedAt: 5 })]); // the older list
    await flush();
    expect(s.list().find((r) => r.id === "a")).toMatchObject({ status: "done", bytes: 500 });
    expect(s.list().some((r) => r.id === "z")).toBe(true);
    s.close();
  });

  it("takes an answer that is not a list as no recordings, and does not throw", async () => {
    tauriRecList.mockResolvedValueOnce(undefined as unknown as RecRecord[]);
    const s = await fresh();
    expect(s.list()).toEqual([]);
    emit(undefined as unknown as RecRecord); // an event with no record in it
    expect(s.list()).toEqual([]);
    emit(rec({ id: "a" }));
    expect(s.list().map((r) => r.id)).toEqual(["a"]);
    s.close();
  });

  it("changes the running keys only when a recording starts or ends, not on growth", async () => {
    const s = await fresh();
    emit(rec({ id: "a", bytes: 1 }));
    const first = s.keys();
    expect(first.size).toBe(1);
    emit(rec({ id: "a", bytes: 999 })); // grew
    expect(s.keys()).toBe(first); // the same set: the Guide is not asked to draw again
    emit(rec({ id: "a", bytes: 999, status: "done", endedAt: 5 }));
    expect(s.keys()).not.toBe(first);
    expect(s.keys().size).toBe(0);
    s.close();
  });

  it("finds the record start answered, asking once when the event has not come", async () => {
    const s = await fresh();
    listAnswer = [rec({ id: "r2", startedAt: 77 })];
    tauriRecList.mockClear();
    const id = await s.mod.startRecording({ url: "http://x/1", channel: "BBC One", playlistId: "p1" });
    expect(id).toBe("r2");
    expect(tauriRecList).toHaveBeenCalledTimes(1);
    expect(s.list().map((r) => r.id)).toEqual(["r2"]);
    s.close();
  });

  it("does not look again when the event came first", async () => {
    const s = await fresh();
    tauriRecStart.mockImplementationOnce(() => {
      emit(rec({ id: "r2" }));
      return Promise.resolve("r2");
    });
    tauriRecList.mockClear();
    await s.mod.startRecording({ url: "http://x/1", channel: "BBC One", playlistId: "p1" });
    expect(tauriRecList).not.toHaveBeenCalled();
    s.close();
  });

  it("keeps the final record a stop answers, and drops a deleted one", async () => {
    const s = await fresh();
    emit(rec({ id: "a" }));
    const fin = await s.mod.stopRecording("a");
    expect(fin.status).toBe("done");
    expect(s.list()[0]).toMatchObject({ id: "a", status: "done" });
    await s.mod.deleteRecording("a");
    expect(s.list()).toEqual([]);
    expect(tauriRecDelete).toHaveBeenCalledWith("a");
    s.close();
  });

  it("leaves the list as it was when native refuses a delete", async () => {
    const s = await fresh();
    emit(rec({ id: "a" }));
    tauriRecDelete.mockRejectedValueOnce("stop the recording first");
    await expect(s.mod.deleteRecording("a")).rejects.toBe("stop the recording first");
    expect(s.list().map((r) => r.id)).toEqual(["a"]);
    s.close();
  });

  it("passes native's reason on when a start is refused", async () => {
    const s = await fresh();
    tauriRecStart.mockRejectedValueOnce("host.example answered 403");
    await expect(
      s.mod.startRecording({ url: "http://x/1", channel: "BBC One", playlistId: "p1" }),
    ).rejects.toBe("host.example answered 403");
    s.close();
  });
});

describe("the connections recordings hold (plan 029)", () => {
  it("counts the running ones per playlist, and not the finished", async () => {
    const { mod } = await fresh();
    const s = mod.streamRecs(
      [
        rec({ id: "a", playlistId: "p1" }),
        rec({ id: "b", playlistId: "p1" }),
        rec({ id: "c", playlistId: "p2" }),
        rec({ id: "d", playlistId: "p1", status: "done" }),
        rec({ id: "e", playlistId: "p1", status: "partial" }),
      ],
    );
    expect([...s.lines]).toEqual([["p1", 2], ["p2", 1]]);
    expect(s.ids).toBe("a,b,c");
  });

  it("does not count a recording of the player's buffer: it opens no connection", async () => {
    const { mod } = await fresh();
    const s = mod.streamRecs([rec({ id: "a" }), rec({ id: "buf", buffer: true })]);
    expect([...s.lines]).toEqual([["p1", 1]]);
    expect(s.ids).toBe("a");
  });

  it("changes its ids on a start or an end, and not on growth", async () => {
    const { mod } = await fresh();
    const before = mod.streamsNow();
    emit(rec({ id: "a" }));
    const started = mod.streamsNow();
    expect(started.ids).toBe("a");
    expect(started).not.toBe(before);
    emit(rec({ id: "a", bytes: 5_000_000 }));
    expect(mod.streamsNow()).toBe(started);
    emit(rec({ id: "a", status: "done", endedAt: 9 }));
    expect(mod.streamsNow().ids).toBe("");
  });

  it("starts a buffer recording through its own call, and never counts it, even before the call answers", async () => {
    const { mod } = await fresh();
    tauriRecBufferStart.mockImplementationOnce(() => {
      emit(rec({ id: "buf", buffer: true }));
      // The event came first: the page has already seen it, and it holds no connection.
      expect(mod.streamsNow().ids).toBe("");
      return Promise.resolve("buf");
    });
    const id = await mod.startBufferRecording({ channel: "BBC One", playlistId: "p1" });
    expect(id).toBe("buf");
    expect(tauriRecStart).not.toHaveBeenCalled();
    expect(mod.streamsNow().ids).toBe("");
    expect(mod.runningNow()).toBe(true);
  });

  it("says whether anything records, buffer or stream", async () => {
    const { mod } = await fresh();
    expect(mod.runningNow()).toBe(false);
    emit(rec({ id: "a" }));
    expect(mod.runningNow()).toBe(true);
    emit(rec({ id: "a", status: "partial", endedAt: 9 }));
    expect(mod.runningNow()).toBe(false);
  });
});

describe("a recording's job (plan 029, Phase 4)", () => {
  it("is working while any record has a job, waiting or running, and not before or after", async () => {
    const { mod } = await fresh();
    expect(mod.workingNow()).toBe(false);
    emit(rec({ id: "a", status: "done", endedAt: 9, job: "remux", progress: null }));
    expect(mod.workingNow()).toBe(true);
    emit(rec({ id: "a", status: "done", endedAt: 9, job: "remux", progress: 0.5 }));
    expect(mod.workingNow()).toBe(true);
    emit(rec({ id: "a", status: "done", endedAt: 9, job: null, progress: null, saved: 10 }));
    expect(mod.workingNow()).toBe(false);
  });

  it("is not a running recording: the two are told apart", async () => {
    const { mod } = await fresh();
    emit(rec({ id: "a", status: "done", endedAt: 9, job: "shrink" }));
    expect(mod.runningNow()).toBe(false);
    expect(mod.workingNow()).toBe(true);
  });

  it("puts a progress update in the row without asking native again", async () => {
    const { mod } = await fresh();
    emit(rec({ id: "a", status: "done", endedAt: 9, job: "shrink", progress: 0 }));
    const asked = tauriRecList.mock.calls.length;
    emit(rec({ id: "a", status: "done", endedAt: 9, job: "shrink", progress: 0.7 }));
    expect(mod.listNow()[0].progress).toBe(0.7);
    expect(tauriRecList.mock.calls.length).toBe(asked);
  });
});

describe("a programme scheduled from the Guide (plan 029, Phase 3)", () => {
  const planned = (o: Partial<RecRecord> = {}) =>
    rec({
      id: "s1",
      status: "scheduled",
      path: "",
      channelId: "p1:7",
      startedAt: 5000,
      startAt: 4000,
      stopAt: 9000,
      ...o,
    });
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("keeps it, answers the Scheduled record, and shows it in the list", async () => {
    const { mod } = await fresh();
    const sent = await mod.scheduleRecording({
      channelId: "p1:7",
      channel: "BBC One",
      programme: "News",
      playlistId: "p1",
      start: 5000,
      end: 8000,
    });
    expect(tauriRecSchedule).toHaveBeenCalledWith({
      channelId: "p1:7",
      channel: "BBC One",
      programme: "News",
      playlistId: "p1",
      start: 5000,
      end: 8000,
    });
    expect(sent.id).toBe("s1");
    expect(mod.listNow().map((r) => r.id)).toEqual(["s1"]);
  });

  it("marks the programme by channel and start, until it is cancelled or settles", async () => {
    const { mod } = await fresh();
    emit(planned());
    expect([...mod.plannedNow()]).toEqual(["p1:7\n5000"]);
    // A running recording marks nothing.
    emit(rec({ id: "r", channelId: "p1:8", startedAt: 6000 }));
    expect(mod.plannedNow().size).toBe(1);
    await mod.deleteRecording("s1");
    expect(mod.plannedNow().size).toBe(0);
    emit(planned());
    emit(planned({ status: "missed" }));
    expect(mod.plannedNow().size).toBe(0);
  });

  it("keeps the same set while a recording only grows, so the Guide is not drawn again", async () => {
    const { mod } = await fresh();
    emit(planned());
    const before = mod.plannedNow();
    emit(rec({ id: "r", bytes: 10 }));
    emit(rec({ id: "r", bytes: 20 }));
    expect(mod.plannedNow()).toBe(before);
  });

  it("hands a due one to claim.ts, once, whether the list or the event brings it", async () => {
    listAnswer = [planned({ due: true })];
    await fresh();
    await settle();
    expect(claimDue).toHaveBeenCalledTimes(1);
    expect(claimDue.mock.calls[0][0]).toMatchObject({ id: "s1", due: true });
    emit(planned({ due: true }));
    emit(planned({ due: true, bytes: 1 }));
    await settle();
    expect(claimDue).toHaveBeenCalledTimes(1);
  });

  it("hands over a due one that arrives as an event, and not before it is due", async () => {
    await fresh();
    emit(planned());
    await settle();
    expect(claimDue).not.toHaveBeenCalled();
    emit(planned({ due: true }));
    await settle();
    expect(claimDue).toHaveBeenCalledTimes(1);
  });

  it("does not hand over a record that is not waiting", async () => {
    await fresh();
    emit(planned({ status: "missed", due: true }));
    emit(planned({ id: "s2", status: "failed", due: true }));
    emit(rec({ id: "r", due: true }));
    await settle();
    expect(claimDue).not.toHaveBeenCalled();
  });

  it("is neither a running recording nor work: restarts wait for neither", async () => {
    const { mod } = await fresh();
    emit(planned({ due: true }));
    expect(mod.runningNow()).toBe(false);
    expect(mod.workingNow()).toBe(false);
    expect(mod.streamsNow().ids).toBe("");
  });
});
