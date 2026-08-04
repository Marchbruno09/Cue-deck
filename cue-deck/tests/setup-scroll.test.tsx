// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createEmptyNote } from "../src/lib/notes";
import type { AppState, CueDeckAPI } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const state: AppState = {
  deckPath: "/presentations/demo.html",
  deckName: "demo.html",
  notesPath: "/presentations/demo.cue.md",
  notes: Array.from({ length: 21 }, (_, index) => ({
    ...createEmptyNote(index),
    title: `第 ${index + 1} 页`,
  })),
  slideCount: 21,
  currentIndex: 0,
  adapter: "frontend-slides",
  adapterRecognized: true,
  presenting: false,
  cueVisible: false,
  cueLocked: false,
  fontSize: 22,
  displayCount: 1,
  lastError: null,
  savedAt: null,
};

describe("setup slide rail", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/?view=setup");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const updateNotes = vi.fn(async (notes) => ({ ...state, notes }));
    const resolved = async () => state;
    const api: CueDeckAPI = {
      getState: resolved,
      chooseDeck: resolved,
      openDeck: resolved,
      importNotes: resolved,
      exportNotes: resolved,
      updateNotes,
      getSlideThumbnail: async (index) => ({ index, status: "unavailable" }),
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

    const style = document.createElement("style");
    style.textContent = readFileSync(path.resolve(process.cwd(), "src/styles.css"), "utf8");
    document.head.append(style);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    document.head.replaceChildren();
    container.remove();
    scrollIntoView.mockClear();
    vi.useRealTimers();
  });

  it("keeps 21 pages selectable and scrolls the active row into view", async () => {
    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
    });

    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>(".slide-row"));
    expect(rows).toHaveLength(21);

    await act(async () => rows[20].click());

    expect(container.querySelector(".slide-row.selected")?.textContent).toContain("21");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    const editor = container.querySelector<HTMLTextAreaElement>(".script-editor");
    expect(editor).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(editor, "第 21 页讲稿可正常输入");
      editor?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor?.value).toBe("第 21 页讲稿可正常输入");

    const railStyle = getComputedStyle(container.querySelector(".slide-rail")!);
    const listStyle = getComputedStyle(container.querySelector(".slide-list")!);
    expect(railStyle.minHeight).toMatch(/^0(?:px)?$/);
    expect(railStyle.overflow).toBe("hidden");
    expect(listStyle.overflowY).toBe("auto");
  });
});
