import { contextBridge, ipcRenderer } from "electron";
import type {
  AppState,
  CueDeckAPI,
  NavigationDirection,
  NudgeDirection,
  PresentationSnapshot,
  SlideNote,
} from "../src/types";
import { inspectPresentation } from "../src/lib/inspectPresentation";

const role = process.argv.find((argument) => argument.startsWith("--cue-role="))?.split("=")[1];

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
} else {
  const api: CueDeckAPI = {
    getState: () => ipcRenderer.invoke("state:get"),
    chooseDeck: () => ipcRenderer.invoke("deck:choose"),
    openDeck: (path: string) => ipcRenderer.invoke("deck:open", path),
    importNotes: () => ipcRenderer.invoke("notes:import"),
    exportNotes: () => ipcRenderer.invoke("notes:export"),
    updateNotes: (notes: SlideNote[]) => ipcRenderer.invoke("notes:update", notes),
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
