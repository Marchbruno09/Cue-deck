import type { PresentationSnapshot } from "../types";

const priorityClasses = ["active", "present", "is-active", "current", "visible"];
const revealStateClasses = ["past", "present", "future"];

function visibleSlideIndex(slides: Element[]): number {
  for (const className of priorityClasses) {
    const index = slides.findIndex((slide) => slide.classList.contains(className));
    if (index >= 0) return index;
  }

  const ariaIndex = slides.findIndex((slide) => slide.getAttribute("aria-hidden") === "false");
  return ariaIndex >= 0 ? ariaIndex : 0;
}

function revealSlides(document: Document): Element[] {
  const revealRoot = document.querySelector(".reveal .slides");
  if (!revealRoot) return [];

  const flattened: Element[] = [];
  const roots = Array.from(revealRoot.querySelectorAll(":scope > section"));
  for (const root of roots) {
    const verticalSlides = Array.from(root.querySelectorAll(":scope > section"));
    flattened.push(...(verticalSlides.length > 0 ? verticalSlides : [root]));
  }
  return flattened;
}

export function inspectPresentation(document: Document): PresentationSnapshot {
  const revealRoot = document.querySelector(".reveal .slides");
  if (revealRoot) {
    const flattened = revealSlides(document);

    return {
      index: visibleSlideIndex(flattened),
      count: flattened.length,
      adapter: "reveal",
      recognized: flattened.length > 0,
    };
  }

  const pdfSlides = Array.from(document.querySelectorAll("[data-cue-pdf-slide]"));
  if (pdfSlides.length > 0) {
    return {
      index: visibleSlideIndex(pdfSlides),
      count: pdfSlides.length,
      adapter: "pdf",
      recognized: true,
    };
  }

  const frontendSlides = Array.from(document.querySelectorAll(".slide"));
  if (frontendSlides.length > 0) {
    return {
      index: visibleSlideIndex(frontendSlides),
      count: frontendSlides.length,
      adapter: "frontend-slides",
      recognized: true,
    };
  }

  const genericSlides = Array.from(
    document.querySelectorAll("[data-slide], [data-slide-index]"),
  );
  if (genericSlides.length > 0) {
    return {
      index: visibleSlideIndex(genericSlides),
      count: genericSlides.length,
      adapter: "generic",
      recognized: true,
    };
  }

  return {
    index: 0,
    count: 0,
    adapter: "manual",
    recognized: false,
  };
}

function setFlatSlideState(
  slides: Element[],
  targetIndex: number,
  fallbackClass: "active" | "current",
): void {
  const activeClass = priorityClasses.find((className) =>
    slides.some((slide) => slide.classList.contains(className)),
  ) ?? fallbackClass;

  slides.forEach((slide, index) => {
    for (const className of priorityClasses) slide.classList.remove(className);
    if (index === targetIndex) slide.classList.add(activeClass);
    slide.setAttribute("aria-hidden", index === targetIndex ? "false" : "true");
  });
}

function setRevealSlideState(document: Document, targetIndex: number): void {
  const revealRoot = document.querySelector(".reveal .slides");
  if (!revealRoot) return;

  const roots = Array.from(revealRoot.querySelectorAll(":scope > section"));
  let flatIndex = 0;
  let targetHorizontal = 0;
  let targetVertical: number | null = null;

  roots.forEach((root, horizontalIndex) => {
    const verticalSlides = Array.from(root.querySelectorAll(":scope > section"));
    const slideCount = Math.max(verticalSlides.length, 1);
    if (targetIndex >= flatIndex && targetIndex < flatIndex + slideCount) {
      targetHorizontal = horizontalIndex;
      targetVertical = verticalSlides.length > 0 ? targetIndex - flatIndex : null;
    }
    flatIndex += slideCount;
  });

  roots.forEach((root, horizontalIndex) => {
    for (const className of revealStateClasses) root.classList.remove(className);
    const horizontalState = horizontalIndex < targetHorizontal
      ? "past"
      : horizontalIndex > targetHorizontal
        ? "future"
        : "present";
    root.classList.add(horizontalState);
    root.setAttribute("aria-hidden", horizontalIndex === targetHorizontal ? "false" : "true");

    const verticalSlides = Array.from(root.querySelectorAll(":scope > section"));
    verticalSlides.forEach((slide, verticalIndex) => {
      for (const className of revealStateClasses) slide.classList.remove(className);
      const verticalState = horizontalIndex < targetHorizontal
        ? "past"
        : horizontalIndex > targetHorizontal
          ? "future"
          : verticalIndex < (targetVertical ?? 0)
            ? "past"
            : verticalIndex > (targetVertical ?? 0)
              ? "future"
              : "present";
      slide.classList.add(verticalState);
      slide.setAttribute(
        "aria-hidden",
        horizontalIndex === targetHorizontal && verticalIndex === targetVertical
          ? "false"
          : "true",
      );
    });
  });
}

export function activatePresentationSlide(
  document: Document,
  requestedIndex: number,
): PresentationSnapshot {
  const before = inspectPresentation(document);
  if (!before.recognized || before.count <= 0) return before;

  const targetIndex = Math.min(
    Math.max(Math.round(Number(requestedIndex) || 0), 0),
    before.count - 1,
  );

  if (before.adapter === "reveal") {
    setRevealSlideState(document, targetIndex);
  } else if (before.adapter === "pdf") {
    setFlatSlideState(Array.from(document.querySelectorAll("[data-cue-pdf-slide]")), targetIndex, "active");
  } else if (before.adapter === "frontend-slides") {
    setFlatSlideState(Array.from(document.querySelectorAll(".slide")), targetIndex, "active");
  } else if (before.adapter === "generic") {
    setFlatSlideState(
      Array.from(document.querySelectorAll("[data-slide], [data-slide-index]")),
      targetIndex,
      "current",
    );
  }

  return inspectPresentation(document);
}
