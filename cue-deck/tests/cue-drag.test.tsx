// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppState, CueDeckAPI } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const baseState: AppState = {
  deckPath: "/presentations/demo.html",
  deckName: "demo.html",
  notesPath: "/presentations/demo.cue.md",
  notes: [{ id: "slide-1", title: "开场", body: "讲稿" }],
  slideCount: 1,
  currentIndex: 0,
  adapter: "frontend-slides",
  adapterRecognized: true,
  presenting: true,
  cueVisible: true,
  cueLocked: false,
  fontSize: 22,
  displayCount: 1,
  lastError: null,
  savedAt: null,
};

describe("private cue window drag state", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let state: AppState;
  let toggleCueLock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/?view=cue");
    state = { ...baseState };
    const resolved = async () => state;
    toggleCueLock = vi.fn(resolved);
    const api: CueDeckAPI = {
      getState: resolved,
      chooseDeck: resolved,
      openDeck: resolved,
      importNotes: resolved,
      exportNotes: resolved,
      updateNotes: resolved,
      startPresentation: resolved,
      stopPresentation: resolved,
      navigate: resolved,
      nudge: resolved,
      setFontSize: resolved,
      toggleCueLock,
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

  const renderCue = async () => {
    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
    });
  };

  it("shows an explicit drag handle while the window is movable", async () => {
    await renderCue();

    expect(container.querySelector('[aria-label="拖动悬浮卡片"]')).not.toBeNull();
    const lockButton = container.querySelector<HTMLButtonElement>('[aria-label="锁定位置"]');
    expect(lockButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => lockButton?.click());
    expect(toggleCueLock).toHaveBeenCalledOnce();
  });

  it("makes a locked state visually explicit and offers one-click unlock", async () => {
    state = { ...baseState, cueLocked: true };
    await renderCue();

    expect(container.querySelector('[aria-label="位置已锁定"]')).not.toBeNull();
    const unlockButton = container.querySelector<HTMLButtonElement>('[aria-label="解锁位置"]');
    expect(unlockButton?.getAttribute("aria-pressed")).toBe("true");
    expect(unlockButton?.classList.contains("active")).toBe(true);
  });
});
