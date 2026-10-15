import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIO_CONN_CHANGED, loadAioUrl, saveAioUrl } from "./aiostreams";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const dispatchEvent = vi.fn();
vi.stubGlobal("window", { dispatchEvent });
const said = () => dispatchEvent.mock.calls.map(([e]) => (e as Event).type);

const URL_A = "https://aio.example.com/stremio/a/manifest.json";

beforeEach(() => {
  mem.clear();
  dispatchEvent.mockClear();
});

describe("saveAioUrl says the connection changed", () => {
  it("when a manifest is saved, changed or cleared", () => {
    saveAioUrl(URL_A);
    saveAioUrl(URL_A + "?x=1");
    saveAioUrl("");
    expect(said()).toEqual([AIO_CONN_CHANGED, AIO_CONN_CHANGED, AIO_CONN_CHANGED]);
    expect(loadAioUrl()).toBe("");
  });

  it("not when the same one is saved again, or nothing is cleared", () => {
    saveAioUrl("");
    saveAioUrl(URL_A);
    dispatchEvent.mockClear();
    saveAioUrl(`  ${URL_A}  `);
    expect(said()).toEqual([]);
  });
});
