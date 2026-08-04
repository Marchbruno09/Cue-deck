import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  shell,
  type IpcMainEvent,
  type OpenDialogOptions,
  type Rectangle,
  type SaveDialogOptions,
} from "electron";
import {
  clampIndex,
  ensureNoteCount,
  parseCueMarkdown,
  serializeCueMarkdown,
} from "../src/lib/notes";
import { readNotesFile, writeNotesFile } from "./note-store";
import type {
  AdapterKind,
  AppState,
  NavigationDirection,
  NudgeDirection,
  PresentationSnapshot,
  SlideNote,
  WindowBounds,
} from "../src/types";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.join(moduleDirectory, "../dist");
const preloadPath = path.join(moduleDirectory, "preload.js");
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;

interface Settings {
  lastDeckPath: string | null;
  cueLocked: boolean;
  fontSize: number;
  cueBounds: WindowBounds | null;
  setupBounds: WindowBounds | null;
  progressByDeck: Record<string, number>;
}

const defaultSettings: Settings = {
  lastDeckPath: null,
  cueLocked: false,
  fontSize: 22,
  cueBounds: null,
  setupBounds: null,
  progressByDeck: {},
};

let settings: Settings = { ...defaultSettings };
let setupWindow: BrowserWindow | null = null;
let presentationWindow: BrowserWindow | null = null;
let cueWindow: BrowserWindow | null = null;
let settingsSaveTimer: NodeJS.Timeout | null = null;
let noteSaveTimer: NodeJS.Timeout | null = null;
let isQuitting = false;

let state: AppState = {
  deckPath: null,
  deckName: null,
  notesPath: null,
  notes: [],
  slideCount: 0,
  currentIndex: 0,
  adapter: "manual",
  adapterRecognized: false,
  presenting: false,
  cueVisible: false,
  cueLocked: false,
  fontSize: 22,
  displayCount: 1,
  lastError: null,
  savedAt: null,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function publicState(): AppState {
  return {
    ...state,
    notes: state.notes.map((note) => ({ ...note })),
  };
}

function broadcastState(): AppState {
  const snapshot = publicState();
  for (const window of [setupWindow, cueWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send("state:changed", snapshot);
    }
  }
  return snapshot;
}

async function loadSettings(): Promise<void> {
  try {
    const contents = await fs.readFile(settingsPath(), "utf8");
    const loaded = JSON.parse(contents) as Partial<Settings>;
    settings = {
      ...defaultSettings,
      ...loaded,
      // A position lock is only useful during the current presentation.
      // Always migrate older persisted locks back to an unlocked window.
      cueLocked: false,
      progressByDeck: loaded.progressByDeck ?? {},
    };
  } catch {
    settings = { ...defaultSettings };
  }
  state.cueLocked = false;
  state.fontSize = settings.fontSize;
}

function scheduleSettingsSave(): void {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    settingsSaveTimer = null;
    try {
      await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
      await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
    } catch (error) {
      state.lastError = `无法保存窗口设置：${String(error)}`;
      broadcastState();
    }
  }, 180);
}

function rememberProgress(): void {
  if (!state.deckPath) return;
  settings.lastDeckPath = state.deckPath;
  settings.progressByDeck[state.deckPath] = state.currentIndex;
  scheduleSettingsSave();
}

function notesPathForDeck(deckPath: string): string {
  const extension = path.extname(deckPath);
  return path.join(
    path.dirname(deckPath),
    `${path.basename(deckPath, extension)}.cue.md`,
  );
}

async function writeNotes(): Promise<void> {
  if (!state.notesPath) return;
  try {
    await writeNotesFile(state.notesPath, state.notes);
    state.savedAt = new Date().toISOString();
    state.lastError = null;
    broadcastState();
  } catch (error) {
    state.lastError = `无法保存讲稿：${String(error)}`;
    broadcastState();
  }
}

function scheduleNoteSave(): void {
  if (noteSaveTimer) clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    noteSaveTimer = null;
    void writeNotes();
  }, 320);
}

