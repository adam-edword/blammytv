import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

import { forgetCount, forgetJf, loadJf, loadJfConn, noteSignIn } from "./store";

const BASE = "https://jf.example.com";
const on = { supported: true, connected: true, userName: "edd", userId: "u1", base: BASE, serverName: "Home" };

beforeEach(() => mem.clear());

describe("noteSignIn", () => {
  it("records a connected status and says it changed", () => {
    expect(noteSignIn(on)).toBe(true);
    expect(loadJf().signedIn).toEqual({ base: BASE, userName: "edd", userId: "u1", serverName: "Home" });
  });

  it("says nothing changed for the same status again", () => {
    noteSignIn(on);
    expect(noteSignIn(on)).toBe(false);
  });

  it("clears the record when native says it is signed out", () => {
    noteSignIn(on);
    expect(noteSignIn({ supported: true, connected: false })).toBe(true);
    expect(loadJf().signedIn).toBeUndefined();
    expect(noteSignIn({ supported: true, connected: false })).toBe(false);
  });

  it("leaves the record alone for a build with no Jellyfin at all", () => {
    noteSignIn(on);
    expect(noteSignIn({ supported: false, connected: false })).toBe(false);
    expect(loadJf().signedIn?.base).toBe(BASE);
  });

  it("clears a stale problem when a sign-in lands", () => {
    mem.set("blammytv.jellyfin", JSON.stringify({ v: 1, data: { problem: "old" } }));
    noteSignIn(on);
    expect(loadJf().problem).toBeUndefined();
  });
});

describe("loadJfConn", () => {
  it("is null with no sign-in, and with one that lacks a user id", () => {
    expect(loadJfConn()).toBeNull();
    noteSignIn({ supported: true, connected: true, base: BASE });
    expect(loadJfConn()).toBeNull();
  });

  it("names the server and the user for caches, with no secret", () => {
    noteSignIn(on);
    expect(loadJfConn()).toEqual({ base: BASE, userId: "u1", key: `jf:${BASE}|u1` });
  });
});

describe("forgetJf", () => {
  it("empties the store and moves the count a read in flight checks", () => {
    noteSignIn(on);
    const n = forgetCount();
    forgetJf();
    expect(forgetCount()).toBe(n + 1);
    expect(loadJf()).toEqual({});
    expect(loadJfConn()).toBeNull();
  });
});
