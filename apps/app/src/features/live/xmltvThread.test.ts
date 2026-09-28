import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inflateGuide } from "./xmltvThread";

const bytesOf = (s: string | Uint8Array) => {
  const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("a guide served as a .xml.gz file", () => {
  const xml = '<?xml version="1.0"?><tv><programme channel="a"><title>News</title></programme></tv>';

  it("is inflated before it is read", async () => {
    const out = await inflateGuide(bytesOf(gzipSync(xml)));
    expect(new TextDecoder().decode(out)).toBe(xml);
  });

  it("and a plain one is handed back as it came", async () => {
    const plain = bytesOf(xml);
    expect(await inflateGuide(plain)).toBe(plain);
    const empty = bytesOf("");
    expect(await inflateGuide(empty)).toBe(empty);
  });
});
