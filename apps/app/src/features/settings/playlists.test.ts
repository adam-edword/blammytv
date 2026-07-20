import { describe, expect, it } from "vitest";
import {
  addPlaylist,
  isCategoryHidden,
  isHttpUrl,
  playlistSource,
  removePlaylist,
  toggleHiddenCategory,
  togglePlaylist,
  type Playlist,
  setCategoriesHidden,
} from "./playlists";

const draft = (name = "") => ({
  kind: "xtream" as const,
  name,
  server: "https://host.example",
  username: "u",
  password: "p",
});

describe("addPlaylist", () => {
  it("appends enabled, with the given name", () => {
    const list = addPlaylist([], draft("Mine"), "id1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "id1", name: "Mine", enabled: true });
  });

  it("numbers default names per kind, like the design examples", () => {
    let list: Playlist[] = addPlaylist([], draft(), "a");
    list = addPlaylist(list, draft(), "b");
    list = addPlaylist(
      list,
      { kind: "m3u", name: "", url: "https://x.example/l.m3u8" },
      "c",
    );
    expect(list.map((p) => p.name)).toEqual([
      "Xtream Playlist 1",
      "Xtream Playlist 2",
      "M3U Playlist 1",
    ]);
  });
});

describe("toggle / remove", () => {
  it("flips only the matching id", () => {
    const list = addPlaylist(addPlaylist([], draft(), "a"), draft(), "b");
    const toggled = togglePlaylist(list, "b");
    expect(toggled.map((p) => p.enabled)).toEqual([true, false]);
    expect(removePlaylist(toggled, "a").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("helpers", () => {
  it("shows the right source address per kind", () => {
    expect(playlistSource(addPlaylist([], draft(), "a")[0])).toBe(
      "https://host.example",
    );
  });

  it("accepts only http(s) URLs", () => {
    expect(isHttpUrl("https://ok.example")).toBe(true);
    expect(isHttpUrl("http://ok.example:8080")).toBe(true);
    expect(isHttpUrl("ftp://no.example")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("hidden categories", () => {
  it("toggles per playlist and leaves others alone", () => {
    let list = addPlaylist(addPlaylist([], draft(), "a"), draft(), "b");
    list = toggleHiddenCategory(list, "a", "sports");
    expect(isCategoryHidden(list[0], "sports")).toBe(true);
    expect(isCategoryHidden(list[1], "sports")).toBe(false);
    list = toggleHiddenCategory(list, "a", "sports");
    expect(isCategoryHidden(list[0], "sports")).toBe(false);
  });

  it("treats older saves without the field as nothing hidden", () => {
    const legacy = addPlaylist([], draft(), "a")[0];
    delete (legacy as { hiddenCategories?: string[] }).hiddenCategories;
    expect(isCategoryHidden(legacy, "anything")).toBe(false);
  });
});

describe("setCategoriesHidden (batch, drives the folder editor's toggle-all)", () => {
  const base = () =>
    addPlaylist([], {
      kind: "xtream",
      name: "TV",
      server: "http://x.example",
      username: "u",
      password: "p",
    });

  it("hides many at once and unions with existing hidden ids", () => {
    let list = base();
    const id = list[0].id;
    list = toggleHiddenCategory(list, id, "a");
    list = setCategoriesHidden(list, id, ["b", "c", "a"], true);
    expect([...(list[0].hiddenCategories ?? [])].sort()).toEqual(["a", "b", "c"]);
  });

  it("shows many at once, leaving unrelated hidden ids alone", () => {
    let list = base();
    const id = list[0].id;
    list = setCategoriesHidden(list, id, ["a", "b", "c"], true);
    list = setCategoriesHidden(list, id, ["a", "c"], false);
    expect(list[0].hiddenCategories).toEqual(["b"]);
  });

  it("touches only the addressed playlist", () => {
    let list = [...base(), ...base()];
    list = setCategoriesHidden(list, list[0].id, ["x"], true);
    expect(list[1].hiddenCategories ?? []).toEqual([]);
  });
});
