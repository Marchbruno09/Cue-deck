import { promises as fs } from "node:fs";
import { parseCueMarkdown, serializeCueMarkdown } from "../src/lib/notes";
import type { SlideNote } from "../src/types";

export async function readNotesFile(filePath: string): Promise<SlideNote[]> {
  try {
    return parseCueMarkdown(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeNotesFile(filePath: string, notes: SlideNote[]): Promise<void> {
  await fs.writeFile(filePath, serializeCueMarkdown(notes), "utf8");
}
