import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import type { SlideNote } from "../src/types";

type XmlRecord = Record<string, unknown>;

export interface PowerPointDeck {
  notes: SlideNote[];
  slideCount: number;
  aspectRatio: number;
  packageThumbnail: Buffer | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

function asRecord(value: unknown): XmlRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as XmlRecord
    : null;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseXml(contents: Buffer, partName: string): XmlRecord {
  try {
    return parser.parse(contents.toString("utf8")) as XmlRecord;
  } catch (error) {
    throw new Error(`无法读取 PowerPoint 文件中的 ${partName}：${String(error)}`);
  }
}

function collectText(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectText);
  const record = asRecord(node);
  if (!record) return [];

  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === "a:t") {
      for (const text of asArray(value)) {
        if (typeof text === "string") values.push(text);
        else {
          const textRecord = asRecord(text);
          if (typeof textRecord?.["#text"] === "string") {
            values.push(textRecord["#text"] as string);
          }
        }
      }
    } else {
      values.push(...collectText(value));
    }
  }
  return values;
}

function shapeText(shape: XmlRecord): string {
  const textBody = asRecord(shape["p:txBody"]);
  if (!textBody) return "";
  const paragraphs = asArray(textBody["a:p"]);
  return paragraphs
    .map((paragraph) => collectText(paragraph).join(""))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shapesIn(xml: XmlRecord, rootName: string): XmlRecord[] {
  const root = asRecord(xml[rootName]);
  const commonSlide = asRecord(root?.["p:cSld"]);
  const shapeTree = asRecord(commonSlide?.["p:spTree"]);
  if (!shapeTree) return [];

  const shapes: XmlRecord[] = [];
  const visit = (container: XmlRecord) => {
    for (const candidate of asArray(container["p:sp"])) {
      const shape = asRecord(candidate);
      if (shape) shapes.push(shape);
    }
    for (const candidate of asArray(container["p:grpSp"])) {
      const group = asRecord(candidate);
      if (group) visit(group);
    }
  };
  visit(shapeTree);
  return shapes;
}

function placeholderType(shape: XmlRecord): string | null {
  const nonVisual = asRecord(shape["p:nvSpPr"]);
  const properties = asRecord(nonVisual?.["p:nvPr"]);
  const placeholder = asRecord(properties?.["p:ph"]);
  const type = placeholder?.["@_type"];
  return typeof type === "string" ? type : null;
}

function slideTitle(slideXml: XmlRecord, index: number): string {
  const shapes = shapesIn(slideXml, "p:sld");
  const title = shapes
    .filter((shape) => ["title", "ctrTitle"].includes(placeholderType(shape) ?? ""))
    .map(shapeText)
    .find(Boolean);
  if (title) return title.replace(/\s*\n\s*/g, " ");

  const firstText = shapes.map(shapeText).find(Boolean);
  return firstText?.replace(/\s*\n\s*/g, " ") ?? `第 ${index + 1} 页`;
}

function speakerNotes(notesXml: XmlRecord | undefined): string {
  if (!notesXml) return "";
  return shapesIn(notesXml, "p:notes")
    .filter((shape) => placeholderType(shape) === "body")
    .map(shapeText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function relationshipMap(xml: XmlRecord | undefined): Map<string, string> {
  const relationships = asRecord(xml?.Relationships);
  const result = new Map<string, string>();
  for (const candidate of asArray(relationships?.Relationship)) {
    const relationship = asRecord(candidate);
    const id = relationship?.["@_Id"];
    const target = relationship?.["@_Target"];
    const targetMode = relationship?.["@_TargetMode"];
    if (
      typeof id === "string" &&
      typeof target === "string" &&
      targetMode !== "External"
    ) {
      result.set(id, target);
    }
  }
  return result;
}

function resolvePart(sourcePart: string, target: string): string {
  return path.posix
    .normalize(path.posix.join(path.posix.dirname(sourcePart), target))
    .replace(/^\/+/, "");
}

export function parsePowerPointEntries(entries: Map<string, Buffer>): PowerPointDeck {
  const presentationPart = "ppt/presentation.xml";
  const presentationContents = entries.get(presentationPart);
  const relationshipsContents = entries.get("ppt/_rels/presentation.xml.rels");
  if (!presentationContents || !relationshipsContents) {
    throw new Error("这个文件不是有效的 PowerPoint Open XML 演示。");
  }

  const presentation = parseXml(presentationContents, presentationPart);
  const presentationRels = relationshipMap(
    parseXml(relationshipsContents, "ppt/_rels/presentation.xml.rels"),
  );
  const presentationRoot = asRecord(presentation["p:presentation"]);
  const slideIdList = asRecord(presentationRoot?.["p:sldIdLst"]);
  const slideIds = asArray(slideIdList?.["p:sldId"]);
  if (slideIds.length === 0) throw new Error("PowerPoint 文件中没有可用的幻灯片。");

  const slideSize = asRecord(presentationRoot?.["p:sldSz"]);
  const width = Number(slideSize?.["@_cx"]);
  const height = Number(slideSize?.["@_cy"]);
  const aspectRatio = width > 0 && height > 0 ? width / height : 16 / 9;

  const notes = slideIds.map((candidate, index): SlideNote => {
    const slideId = asRecord(candidate);
    const relationshipId = slideId?.["@_r:id"];
    const target = typeof relationshipId === "string"
      ? presentationRels.get(relationshipId)
      : undefined;
    if (!target) throw new Error(`无法定位 PowerPoint 第 ${index + 1} 页。`);

    const slidePart = resolvePart(presentationPart, target);
    const slideContents = entries.get(slidePart);
    if (!slideContents) throw new Error(`PowerPoint 第 ${index + 1} 页内容缺失。`);
    const slideXml = parseXml(slideContents, slidePart);

    const slideRelsPart = path.posix.join(
      path.posix.dirname(slidePart),
      "_rels",
      `${path.posix.basename(slidePart)}.rels`,
    );
    const slideRelsContents = entries.get(slideRelsPart);
    const slideRels = slideRelsContents
      ? relationshipMap(parseXml(slideRelsContents, slideRelsPart))
      : new Map<string, string>();
    const notesTarget = Array.from(slideRels.values()).find((value) =>
      value.includes("notesSlides/notesSlide"),
    );
    const notesPart = notesTarget ? resolvePart(slidePart, notesTarget) : null;
    const notesContents = notesPart ? entries.get(notesPart) : undefined;
    const notesXml = notesContents && notesPart
      ? parseXml(notesContents, notesPart)
      : undefined;

    return {
      id: `slide-${index + 1}`,
      title: slideTitle(slideXml, index),
      body: speakerNotes(notesXml),
    };
  });

  return {
    notes,
    slideCount: notes.length,
    aspectRatio,
    packageThumbnail:
      entries.get("docProps/thumbnail.jpeg") ??
      entries.get("docProps/thumbnail.jpg") ??
      entries.get("docProps/thumbnail.png") ??
      null,
  };
}

function shouldReadEntry(entry: Entry): boolean {
  const name = entry.fileName;
  return (
    name === "ppt/presentation.xml" ||
    name === "ppt/_rels/presentation.xml.rels" ||
    /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name) ||
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name) ||
    /^docProps\/thumbnail\.(?:jpe?g|png)$/i.test(name)
  );
}

export function readPowerPointEntries(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(new Error(`无法打开 PowerPoint 文件：${openError?.message ?? "未知错误"}`));
        return;
      }

      const entries = new Map<string, Buffer>();
      const fail = (error: Error) => {
        zipFile.close();
        reject(error);
      };
      zipFile.on("error", fail);
      zipFile.on("end", () => resolve(entries));
      zipFile.on("entry", (entry: Entry) => {
        if (/\/$/.test(entry.fileName) || !shouldReadEntry(entry)) {
          zipFile.readEntry();
          return;
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error(`无法读取 ${entry.fileName}`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", fail);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}

export async function readPowerPointDeck(filePath: string): Promise<PowerPointDeck> {
  return parsePowerPointEntries(await readPowerPointEntries(filePath));
}
