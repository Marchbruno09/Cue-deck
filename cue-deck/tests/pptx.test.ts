import { describe, expect, it } from "vitest";
import { parsePowerPointEntries } from "../electron/pptx";

function xml(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

describe("PowerPoint Open XML parsing", () => {
  it("follows presentation order and imports only speaker-note body placeholders", () => {
    const entries = new Map<string, Buffer>([
      ["ppt/presentation.xml", xml(`
        <p:presentation xmlns:p="p" xmlns:r="r">
          <p:sldIdLst>
            <p:sldId id="256" r:id="rIdSecond"/>
            <p:sldId id="257" r:id="rIdFirst"/>
          </p:sldIdLst>
          <p:sldSz cx="12192000" cy="9144000"/>
        </p:presentation>
      `)],
      ["ppt/_rels/presentation.xml.rels", xml(`
        <Relationships>
          <Relationship Id="rIdFirst" Target="slides/slide1.xml"/>
          <Relationship Id="rIdSecond" Target="slides/slide2.xml"/>
        </Relationships>
      `)],
      ["ppt/slides/slide1.xml", xml(`
        <p:sld xmlns:p="p" xmlns:a="a">
          <p:cSld><p:spTree><p:sp>
            <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody>
          </p:sp></p:spTree></p:cSld>
        </p:sld>
      `)],
      ["ppt/slides/slide2.xml", xml(`
        <p:sld xmlns:p="p" xmlns:a="a">
          <p:cSld><p:spTree><p:sp>
            <p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:txBody>
          </p:sp></p:spTree></p:cSld>
        </p:sld>
      `)],
      ["ppt/slides/_rels/slide2.xml.rels", xml(`
        <Relationships>
          <Relationship Id="rIdNotes" Target="../notesSlides/notesSlide2.xml"/>
        </Relationships>
      `)],
      ["ppt/notesSlides/notesSlide2.xml", xml(`
        <p:notes xmlns:p="p" xmlns:a="a">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
              <p:txBody>
                <a:p><a:r><a:t>Opening point</a:t></a:r></a:p>
                <a:p><a:r><a:t>Follow-up point</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
            <p:sp>
              <p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr>
              <p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:notes>
      `)],
      ["docProps/thumbnail.jpeg", Buffer.from([1, 2, 3])],
    ]);

    const deck = parsePowerPointEntries(entries);

    expect(deck.slideCount).toBe(2);
    expect(deck.aspectRatio).toBeCloseTo(4 / 3);
    expect(deck.notes).toEqual([
      {
        id: "slide-1",
        title: "Second slide",
        body: "Opening point\nFollow-up point",
      },
      {
        id: "slide-2",
        title: "First slide",
        body: "",
      },
    ]);
    expect(deck.packageThumbnail).toEqual(Buffer.from([1, 2, 3]));
  });

  it("rejects packages without a presentation relationship graph", () => {
    expect(() => parsePowerPointEntries(new Map())).toThrow(
      "这个文件不是有效的 PowerPoint Open XML 演示",
    );
  });

  it("finds slide titles nested inside grouped shapes", () => {
    const entries = new Map<string, Buffer>([
      ["ppt/presentation.xml", xml(`
        <p:presentation xmlns:p="p" xmlns:r="r">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `)],
      ["ppt/_rels/presentation.xml.rels", xml(`
        <Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>
      `)],
      ["ppt/slides/slide1.xml", xml(`
        <p:sld xmlns:p="p" xmlns:a="a">
          <p:cSld><p:spTree><p:grpSp><p:grpSp><p:sp>
            <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Grouped title</a:t></a:r></a:p></p:txBody>
          </p:sp></p:grpSp></p:grpSp></p:spTree></p:cSld>
        </p:sld>
      `)],
    ]);

    expect(parsePowerPointEntries(entries).notes[0]?.title).toBe("Grouped title");
  });
});
