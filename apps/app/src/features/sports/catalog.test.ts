import { describe, expect, it } from "vitest";
import { catalogFor } from "./catalog";
import type { Channel, LiveData } from "../live/model";

const ch = (id: string, name: string): Channel => ({ id, name, quality: null, folderId: "f", archiveDays: 0 }) as Channel;
const guide = (channels: Channel[], hidden: Channel[] = []): LiveData =>
  ({ groups: [], channels, hidden, programmes: new Map() }) as LiveData;

describe("the channel index across refreshes", () => {
  it("is reused for a new guide with the same channels", () => {
    const a = catalogFor(guide([ch("p:1", "ESPN"), ch("p:2", "Sky Sports")]));
    // A refresh: a new object, new arrays, the same channels.
    const b = catalogFor(guide([ch("p:1", "ESPN"), ch("p:2", "Sky Sports")]));
    expect(b).toBe(a);
  });

  it("is rebuilt when a channel changes, arrives or moves to the hidden list", () => {
    const a = catalogFor(guide([ch("p:1", "ESPN"), ch("p:2", "Sky Sports")]));
    expect(catalogFor(guide([ch("p:1", "ESPN 2"), ch("p:2", "Sky Sports")]))).not.toBe(a);
    const b = catalogFor(guide([ch("p:1", "ESPN"), ch("p:2", "Sky Sports")]));
    expect(catalogFor(guide([ch("p:1", "ESPN"), ch("p:2", "Sky Sports"), ch("p:3", "TNT")]))).not.toBe(b);
    const c = catalogFor(guide([ch("p:1", "ESPN"), ch("p:2", "Sky Sports")]));
    expect(catalogFor(guide([ch("p:1", "ESPN")], [ch("p:2", "Sky Sports")]))).not.toBe(c);
  });
});
