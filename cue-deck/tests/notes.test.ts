import { describe, expect, it } from "vitest";
import {
  clampIndex,
  ensureNoteCount,
  parseCueMarkdown,
  serializeCueMarkdown,
} from "../src/lib/notes";

describe("cue markdown", () => {
  it("parses headings, bodies, and slide separators", () => {
    const notes = parseCueMarkdown(`## 开场\n\n先讲结论。\n\n---\n\n## Why now\n\n- Point A\n- Point B`);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ title: "开场", body: "先讲结论。" });
    expect(notes[1]).toMatchObject({ title: "Why now", body: "- Point A\n- Point B" });
  });

  it("keeps blank sections so page alignment is not lost", () => {
    const notes = parseCueMarkdown("## One\n\nA\n\n---\n\n---\n\n## Three\n\nC");
    expect(notes).toHaveLength(3);
    expect(notes[1]).toMatchObject({ title: "第 2 页", body: "" });
  });

  it("round-trips serialized notes", () => {
    const input = [
      { id: "slide-1", title: "开场", body: "**重点**" },
      { id: "slide-2", title: "收尾", body: "下一步" },
    ];
    expect(parseCueMarkdown(serializeCueMarkdown(input))).toEqual(input);
  });

  it("pads missing notes without discarding extras", () => {
    const one = [{ id: "slide-1", title: "One", body: "A" }];
    expect(ensureNoteCount(one, 3)).toHaveLength(3);
    expect(ensureNoteCount(one, 0)).toEqual(one);
  });

  it("clamps restored progress to the available range", () => {
    expect(clampIndex(-4, 3)).toBe(0);
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });
});
