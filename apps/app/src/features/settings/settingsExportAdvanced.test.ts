import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySettingsFile, buildSettingsFile } from "./settingsExport";

/**
 * A playlist's Advanced fields (plan 025, P5) live on the playlist, so they
 * travel the way the playlist does: only in the logins group, with the box
 * ticked. An extra-guide address can carry a token as readily as a playlist
 * URL does, and an agent is the playlist's own. Nothing in the export knows
 * about them: they are inside the `playlists` envelope, and these pin that.
 */

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const TOKEN_URL = "https://epg.example.invalid/guide.xml?token=FAKE-TOKEN-NOT-REAL";
const AGENT = "FakeApp/9.1 (Not Real)";
const PLAYLIST = {
  kind: "xtream",
  id: "p1",
  name: "Fake",
  enabled: true,
  server: "http://iptv.example.invalid",
  username: "fake-user",
  password: "FAKE-PASSWORD-NOT-REAL",
  extraGuide: TOKEN_URL,
  userAgent: AGENT,
};

beforeEach(() => {
  mem.clear();
  mem.set("blammytv.playlists", JSON.stringify({ v: 1, data: [PLAYLIST] }));
  mem.set("blammytv.theme", JSON.stringify({ v: 1, data: "light" }));
});

describe("export and the Advanced fields", () => {
  it("a file made without logins holds neither the address nor the agent", () => {
    const text = JSON.stringify(buildSettingsFile({ logins: false }));
    expect(text).not.toContain("FAKE-TOKEN-NOT-REAL");
    expect(text).not.toContain("epg.example.invalid");
    expect(text).not.toContain(AGENT);
    expect(text).not.toContain("playlists");
  });

  it("one made with logins holds both, on the playlist, and Import puts them back as they were", () => {
    const text = JSON.stringify(buildSettingsFile({ logins: true }));
    expect(text).toContain(TOKEN_URL);
    expect(text).toContain(AGENT);
    mem.clear();
    expect(applySettingsFile(text)).toMatchObject({ ok: true });
    expect(JSON.parse(mem.get("blammytv.playlists")!).data[0]).toEqual(PLAYLIST);
  });
});
