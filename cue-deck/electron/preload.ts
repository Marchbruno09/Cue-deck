import { contextBridge, ipcRenderer } from "electron";
import type {
  AppState,
  CueDeckAPI,
  NavigationDirection,
  NudgeDirection,
  PresentationSnapshot,
  SlideNote,
  ThumbnailReadyMessage,
} from "../src/types";
import {
  activatePresentationSlide,
  inspectPresentation,
} from "../src/lib/inspectPresentation";

const role = process.argv.find((argument) => argument.startsWith("--cue-role="))?.split("=")[1];

async function waitForThumbnailPaint(): Promise<void> {
  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
  const nextFrame = () => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

  const pendingImages = Array.from(document.images).filter((image) => !image.complete);
  const imagesReady = Promise.all(pendingImages.map((image) => new Promise<void>((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  })));
  const fontsReady = document.fonts?.ready ?? Promise.resolve();

  await Promise.race([Promise.all([fontsReady, imagesReady]), delay(1400)]);
  await nextFrame();
  await nextFrame();
  await delay(60);
}

if (role === "presentation") {
  let lastSnapshot = "";

  const reportState = () => {
    const snapshot = inspectPresentation(document);
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    ipcRenderer.send("presentation:state", snapshot);
  };

  const startObserver = () => {
    reportState();
    const observer = new MutationObserver(reportState);
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-hidden", "data-state"],
      childList: true,
    });
    window.addEventListener("hashchange", reportState);
    window.addEventListener("popstate", reportState);
    window.setInterval(reportState, 600);
  };

  ipcRenderer.on("presentation:probe", reportState);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
} else if (role === "thumbnail") {
  ipcRenderer.on("thumbnail:render", async (_event, requestId: number, index: number) => {
    const snapshot = activatePresentationSlide(document, index);
    window.scrollTo(0, 0);
    await waitForThumbnailPaint();
    const message: ThumbnailReadyMessage = { requestId, snapshot };
    ipcRenderer.send("thumbnail:ready", message);
  });
} else {
  const api: CueDeckAPI = {
    getState: () => ipcRenderer.invoke("state:get"),
    chooseDeck: () => ipcRenderer.invoke("deck:choose"),
    openDeck: (path: string) => ipcRenderer.invoke("deck:open", path),
    importNotes: () => ipcRenderer.invoke("notes:import"),
    exportNotes: () => ipcRenderer.invoke("notes:export"),
    updateNotes: (notes: SlideNote[]) => ipcRenderer.invoke("notes:update", notes),
    getSlideThumbnail: (index: number) => ipcRenderer.invoke("thumbnail:get", index),
    startPresentation: () => ipcRenderer.invoke("presentation:start"),
    stopPresentation: () => ipcRenderer.invoke("presentation:stop"),
    navigate: (direction: NavigationDirection) =>
      ipcRenderer.invoke("presentation:navigate", direction),
    nudge: (direction: NudgeDirection) => ipcRenderer.invoke("notes:nudge", direction),
    setFontSize: (size: number) => ipcRenderer.invoke("cue:set-font-size", size),
    toggleCueLock: () => ipcRenderer.invoke("cue:toggle-lock"),
    toggleCueVisibility: () => ipcRenderer.invoke("cue:toggle-visibility"),
    editCurrent: () => ipcRenderer.invoke("cue:edit-current"),
    onState: (callback: (state: AppState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
      ipcRenderer.on("state:changed", listener);
      return () => ipcRenderer.removeListener("state:changed", listener);
    },
  };

  contextBridge.exposeInMainWorld("cueDeck", api);
}
