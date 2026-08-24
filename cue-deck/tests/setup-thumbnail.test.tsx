// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppState, CueDeckAPI, SlideThumbnail } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const state: AppState = {
  deckPath: "/presentations/demo.html",
  deckName: "demo.html",
  deckType: "html",
  notesPath: "/presentations/demo.cue.md",
  notes: Array.from({ length: 3 }, (_, index) => ({
    id: `slide-${index + 1}`,
    title: `第 ${index + 1} 页`,
    body: `讲稿 ${index + 1}`,
  })),
  notesSource: "local",
  slideCount: 3,
  currentIndex: 0,
  adapter: "frontend-slides",
  adapterRecognized: true,
  presenting: false,
  cueVisible: false,
  cueLocked: false,
  fontSize: 22,
  displayCount: 1,
  previewStatus: "ready",
  previewError: null,
  lastError: null,
  savedAt: null,
};

function createApi(
  getSlideThumbnail: (index: number) => Promise<SlideThumbnail>,
): CueDeckAPI {
  const resolved = async () => state;
  return {
    getState: resolved,
    chooseDeck: resolved,
    openDeck: resolved,
    importNotes: resolved,
    importPowerPointNotes: resolved,
    exportNotes: resolved,
    updateNotes: resolved,
    getSlideThumbnail,
    startPresentation: resolved,
    stopPresentation: resolved,
    navigate: resolved,
    nudge: resolved,
    setFontSize: resolved,
    toggleCueLock: resolved,
    toggleCueVisibility: resolved,
    editCurrent: resolved,
    onState: () => () => undefined,
  };
}

describe("setup slide thumbnail", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    window.history.replaceState({}, "", "/?view=setup");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
  });

  it("requests and displays the thumbnail for the selected note page", async () => {
    const getSlideThumbnail = vi.fn(async (index: number): Promise<SlideThumbnail> => ({
      index,
      status: "ready",
      dataUrl: `data:image/jpeg;base64,page-${index}`,
    }));
    window.cueDeck = createApi(getSlideThumbnail);

    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getSlideThumbnail).toHaveBeenCalledWith(0);
    expect(container.querySelector<HTMLImageElement>('img[alt="第 1 页 HTML 缩略图"]')?.src)
      .toContain("page-0");

    const rows = container.querySelectorAll<HTMLButtonElement>(".slide-row");
    await act(async () => {
      rows[2].click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSlideThumbnail).toHaveBeenLastCalledWith(2);
    expect(container.querySelector<HTMLImageElement>('img[alt="第 3 页 HTML 缩略图"]')?.src)
      .toContain("page-2");
  });

  it("shows a clear unavailable state instead of a mismatched image", async () => {
    window.cueDeck = createApi(async (index) => ({
      index,
      status: "unavailable",
      message: "此 HTML 无法自动定位页面",
    }));

    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".slide-thumbnail img")).toBeNull();
    expect(container.querySelector(".slide-thumbnail")?.textContent)
      .toContain("此 HTML 无法自动定位页面");
  });
});
