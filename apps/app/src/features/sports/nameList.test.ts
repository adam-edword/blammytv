import { describe, expect, it } from "vitest";
import { nameList } from "./nameList";

/**
 * The empty state's sentence, which is the only place the board writes
 * prose about the user's own choices. Getting "F1 and the NBA has nothing
 * scheduled" wrong is the kind of thing that reads as a broken app.
 */
describe("nameList", () => {
  it("says one thing plainly", () => {
    expect(nameList(["F1"])).toBe("F1");
  });

  it("joins two with an and, not a comma", () => {
    expect(nameList(["F1", "NBA"])).toBe("F1 and NBA");
  });

  it("keeps all three when there are three", () => {
    expect(nameList(["F1", "NBA", "Premier League"])).toBe(
      "F1, NBA and Premier League",
    );
  });

  it("counts the tail past three, so the note stays one line", () => {
    expect(nameList(["F1", "NBA", "NHL", "MLB"])).toBe("F1, NBA and 2 more");
    expect(nameList(["a", "b", "c", "d", "e", "f"])).toBe("a, b and 4 more");
  });

  it("is empty for nothing, so a caller cannot print a stray 'and'", () => {
    expect(nameList([])).toBe("");
  });
});
