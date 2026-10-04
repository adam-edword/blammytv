import { describe, expect, it } from "vitest";
import { sendQueued } from "./sync";

describe("sendQueued", () => {
  it("answers the marks AIOStreams settled, and leaves the rest", async () => {
    const answers: Record<string, { status: number } | null> = {
      a: { status: 200 },
      b: { status: 503 },
      c: null,
      d: { status: 404 },
    };
    const sent = await sendQueued(["a", "b", "c", "d"], async (id) => answers[id]);
    expect(sent).toEqual(["a", "d"]);
  });

  it("counts a send that throws as not sent", async () => {
    const sent = await sendQueued(["a", "b"], async (id) => {
      if (id === "a") throw new Error("offline");
      return { status: 200 };
    });
    expect(sent).toEqual(["b"]);
  });

  it("stops at a 401, since the rest would all be refused", async () => {
    const asked: string[] = [];
    const sent = await sendQueued(["a", "b", "c"], async (id) => {
      asked.push(id);
      return { status: id === "b" ? 401 : 200 };
    });
    expect(asked).toEqual(["a", "b"]);
    expect(sent).toEqual(["a"]);
  });
});
