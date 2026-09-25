import { describe, expect, it } from "vitest";
import {
  FROZEN_MS,
  HEALTHY_MS,
  MAX_TRIES,
  STAGGER_MS,
  ROOM_WAIT_MS,
  hasRoom,
  mayReconnect,
  newWatch,
  nextSlot,
  passGate,
  spend,
  watchStep,
} from "./mvRecover";
import { explainFailure } from "./mvTile";

describe("mayReconnect", () => {
  const f = (retry: boolean) => ({ kind: "unknown" as const, title: "", reason: "", retry });
  it("reconnects a tile that was playing, from a failure a retry could help", () => {
    expect(mayReconnect(f(true), true)).toBe(true);
  });
  it("leaves a first connection's failure to say what it is", () => {
    expect(mayReconnect(f(true), false)).toBe(false);
  });
  it("never retries a codec", () => {
    expect(mayReconnect(f(false), true)).toBe(false);
  });
});

describe("spend", () => {
  it("allows MAX_TRIES reconnects, then gives up", () => {
    let tries = 0;
    for (let i = 0; i < MAX_TRIES; i++) {
      const s = spend(tries, null, 1000);
      expect(s.give).toBe(true);
      tries = s.tries;
    }
    expect(spend(tries, null, 1000).give).toBe(false);
  });
  it("refills after a minute of picture", () => {
    expect(spend(MAX_TRIES, 0, HEALTHY_MS).give).toBe(true);
    expect(spend(MAX_TRIES, 0, HEALTHY_MS).tries).toBe(1);
  });
  it("but not after a picture that came and went", () => {
    expect(spend(MAX_TRIES, 0, HEALTHY_MS - 1).give).toBe(false);
  });
});

describe("watchStep", () => {
  const run = (samples: [number, number, boolean?][]) => {
    let w = newWatch(0);
    let frozen = false;
    for (const [frames, at, looking = true] of samples) {
      const r = watchStep(w, frames, at, looking);
      w = r.w;
      frozen = r.frozen;
    }
    return frozen;
  };
  it("calls a picture that stops moving frozen after FROZEN_MS", () => {
    expect(run([[0, 0], [10, 2000], [10, 2000 + FROZEN_MS - 1]])).toBe(false);
    expect(run([[0, 0], [10, 2000], [10, 2000 + FROZEN_MS]])).toBe(true);
  });
  it("counts nothing until a frame has really moved", () => {
    expect(run([[0, 0], [0, FROZEN_MS * 3]])).toBe(false);
  });
  it("doesn't count time it couldn't look (hidden, paused)", () => {
    expect(run([[0, 0], [10, 2000], [10, 2000 + FROZEN_MS, false], [10, 2000 + FROZEN_MS + 1000]])).toBe(false);
  });
  it("a frame moving again starts the count over", () => {
    expect(run([[0, 0], [10, 2000], [11, 2000 + FROZEN_MS - 1], [11, 2000 + FROZEN_MS + 100]])).toBe(false);
  });
});

describe("hasRoom", () => {
  it("waits while the line reads full, the tile's own old connection included", () => {
    expect(hasRoom({ max: 3, active: 3 })).toBe(false);
    expect(hasRoom({ max: 3, active: 2 })).toBe(true);
  });
  it("has room when there is no count to go by", () => {
    expect(hasRoom(null)).toBe(true);
  });
});

describe("nextSlot", () => {
  it("spaces reconnects STAGGER_MS apart", () => {
    const a = nextSlot(0, 10_000);
    expect(a.wait).toBe(0);
    const b = nextSlot(a.at, 10_000);
    expect(b.wait).toBe(STAGGER_MS);
    const c = nextSlot(b.at, 10_500);
    expect(c.wait).toBe(STAGGER_MS * 2 - 500);
  });
});

describe("the words (R9)", () => {
  it("your provider unreachable when its own server fails, not the channel off the air", () => {
    const f = explainFailure("ESPN", {
      code: 502,
      statusText: "Bad Gateway: could not connect (http://provider.tv): No such host is known. (os error 11001)",
    });
    expect(f.kind).toBe("unreachable");
    expect(f.title).toBe("Can’t reach your provider");
  });
  it("still the channel's server when the provider sent it on to one that fails", () => {
    const f = explainFailure("ESPN", {
      code: 502,
      statusText: "Bad Gateway: could not connect (http://provider.tv -> http://edge.example): No such host is known.",
    });
    expect(f.kind).toBe("offair");
  });
  it("a picture that stopped is frozen, with a retry", () => {
    const f = explainFailure("ESPN", { frozen: true });
    expect(f.kind).toBe("frozen");
    expect(f.retry).toBe(true);
  });
});

describe("passGate", () => {
  /** A gate on a clock the test moves: sleeping advances it. */
  const rig = (room: (t: number) => boolean, last = -Infinity) => {
    let t = 0;
    const log: string[] = [];
    const deps = {
      room: () => room(t),
      waiting: (on: boolean) => void log.push(on ? "waiting" : "done waiting"),
      sleep: async (ms: number) => {
        t += ms;
      },
      now: () => t,
      turn: { last },
      fresh: () => void log.push(`fresh at ${t}`),
    };
    return { deps, log, at: () => t };
  };

  it("goes straight through with room, asking for a fresh link", async () => {
    const r = rig(() => true);
    await passGate(r.deps);
    expect(r.log).toEqual(["fresh at 0"]);
  });

  it("waits while the line is full, until the count shows a slot", async () => {
    const r = rig((t) => t >= 7000);
    await passGate(r.deps);
    expect(r.log).toEqual(["waiting", "done waiting", "fresh at 7000"]);
  });

  it("but not forever", async () => {
    const r = rig(() => false);
    await passGate(r.deps);
    expect(r.at()).toBe(ROOM_WAIT_MS);
    expect(r.log.at(-1)).toBe(`fresh at ${ROOM_WAIT_MS}`);
  });

  it("takes its turn after the last reconnect", async () => {
    const r = rig(() => true, -500);
    await passGate(r.deps);
    expect(r.log).toEqual([`fresh at ${STAGGER_MS - 500}`]);
    expect(r.deps.turn.last).toBe(STAGGER_MS - 500);
  });
});
