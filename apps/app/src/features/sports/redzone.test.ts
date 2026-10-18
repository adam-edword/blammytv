import { describe, expect, it } from "vitest";
import { extractQuality } from "../live/quality";
import type { Channel } from "../live/model";
import { NFL, redzoneChannel, redzoneOn } from "./redzone";
import type { Fixture, GameState } from "./model";

const game = (id: string, leagueKey: string, state: GameState): Fixture => ({
  kind: "fixture",
  id,
  sport: leagueKey.split("/")[0],
  league: leagueKey,
  leagueKey,
  state,
  start: new Date(2026, 9, 18, 13),
  status: "3rd 07:22",
  broadcasts: ["CBS"],
  channels: [],
  home: { name: "Home", abbr: "HOM", id: `h${id}` },
  away: { name: "Away", abbr: "AWY", id: `a${id}` },
});

describe("redzoneOn", () => {
  it("is off with no NFL game in progress", () => {
    expect(redzoneOn([])).toBe(false);
  });

  it("is off with one: a Thursday, Sunday or Monday night game is alone and RedZone is not on", () => {
    expect(redzoneOn([game("1", NFL, "live")])).toBe(false);
  });

  it("is on with two", () => {
    expect(redzoneOn([game("1", NFL, "live"), game("2", NFL, "live")])).toBe(true);
  });

  it("is on with more than two", () => {
    expect(redzoneOn([1, 2, 3, 4].map((n) => game(`${n}`, NFL, "live")))).toBe(true);
  });

  it("does not count a live game in another league", () => {
    expect(
      redzoneOn([
        game("1", NFL, "live"),
        game("2", "basketball/nba", "live"),
        game("3", "football/college-football", "live"),
      ]),
    ).toBe(false);
  });

  it("does not count an NFL game that is finished or has not started", () => {
    expect(
      redzoneOn([game("1", NFL, "live"), game("2", NFL, "final"), game("3", NFL, "pre")]),
    ).toBe(false);
  });
});

const ch = (id: string, name: string): Channel => ({
  id,
  name,
  quality: extractQuality(name),
  folderId: "f",
  archiveDays: 0,
});

const ON = ["a", "b"];

describe("redzoneChannel: which name is RedZone", () => {
  it.each([
    "US: NFL Redzone",
    "NFL RedZone HD",
    "NFL Red Zone 4K",
    "REDZONE",
    "red zone",
    "NFL RED ZONE",
    // Adam's provider (folder "USA | NFL Backup").
    "NFL REDZONE SUNDAY",
  ])("matches %s", (name) => {
    expect(redzoneChannel([ch("a:1", name)], ON)?.id).toBe("a:1");
  });

  // The event channels in that same folder say NFL and a slot, never RedZone.
  it.each([
    "Red Sox Network",
    "Red",
    "Bored Zone",
    "Redbull TV",
    "Zone Red",
    "NFL Network",
    "NFL | 01 - Bills vs Dolphins",
    "NFL | 02 - 9:30a Jaguars vs Bears",
    "NFL | 03 - 1pm Chiefs vs Raiders",
    "NFL | 13 - SNF Cowboys vs Eagles",
  ])(
    "does not match %s",
    (name) => {
      expect(redzoneChannel([ch("a:1", name)], ON)).toBeNull();
    },
  );

  it("is null for an empty catalog", () => {
    expect(redzoneChannel([], ON)).toBeNull();
  });
});

describe("redzoneChannel: which of several", () => {
  it("prefers a name that also says NFL, even over a better picture", () => {
    const got = redzoneChannel(
      [ch("a:1", "RedZone 4K"), ch("a:2", "NFL RedZone"), ch("a:3", "Sports RedZone FHD")],
      ON,
    );
    expect(got?.id).toBe("a:2");
  });

  it("then takes the best quality: 4K, HDR, FHD, HD, then none", () => {
    const names = ["NFL RedZone", "NFL RedZone HD", "NFL RedZone FHD", "NFL RedZone HDR", "NFL RedZone 4K"];
    const list = names.map((n, i) => ch(`a:${i}`, n));
    expect(redzoneChannel(list, ON)?.name).toBe("NFL RedZone 4K");
    expect(redzoneChannel(list.slice(0, 4), ON)?.name).toBe("NFL RedZone HDR");
    expect(redzoneChannel(list.slice(0, 3), ON)?.name).toBe("NFL RedZone FHD");
    expect(redzoneChannel(list.slice(0, 2), ON)?.name).toBe("NFL RedZone HD");
  });

  it("then the first in the list", () => {
    const got = redzoneChannel([ch("a:7", "NFL RedZone HD"), ch("b:1", "US: NFL Redzone HD")], ON);
    expect(got?.id).toBe("a:7");
  });

  it("counts quality even when no name says NFL", () => {
    const got = redzoneChannel([ch("a:1", "RedZone HD"), ch("a:2", "RedZone FHD")], ON);
    expect(got?.id).toBe("a:2");
  });
});

describe("redzoneChannel: playlists", () => {
  it("ignores a channel on a playlist that is not enabled", () => {
    const list = [ch("off:1", "NFL RedZone 4K"), ch("a:2", "NFL RedZone")];
    expect(redzoneChannel(list, ON)?.id).toBe("a:2");
  });

  it("is null when the only RedZone is on a disabled playlist", () => {
    expect(redzoneChannel([ch("off:1", "NFL RedZone 4K")], ON)).toBeNull();
  });

  it("is null with no playlist enabled", () => {
    expect(redzoneChannel([ch("a:1", "NFL RedZone")], [])).toBeNull();
  });

  it("does not take a playlist id that only starts the same", () => {
    // "a" is enabled, "ab" is not: "ab:1" must not pass for "a:".
    expect(redzoneChannel([ch("ab:1", "NFL RedZone")], ["a"])).toBeNull();
  });
});
