import type { SlideNote } from "../types";

const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*$/;

export function createEmptyNote(index: number): SlideNote {
  return {
    id: `slide-${index + 1}`,
    title: `第 ${index + 1} 页`,
    body: "",
  };
}

export function parseCueMarkdown(markdown: string): SlideNote[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const sections = normalized
    .split(/^\s*---\s*$/m)
    .map((section) => section.trim());

  return sections.map((section, index) => {
    const lines = section.split("\n");
    const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
    const heading = firstContentIndex >= 0
      ? lines[firstContentIndex].match(HEADING_PATTERN)
      : null;

    if (heading && firstContentIndex >= 0) {
      lines.splice(firstContentIndex, 1);
    }

    return {
      id: `slide-${index + 1}`,
      title: heading?.[1].trim() || `第 ${index + 1} 页`,
      body: lines.join("\n").trim(),
    };
  });
}

export function serializeCueMarkdown(notes: SlideNote[]): string {
  return `${notes
    .map((note, index) => {
      const title = note.title.trim() || `第 ${index + 1} 页`;
      const body = note.body.trim();
      return `## ${title}${body ? `\n\n${body}` : ""}`;
    })
    .join("\n\n---\n\n")}\n`;
}

export function ensureNoteCount(notes: SlideNote[], count: number): SlideNote[] {
  const target = Math.max(0, count);
  if (notes.length >= target) return notes;

  return [
    ...notes,
    ...Array.from({ length: target - notes.length }, (_, offset) =>
      createEmptyNote(notes.length + offset),
    ),
  ];
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}
