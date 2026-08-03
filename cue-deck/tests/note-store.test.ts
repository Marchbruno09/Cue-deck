import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readNotesFile, writeNotesFile } from "../electron/note-store";

describe("note file persistence", () => {
  it("saves notes and restores them in a new read", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cue-deck-notes-"));
    const filePath = path.join(directory, "demo.cue.md");
    const notes = [
      { id: "slide-1", title: "开场", body: "先讲结论。" },
      { id: "slide-2", title: "下一步", body: "确认 owner。" },
    ];

    await writeNotesFile(filePath, notes);
    expect(await readNotesFile(filePath)).toEqual(notes);
  });

  it("treats a missing sidecar as an empty new script", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cue-deck-notes-"));
    expect(await readNotesFile(path.join(directory, "missing.cue.md"))).toEqual([]);
  });
});
