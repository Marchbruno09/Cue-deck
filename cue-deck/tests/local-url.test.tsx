// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppState, CueDeckAPI } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const state: AppState = {
  deckPath: null,
  deckName: null,
  deckType: null,
  notesPath: null,
  notes: [],
  notesSource: null,
  slideCount: 0,
  currentIndex: 0,
  adapter: "manual",
  adapterRecognized: false,
  presenting: false,
  cueVisible: false,
  cueLocked: false,
  fontSize: 22,
  displayCount: 1,
  previewStatus: "idle",
  previewError: null,
  lastError: null,
  savedAt: null,
};

describe("local URL setup", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let openUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/?view=setup");
    openUrl = vi.fn(async () => state);
    const resolved = async () => state;
    const api: CueDeckAPI = {
      getState: resolved,
      chooseDeck: resolved,
      openDeck: resolved,
      openUrl,
      importNotes: resolved,
      importPowerPointNotes: resolved,
      exportNotes: resolved,
      updateNotes: resolved,
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
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
  });

  it("opens the local URL dialog and submits its URL to the main process", async () => {
    await act(async () => {
      root?.render(<App />);
      await Promise.resolve();
    });

    const connectButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("连接本地网页"));
    expect(connectButton).toBeDefined();

    await act(async () => connectButton?.click());
    const form = container.querySelector<HTMLFormElement>(".url-dialog");
    expect(form).not.toBeNull();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:4174/");
  });
});
