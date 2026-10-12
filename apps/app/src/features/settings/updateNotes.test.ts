import { describe, expect, it } from "vitest";
import { NOTES_LINES, NOTES_LINE_CHARS, noteLines } from "./updateNotes";

describe("noteLines", () => {
  it("shows nothing for nothing", () => {
    expect(noteLines("")).toEqual([]);
    expect(noteLines("   \n \n\t\n")).toEqual([]);
    expect(noteLines(null)).toEqual([]);
    expect(noteLines(undefined)).toEqual([]);
    expect(noteLines(7 as unknown as string)).toEqual([]);
  });

  it("strips the # from a heading and keeps the lines", () => {
    expect(noteLines("# Big one\nLine two")).toEqual(["Big one", "Line two"]);
    expect(noteLines("## A\n### B\n#### C")).toEqual(["A", "B", "C"]);
    expect(noteLines("  # Indented heading")).toEqual(["Indented heading"]);
    // A heading with nothing after the marks is a blank line.
    expect(noteLines("one\n##\ntwo")).toEqual(["one", "", "two"]);
  });

  it("strips a heading's # and nothing that only looks like one", () => {
    // No space after it: an issue number, a tag, a colour.
    expect(noteLines("#1 fix")).toEqual(["#1 fix"]);
    expect(noteLines("#hashtag")).toEqual(["#hashtag"]);
    // Seven is not a heading, and a # in the middle is just a #.
    expect(noteLines("####### seven")).toEqual(["####### seven"]);
    expect(noteLines("fixes # 12")).toEqual(["fixes # 12"]);
    // Four spaces in is code, not a heading.
    expect(noteLines("    # code")).toEqual(["# code"]);
  });

  it("keeps markup as the characters it is made of", () => {
    expect(noteLines("<b>x</b>")).toEqual(["<b>x</b>"]);
    expect(noteLines("<img src=x onerror=alert(1)>")).toEqual(["<img src=x onerror=alert(1)>"]);
    expect(noteLines("- a **bold** [link](https://example.test)")).toEqual([
      "- a **bold** [link](https://example.test)",
    ]);
  });

  it("takes any line ending", () => {
    expect(noteLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps one blank line between paragraphs, never first, last or twice", () => {
    expect(noteLines("\n\nfirst\n\n\n\nsecond\n\n")).toEqual(["first", "", "second"]);
  });

  it("shows a note of exactly the cap as it is", () => {
    const six = Array.from({ length: NOTES_LINES }, (_, i) => `line ${i + 1}`);
    expect(noteLines(six.join("\n"))).toEqual(six);
  });

  it("cuts a longer note at the cap and ends it with a line that says there is more", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const got = noteLines(ten.join("\n"));
    expect(got).toEqual([...ten.slice(0, NOTES_LINES), "…"]);
    expect(got).toHaveLength(NOTES_LINES + 1);
  });

  it("does not leave a blank line before the …", () => {
    const text = ["a", "b", "c", "d", "e", "", "g", "h"].join("\n");
    // The sixth line of the note is blank: the … follows the fifth.
    expect(noteLines(text)).toEqual(["a", "b", "c", "d", "e", "…"]);
  });

  it("cuts a very long line, and not in the middle of a character", () => {
    const got = noteLines("x".repeat(NOTES_LINE_CHARS + 50));
    expect(got).toHaveLength(1);
    expect([...got[0]]).toHaveLength(NOTES_LINE_CHARS);
    expect(got[0].endsWith("…")).toBe(true);
    const emoji = noteLines("😀".repeat(NOTES_LINE_CHARS + 5))[0];
    expect([...emoji]).toHaveLength(NOTES_LINE_CHARS);
    expect(emoji.includes("�")).toBe(false);
    // At the limit it is left whole.
    expect(noteLines("y".repeat(NOTES_LINE_CHARS))[0]).toBe("y".repeat(NOTES_LINE_CHARS));
  });
});