async function loadRenderer(window: BrowserWindow, view: "setup" | "cue"): Promise<void> {
  if (developmentServerUrl) {
    const url = new URL(developmentServerUrl);
    url.searchParams.set("view", view);
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(path.join(rendererDirectory, "index.html"), {
    query: { view },
  });
}

function validBounds(bounds: WindowBounds | null, minimumWidth: number, minimumHeight: number): Rectangle | undefined {
  if (!bounds || bounds.width < minimumWidth || bounds.height < minimumHeight) return undefined;
  const intersectsDisplay = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
  return intersectsDisplay ? bounds : undefined;
}

function createSetupWindow(): BrowserWindow {
  const savedBounds = validBounds(settings.setupBounds, 860, 620);
  const window = new BrowserWindow({
    title: "CueDeck",
    width: savedBounds?.width ?? 1180,
    height: savedBounds?.height ?? 760,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#f5f7f8",
    show: false,
    webPreferences: {
      preload: preloadPath,
      additionalArguments: ["--cue-role=internal"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("move", () => {
    settings.setupBounds = window.getBounds();
    scheduleSettingsSave();
  });
  window.on("resize", () => {
    settings.setupBounds = window.getBounds();
    scheduleSettingsSave();
  });
  window.on("closed", () => {
    setupWindow = null;
  });
  void loadRenderer(window, "setup");
  return window;
}

function attachSafeNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

function createPresentationWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "CueDeck Presentation",
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    frame: false,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload: preloadPath,
      additionalArguments: ["--cue-role=presentation"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  attachSafeNavigation(window);
  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      stopPresentation();
    }
  });
  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown" || state.adapterRecognized) return;
    if (input.key === "ArrowRight" || input.key === " " || input.key === "PageDown") {
      moveManualIndex(1);
    } else if (input.key === "ArrowLeft" || input.key === "PageUp") {
      moveManualIndex(-1);
    }
  });
  return window;
}

function createCueWindow(): BrowserWindow {
  const savedBounds = validBounds(settings.cueBounds, 340, 220);
  const primary = screen.getPrimaryDisplay().workArea;
  const width = savedBounds?.width ?? (screen.getAllDisplays().length > 1 ? 560 : 430);
  const height = savedBounds?.height ?? (screen.getAllDisplays().length > 1 ? 640 : 380);
  const window = new BrowserWindow({
    title: "CueDeck Private Notes - DO NOT SHARE",
    width,
    height,
    x: savedBounds?.x ?? primary.x + primary.width - width - 28,
    y: savedBounds?.y ?? primary.y + 28,
    minWidth: 340,
    minHeight: 220,
    frame: false,
    transparent: false,
    roundedCorners: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: !state.cueLocked,
    movable: !state.cueLocked,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: preloadPath,
      additionalArguments: ["--cue-role=internal"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setContentProtection(true);
  window.on("move", () => {
    settings.cueBounds = window.getBounds();
    scheduleSettingsSave();
  });
  window.on("resize", () => {
    settings.cueBounds = window.getBounds();
    scheduleSettingsSave();
  });
  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
      state.cueVisible = false;
      broadcastState();
    }
  });
  void loadRenderer(window, "cue");
  return window;
}

function arrangePresentationWindows(): void {
  if (!presentationWindow || !cueWindow) return;
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const presentationDisplay = displays.find((display) => display.id !== primary.id) ?? primary;

  presentationWindow.setBounds(presentationDisplay.bounds, false);
  presentationWindow.setAlwaysOnTop(false);

  if (!settings.cueBounds || !validBounds(settings.cueBounds, 340, 220)) {
    const cueWidth = displays.length > 1 ? 560 : 430;
    const cueHeight = displays.length > 1 ? 640 : 380;
    cueWindow.setBounds({
      x: primary.workArea.x + primary.workArea.width - cueWidth - 28,
      y: primary.workArea.y + 28,
      width: cueWidth,
      height: cueHeight,
    });
  }
  cueWindow.setAlwaysOnTop(true, "floating");
}

