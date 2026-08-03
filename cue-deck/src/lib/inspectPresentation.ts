import type { PresentationSnapshot } from "../types";

function visibleSlideIndex(slides: Element[]): number {
  const priorityClasses = ["active", "present", "is-active", "current", "visible"];
  for (const className of priorityClasses) {
    const index = slides.findIndex((slide) => slide.classList.contains(className));
    if (index >= 0) return index;
  }

  const ariaIndex = slides.findIndex((slide) => slide.getAttribute("aria-hidden") === "false");
  return ariaIndex >= 0 ? ariaIndex : 0;
}

export function inspectPresentation(document: Document): PresentationSnapshot {
  const revealRoot = document.querySelector(".reveal .slides");
  if (revealRoot) {
    const flattened: Element[] = [];
    const roots = Array.from(revealRoot.querySelectorAll(":scope > section"));
    for (const root of roots) {
      const verticalSlides = Array.from(root.querySelectorAll(":scope > section"));
      flattened.push(...(verticalSlides.length > 0 ? verticalSlides : [root]));
    }

    return {
      index: visibleSlideIndex(flattened),
      count: flattened.length,
      adapter: "reveal",
      recognized: flattened.length > 0,
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
