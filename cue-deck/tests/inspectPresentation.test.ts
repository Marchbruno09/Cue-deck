import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { inspectPresentation } from "../src/lib/inspectPresentation";

function documentFor(html: string): Document {
  return new JSDOM(html).window.document;
}

describe("presentation inspection", () => {
  it("detects Frontend Slides and active page changes", () => {
    const document = documentFor(`
      <section class="slide active"><span class="fragment visible">A</span></section>
      <section class="slide">B</section>
      <section class="slide">C</section>
    `);
    expect(inspectPresentation(document)).toEqual({
      index: 0,
      count: 3,
      adapter: "frontend-slides",
      recognized: true,
    });

    document.querySelectorAll(".slide")[0].classList.remove("active");
    document.querySelectorAll(".slide")[1].classList.add("active");
    expect(inspectPresentation(document).index).toBe(1);
  });

  it("does not treat a progressive fragment as a slide change", () => {
    const document = documentFor(`
      <section class="slide active"><span class="fragment">A</span></section>
      <section class="slide">B</section>
    `);
    document.querySelector(".fragment")?.classList.add("visible");
    expect(inspectPresentation(document).index).toBe(0);
  });

  it("flattens horizontal and vertical Reveal.js slides", () => {
    const document = documentFor(`
      <div class="reveal"><div class="slides">
        <section>One</section>
        <section class="present"><section>Two A</section><section class="present">Two B</section></section>
        <section>Three</section>
      </div></div>
    `);
    expect(inspectPresentation(document)).toEqual({
      index: 2,
      count: 4,
      adapter: "reveal",
      recognized: true,
    });
  });

  it("supports generic data-slide markup", () => {
    const document = documentFor(`
      <main data-slide>One</main><main data-slide class="current">Two</main>
    `);
    expect(inspectPresentation(document)).toMatchObject({
      index: 1,
      count: 2,
      adapter: "generic",
      recognized: true,
    });
  });

  it("falls back to manual mode for unknown pages", () => {
    expect(inspectPresentation(documentFor("<main>Regular page</main>"))).toEqual({
      index: 0,
      count: 0,
      adapter: "manual",
      recognized: false,
    });
  });
});