async function openDeck(deckPath: string): Promise<AppState> {
  const extension = path.extname(deckPath).toLowerCase();
  if (![".html", ".htm"].includes(extension)) {
    throw new Error("请选择 HTML 演示文件。");
  }
  await fs.access(deckPath);

  const sidecarPath = notesPathForDeck(deckPath);
  const notes = await readNotesFile(sidecarPath);

  state = {
    ...state,
    deckPath,
    deckName: path.basename(deckPath),
    notesPath: sidecarPath,
    notes,
    slideCount: 0,
    currentIndex: settings.progressByDeck[deckPath] ?? 0,
    adapter: "manual",
    adapterRecognized: false,
    lastError: null,
  };
  settings.lastDeckPath = deckPath;
  scheduleSettingsSave();

  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.destroy();
  }
  presentationWindow = createPresentationWindow();
  presentationWindow.setTitle(`CueDeck Presentation - ${path.basename(deckPath)}`);

  try {
    await presentationWindow.loadFile(deckPath);
    presentationWindow.webContents.send("presentation:probe");
  } catch (error) {
    state.lastError = `无法打开演示：${String(error)}`;
  }
  return broadcastState();
}

function moveManualIndex(delta: NudgeDirection): void {
  const count = Math.max(state.slideCount, state.notes.length, 1);
  state.currentIndex = clampIndex(state.currentIndex + delta, count);
  rememberProgress();
  broadcastState();
}

function sendNavigation(direction: NavigationDirection): void {
  if (!presentationWindow || presentationWindow.isDestroyed()) return;
  const keyCode = direction === "next" ? "Right" : "Left";
  presentationWindow.webContents.sendInputEvent({ type: "keyDown", keyCode });
  presentationWindow.webContents.sendInputEvent({ type: "keyUp", keyCode });
  setTimeout(() => {
    presentationWindow?.webContents.send("presentation:probe");
  }, 140);
}

function stopPresentation(): void {
  state.presenting = false;
  state.cueVisible = false;
  presentationWindow?.hide();
  cueWindow?.hide();
  if (!setupWindow || setupWindow.isDestroyed()) {
    setupWindow = createSetupWindow();
  } else {
    setupWindow.show();
    setupWindow.focus();
  }
  broadcastState();
}

function toggleCueVisibility(): AppState {
  if (!cueWindow || cueWindow.isDestroyed()) return publicState();
  if (cueWindow.isVisible()) {
    cueWindow.hide();
    state.cueVisible = false;
  } else if (state.presenting) {
    cueWindow.showInactive();
    state.cueVisible = true;
  }
  return broadcastState();
}

function setCueWindowLocked(locked: boolean): void {
  state.cueLocked = locked;
  // Do not persist the lock across presentations or app restarts.
  settings.cueLocked = false;
  cueWindow?.setMovable(!locked);
  cueWindow?.setResizable(!locked);
  scheduleSettingsSave();
}

