import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAioConn } from "./conn";
import { forgetAiojf, saveAiojf } from "./store";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const MANIFEST_URL = "https://aio.example.com/stremio/uuid/secret/manifest.json";
const BASE = "https://aio.example.com/jellyfin";
const putUrl = (u: string) => mem.set("blammytv.aiostreams", JSON.stringify({ v: 1, data: u }));

beforeEach(() => mem.clear());

describe("loadAioConn", () => {
  it("is nothing with no manifest and no sign-in", () => {
    expect(loadAioConn()).toBeNull();
  });

  it("is the manifest when only that is stored", () => {
    putUrl(MANIFEST_URL);
    expect(loadAioConn()).toEqual({ kind: "manifest", url: MANIFEST_URL, key: `manifest:${MANIFEST_URL}` });
  });

  it("is the sign-in when one is held, and the sign-in wins over a manifest", () => {
    putUrl(MANIFEST_URL);
    saveAiojf({ signedIn: { base: BASE, userName: "Adam" } });
    expect(loadAioConn()).toEqual({ kind: "signin", base: BASE, key: `signin:${BASE}|Adam` });
  });

  it("is the sign-in alone, with no manifest at all", () => {
    saveAiojf({ signedIn: { base: BASE } });
    expect(loadAioConn()).toEqual({ kind: "signin", base: BASE, key: `signin:${BASE}|` });
  });

  it("a different user is a different key, so no cache is shared between two", () => {
    saveAiojf({ signedIn: { base: BASE, userName: "Adam" } });
    const a = loadAioConn()?.key;
    saveAiojf({ signedIn: { base: BASE, userName: "Eve" } });
    expect(loadAioConn()?.key).not.toBe(a);
  });

  it("goes back to the manifest when the sign-in is forgotten", () => {
    putUrl(MANIFEST_URL);
    saveAiojf({ signedIn: { base: BASE, userName: "Adam" } });
    forgetAiojf();
    expect(loadAioConn()?.kind).toBe("manifest");
  });

  it("ignores a stored sign-in with no base", () => {
    putUrl(MANIFEST_URL);
    mem.set("blammytv.aiojf", JSON.stringify({ v: 1, data: { signedIn: { userName: "Adam" } } }));
    expect(loadAioConn()?.kind).toBe("manifest");
  });
});
