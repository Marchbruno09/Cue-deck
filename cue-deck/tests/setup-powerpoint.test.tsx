// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppState, CueDeckAPI } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const state: AppState = {
  deckPath: "/presentations/quarterly-review.pptx",
  deckName: "quarterly-review.pptx",
  deckType: "powerpoint",
  notesPath: "/presentations/quarterly-review.cue.md",
  notes: [{ id: "slide-1", title: "Opening", body: "Speaker note" }],
  notesSource: "powerpoint",
  slideCount: 1,
  currentIndex: 0,
  adapter: "powerpoint",
  adapterRecognized: true,
  presenting: false,
  cueVisible: false,
  cueLocked: false,
  fontSize: 22,
  displayCount: 1,
  previewStatus: "loading",
  previewError: null,
  lastError: null,
  savedAt: null,
};

describe("PowerPoint setup workspace", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let importPowerPointNotes: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/?view=setup");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    importPowerPointNotes = vi.fn(async () => state);
    const resolved = async () => state;
    const api: CueDeckAPI = {
      getState: resolved,
      chooseDeck: resolved,
      openDeck: resolved,
      importNotes: resolved,
      importPowerPointNotes,
      exportNotes: resolved,
      updateNotes: resolved,
      getSlideThumbnail: async (index) => ({
        index,
        status: "loading",
        message: "正在通过 PowerPoint 生成缩略图",
      }),
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
    window.cueDeck = api;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
  });

  it("shows PPT notes, sharing guidance and preview progress", async () => {
    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已读取 PPT speaker notes");
    expect(container.textContent).toContain("PowerPoint Slide Show - quarterly-review.pptx");
    expect(container.textContent).toContain("正在通过 PowerPoint 生成缩略图");

    const refreshButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("读取 PPT 备注"));
    expect(refreshButton).toBeDefined();
    await act(async () => refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(importPowerPointNotes).toHaveBeenCalledOnce();
  });
});