function registerIpcHandlers(): void {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("deck:choose", async () => {
    const options: OpenDialogOptions = {
      title: "选择 HTML 演示",
      properties: ["openFile"],
      filters: [{ name: "HTML 演示", extensions: ["html", "htm"] }],
    };
    const result = setupWindow
      ? await dialog.showOpenDialog(setupWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return publicState();
    return openDeck(result.filePaths[0]);
  });
  ipcMain.handle("deck:open", async (_event, deckPath: string) => openDeck(deckPath));
  ipcMain.handle("notes:import", async () => {
    if (!state.deckPath) return publicState();
    const options: OpenDialogOptions = {
      title: "导入 Markdown 讲稿",
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    };
    const result = setupWindow
      ? await dialog.showOpenDialog(setupWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return publicState();
    const imported = parseCueMarkdown(await fs.readFile(result.filePaths[0], "utf8"));
    state.notes = ensureNoteCount(imported, state.slideCount);
    await writeNotes();
    return broadcastState();
  });
  ipcMain.handle("notes:export", async () => {
    if (!state.deckPath) return publicState();
    const options: SaveDialogOptions = {
      title: "导出讲稿",
      defaultPath: state.notesPath ?? "presentation.cue.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };
    const result = setupWindow
      ? await dialog.showSaveDialog(setupWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return publicState();
    await fs.writeFile(result.filePath, serializeCueMarkdown(state.notes), "utf8");
    state.savedAt = new Date().toISOString();
    return broadcastState();
  });
  ipcMain.handle("notes:update", (_event, notes: SlideNote[]) => {
    state.notes = notes.map((note, index) => ({
      id: note.id || `slide-${index + 1}`,
      title: String(note.title ?? ""),
      body: String(note.body ?? ""),
    }));
    scheduleNoteSave();
    return broadcastState();
  });
  ipcMain.handle("presentation:start", () => {
    if (!state.deckPath || !presentationWindow) return publicState();
    setCueWindowLocked(false);
    if (!cueWindow || cueWindow.isDestroyed()) cueWindow = createCueWindow();
    arrangePresentationWindows();
    state.presenting = true;
    state.cueVisible = true;
    setupWindow?.hide();
    presentationWindow.show();
    presentationWindow.focus();
    cueWindow.showInactive();
    cueWindow.moveTop();
    return broadcastState();
  });
  ipcMain.handle("presentation:stop", () => {
    stopPresentation();
    return publicState();
  });
  ipcMain.handle("presentation:navigate", (_event, direction: NavigationDirection) => {
    sendNavigation(direction);
    return publicState();
  });
  ipcMain.handle("notes:nudge", (_event, direction: NudgeDirection) => {
    moveManualIndex(direction);
    return publicState();
  });
  ipcMain.handle("cue:set-font-size", (_event, requestedSize: number) => {
    state.fontSize = Math.min(38, Math.max(16, Math.round(requestedSize)));
    settings.fontSize = state.fontSize;
    scheduleSettingsSave();
    return broadcastState();
  });
  ipcMain.handle("cue:toggle-lock", () => {
    setCueWindowLocked(!state.cueLocked);
    return broadcastState();
  });
  ipcMain.handle("cue:toggle-visibility", () => toggleCueVisibility());
  ipcMain.handle("cue:edit-current", () => {
    stopPresentation();
    return publicState();
  });
  ipcMain.on("presentation:state", (event: IpcMainEvent, snapshot: PresentationSnapshot) => {
    if (!presentationWindow || event.sender.id !== presentationWindow.webContents.id) return;
    const count = Math.max(0, Number(snapshot.count) || 0);
    const recognized = Boolean(snapshot.recognized && count > 0);
    state.slideCount = count;
    state.adapter = (snapshot.adapter ?? "manual") as AdapterKind;
    state.adapterRecognized = recognized;
    if (recognized) {
      state.currentIndex = clampIndex(Number(snapshot.index) || 0, count);
      state.notes = ensureNoteCount(state.notes, count);
      scheduleNoteSave();
    } else {
      state.currentIndex = clampIndex(
        state.currentIndex,
        Math.max(state.notes.length, 1),
      );
    }
    rememberProgress();
    broadcastState();
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await loadSettings();
  state.displayCount = screen.getAllDisplays().length;
  registerIpcHandlers();
  setupWindow = createSetupWindow();

  globalShortcut.register("CommandOrControl+Shift+H", () => {
    toggleCueVisibility();
  });

  screen.on("display-added", () => {
    state.displayCount = screen.getAllDisplays().length;
    if (state.presenting) arrangePresentationWindows();
    broadcastState();
  });
  screen.on("display-removed", () => {
    state.displayCount = screen.getAllDisplays().length;
    if (state.presenting) arrangePresentationWindows();
    broadcastState();
  });

  if (settings.lastDeckPath) {
    try {
      await openDeck(settings.lastDeckPath);
    } catch {
      settings.lastDeckPath = null;
      scheduleSettingsSave();
    }
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
