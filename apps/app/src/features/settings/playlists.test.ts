import { describe, expect, it } from "vitest";
import {
  addPlaylist,
  hiddenFolderLabel,
  isCategoryHidden,
  isHttpUrl,
  playlistSource,
  removePlaylist,
  replacePlaylist,
  toggleHiddenCategory,
  togglePlaylist,
  type Playlist,
  setCategoriesHidden,
  setHiddenCategories,
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

describe("replacePlaylist", () => {
  it("keeps the id and the spot, and takes the draft's fields", () => {
    let list: Playlist[] = addPlaylist([], draft("Other"), "a");
    list = addPlaylist(list, draft("Mine"), "b");
    list = addPlaylist(list, draft("Last"), "c");
    const next = replacePlaylist(list, "b", {
      kind: "m3u",
      name: "Mine, again",
      url: "https://x.example/l.m3u8",
    });
    expect(next.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(next[1]).toMatchObject({
      kind: "m3u",
      name: "Mine, again",
      url: "https://x.example/l.m3u8",
      enabled: true,
    });
    // The Xtream fields didn't carry over into the M3U entry.
    expect(next[1]).not.toHaveProperty("server");
    expect(next[0]).toBe(list[0]);
    expect(next[2]).toBe(list[2]);
  });

  it("keeps the enabled switch", () => {
    const list = togglePlaylist(addPlaylist([], draft(), "a"), "a");
    expect(replacePlaylist(list, "a", draft())[0].enabled).toBe(false);
  });

  it("numbers a blank name among the others, not counting itself", () => {
    let list: Playlist[] = addPlaylist([], draft(), "a");
    expect(replacePlaylist(list, "a", draft())[0].name).toBe("Xtream Playlist 1");
    list = addPlaylist(list, draft(), "b");
    expect(replacePlaylist(list, "b", draft())[1].name).toBe("Xtream Playlist 2");
  });

  it("leaves the list alone for an id it doesn't have", () => {
    const list = addPlaylist([], draft("Mine"), "a");
    expect(replacePlaylist(list, "nope", draft("Other"))).toEqual(list);
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

describe("setHiddenCategories (wholesale, the folder editor's Save)", () => {
  it("replaces the hidden set for the addressed playlist only", () => {
    let list = [
      ...addPlaylist([], {
        kind: "xtream",
        name: "A",
        server: "http://a.example",
        username: "u",
        password: "p",
      }),
      ...addPlaylist([], {
        kind: "xtream",
        name: "B",
        server: "http://b.example",
        username: "u",
        password: "p",
      }),
    ];
    list = setCategoriesHidden(list, list[1].id, ["z"], true);
    list = setHiddenCategories(list, list[0].id, ["a", "b"]);
    expect(list[0].hiddenCategories).toEqual(["a", "b"]);
    expect(list[1].hiddenCategories).toEqual(["z"]);
    list = setHiddenCategories(list, list[0].id, []);
    expect(list[0].hiddenCategories).toEqual([]);
  });
});

describe("hiddenFolderLabel", () => {
  // A Stalker portal stores its genre id ("14") for a folder it calls
  // "Sports" (LV8).
  const known = [
    { id: "14", name: "Sports" },
    { id: "7", name: "" },
  ];

  it("is the name the catalog recorded for the id", () => {
    expect(hiddenFolderLabel("14", known)).toBe("Sports");
  });

  it("is the id when the catalog has no name for it", () => {
    expect(hiddenFolderLabel("99", known)).toBe("99");
  });

  it("is the id when the catalog isn't loaded, or its record predates the names", () => {
    expect(hiddenFolderLabel("14", undefined)).toBe("14");
    expect(hiddenFolderLabel("14", [])).toBe("14");
  });

  it("is the id when the portal gave the folder an empty name", () => {
    expect(hiddenFolderLabel("7", known)).toBe("7");
  });

  it("leaves an M3U's folder name alone: its id already is the name", () => {
    expect(hiddenFolderLabel("Sports HD", undefined)).toBe("Sports HD");
  });
});
