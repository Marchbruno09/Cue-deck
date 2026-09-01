import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  activatePresentationSlide,
  inspectPresentation,
} from "../src/lib/inspectPresentation";

function documentFor(html: string): Document {
  return new JSDOM(html, {
    url: "http://127.0.0.1:4174/prototypes/demo.html?scene=7",
  }).window.document;
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

  it("recognizes the Bel ontology scene route and its eight navigable scenes", () => {
    const document = documentFor(`
      <body data-page="bel-ontology-playground">
        <div class="bel-agent-root" data-scene="7"></div>
      </body>
    `);
    expect(inspectPresentation(document)).toEqual({
      index: 6,
      count: 8,
      adapter: "bel",
      recognized: true,
    });

    activatePresentationSlide(document, 7);
    expect(new URL(document.defaultView!.location.href).searchParams.get("scene")).toBe("9");
  });

  it("detects and activates generated PDF pages", () => {
    const document = documentFor(`
      <section data-cue-pdf-slide class="active">One</section>
      <section data-cue-pdf-slide>Two</section>
    `);
    expect(inspectPresentation(document)).toEqual({
      index: 0,
      count: 2,
      adapter: "pdf",
      recognized: true,
    });
    expect(activatePresentationSlide(document, 1).index).toBe(1);
    expect(document.querySelectorAll("[data-cue-pdf-slide]")[1].classList.contains("active")).toBe(true);
  });

  it("falls back to manual mode for unknown pages", () => {
    expect(inspectPresentation(documentFor("<main>Regular page</main>"))).toEqual({
      index: 0,
      count: 0,
      adapter: "manual",
      recognized: false,
    });
  });

  it("activates a requested Frontend Slides page for thumbnail rendering", () => {
    const document = documentFor(`
      <section class="slide active">One</section>
      <section class="slide">Two</section>
      <section class="slide">Three</section>
    `);

    expect(activatePresentationSlide(document, 2).index).toBe(2);
    const slides = document.querySelectorAll(".slide");
    expect(slides[0].classList.contains("active")).toBe(false);
    expect(slides[2].classList.contains("active")).toBe(true);
    expect(slides[2].getAttribute("aria-hidden")).toBe("false");
  });

  it("activates a nested Reveal.js page using its flattened index", () => {
    const document = documentFor(`
      <div class="reveal"><div class="slides">
        <section class="present">One</section>
        <section class="stack future"><section>Two A</section><section>Two B</section></section>
        <section class="future">Three</section>
      </div></div>
    `);

    expect(activatePresentationSlide(document, 2)).toMatchObject({
      index: 2,
      count: 4,
      adapter: "reveal",
      recognized: true,
    });
    const roots = document.querySelectorAll(".reveal .slides > section");
    const vertical = roots[1].querySelectorAll(":scope > section");
    expect(roots[1].classList.contains("present")).toBe(true);
    expect(vertical[0].classList.contains("past")).toBe(true);
    expect(vertical[1].classList.contains("present")).toBe(true);
  });

  it("activates generic pages and leaves unknown HTML unchanged", () => {
    const generic = documentFor(`
      <main data-slide class="current">One</main><main data-slide>Two</main>
    `);
    expect(activatePresentationSlide(generic, 1).index).toBe(1);
    expect(generic.querySelectorAll("[data-slide]")[1].classList.contains("current")).toBe(true);

    const unknown = documentFor("<main>Regular page</main>");
    expect(activatePresentationSlide(unknown, 4)).toEqual({
      index: 0,
      count: 0,
      adapter: "manual",
      recognized: false,
    });
  });
});
