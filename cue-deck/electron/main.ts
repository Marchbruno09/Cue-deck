import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
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
import { readPowerPointDeck, type PowerPointDeck } from "./pptx";
import {
  cancelPowerPointPreview,
  navigatePowerPoint,
  powerPointSlideNumber,
  renderPowerPointSlides,
  startPowerPointPresentation,
  stopPowerPointPresentation,
} from "./powerpoint";
import type {
  AdapterKind,
  AppState,
  NavigationDirection,
  NudgeDirection,
  PresentationSnapshot,
  SlideThumbnail,
  SlideNote,
  ThumbnailReadyMessage,
  WindowBounds,
} from "../src/types";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.join(moduleDirectory, "../dist");
const preloadPath = path.join(moduleDirectory, "preload.js");
const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
const powerPointExtensions = new Set([".pptx", ".pptm", ".ppsx", ".ppsm"]);
const pdfExtensions = new Set([".pdf"]);

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
let thumbnailWindow: BrowserWindow | null = null;
let thumbnailDeckPath: string | null = null;
let thumbnailRequestId = 0;
let thumbnailQueue: Promise<void> = Promise.resolve();
const thumbnailCache = new Map<number, SlideThumbnail>();
let powerPointPreviewDirectory: string | null = null;
let powerPointPackageThumbnail: Buffer | null = null;
let powerPointPreviewGeneration = 0;
let pdfPreviewDirectory: string | null = null;
let pdfPresentationPath: string | null = null;
let powerPointPollTimer: NodeJS.Timeout | null = null;
let powerPointPollBusy = false;
let powerPointClosedPolls = 0;
let settingsSaveTimer: NodeJS.Timeout | null = null;
let noteSaveTimer: NodeJS.Timeout | null = null;
let isQuitting = false;

let state: AppState = {
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function previewDirectoryForPowerPoint(deckPath: string): Promise<string> {
  const stats = await fs.stat(deckPath);
  const cacheKey = createHash("sha256")
    .update(deckPath)
    .update(String(stats.size))
    .update(String(stats.mtimeMs))
    .digest("hex")
    .slice(0, 20);
  return path.join(app.getPath("userData"), "powerpoint-previews", cacheKey);
}

function powerPointPreviewPath(index: number): string | null {
  return powerPointPreviewDirectory
    ? path.join(powerPointPreviewDirectory, `slide-${index + 1}.png`)
    : null;
}

async function hasCompletePowerPointPreview(slideCount: number): Promise<boolean> {
  if (!powerPointPreviewDirectory) return false;
  const checks = await Promise.all(
    Array.from({ length: slideCount }, (_, index) =>
      pathExists(path.join(powerPointPreviewDirectory!, `slide-${index + 1}.png`)),
    ),
  );
  return checks.every(Boolean);
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

function createThumbnailWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "CueDeck Thumbnail Renderer",
    width: 960,
    height: 540,
    useContentSize: true,
    frame: false,
    show: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: preloadPath,
      additionalArguments: ["--cue-role=thumbnail"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  attachSafeNavigation(window);
  window.webContents.setAudioMuted(true);
  window.on("closed", () => {
    if (thumbnailWindow === window) {
      thumbnailWindow = null;
      thumbnailDeckPath = null;
    }
  });
  return window;
}

function resetThumbnailRenderer(resetQueue = true): void {
  thumbnailCache.clear();
  thumbnailDeckPath = null;
  if (resetQueue) thumbnailQueue = Promise.resolve();
  if (thumbnailWindow && !thumbnailWindow.isDestroyed()) thumbnailWindow.destroy();
  thumbnailWindow = null;
}

function resetPowerPointPreview(): void {
  cancelPowerPointPreview();
  powerPointPreviewGeneration += 1;
  powerPointPreviewDirectory = null;
  powerPointPackageThumbnail = null;
}

function resetPdfPreview(): void {
  pdfPreviewDirectory = null;
  pdfPresentationPath = null;
}

async function resolvePdfRenderer(): Promise<string> {
  const candidates = [
    process.env.CUEDECK_PDF_RENDERER,
    path.join(process.resourcesPath, "bin", "cue-deck-pdf-renderer"),
    path.join(moduleDirectory, "../build/cue-deck-pdf-renderer"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return "cue-deck-pdf-renderer";
}

function runPdfRenderer(
  rendererPath: string,
  deckPath: string,
  outputDirectory: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      rendererPath,
      [deckPath, outputDirectory, "1.5"],
      { timeout: 180_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim()));
          return;
        }
        resolve();
      },
    );
  });
}

async function pdfPageCount(outputDirectory: string): Promise<number> {
  const count = Number.parseInt(
    await fs.readFile(path.join(outputDirectory, "page-count.txt"), "utf8"),
    10,
  );
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("PDF 没有可显示的页面");
  }
  return count;
}

async function hasCompletePdfPreview(
  outputDirectory: string,
  slideCount: number,
): Promise<boolean> {
  try {
    if (await pdfPageCount(outputDirectory) !== slideCount) return false;
  } catch {
    return false;
  }
  const checks = await Promise.all(
    Array.from({ length: slideCount }, (_, index) =>
      pathExists(path.join(outputDirectory, `slide-${index + 1}.png`)),
    ),
  );
  return checks.every(Boolean);
}

function pdfPreviewPath(index: number): string | null {
  return pdfPreviewDirectory
    ? path.join(pdfPreviewDirectory, `slide-${index + 1}.png`)
    : null;
}

async function createPdfPresentationHtml(
  outputDirectory: string,
  slideCount: number,
): Promise<string> {
  const slides = Array.from({ length: slideCount }, (_, index) => ({
    index,
    url: pathToFileURL(path.join(outputDirectory, `slide-${index + 1}.png`)).href,
  }));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CueDeck PDF Presentation</title>
<style>
  :root, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; }
  body { display: grid; place-items: center; }
  .slide { display: none; width: 100vw; height: 100vh; place-items: center; }
  .slide.active { display: grid; }
  img { display: block; max-width: 100vw; max-height: 100vh; width: auto; height: auto; object-fit: contain; user-select: none; }
</style>
</head>
<body>
${slides.map(({ index, url }) => `<section class="slide${index === 0 ? " active" : ""}" data-cue-pdf-slide data-slide-index="${index}" aria-hidden="${index === 0 ? "false" : "true"}"><img src="${url}" alt=""></section>`).join("\n")}
<script>
(() => {
  const slides = Array.from(document.querySelectorAll('.slide'));
  let current = 0;
  const show = (next) => {
    current = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((slide, index) => {
      const active = index === current;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  };
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
      event.preventDefault(); show(current + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault(); show(current - 1);
    }
  });
  document.body.addEventListener('click', () => show(current + 1));
})();
</script>
</body>
</html>`;
  const presentationPath = path.join(outputDirectory, "presentation.html");
  await fs.writeFile(presentationPath, html, "utf8");
  return presentationPath;
}

async function preparePdfPreview(
  deckPath: string,
  outputDirectory: string,
): Promise<number> {
  await fs.mkdir(outputDirectory, { recursive: true });
  let cachedSlideCount = 0;
  try {
    cachedSlideCount = await pdfPageCount(outputDirectory);
  } catch {
    // Render below when this PDF has not been cached yet.
  }
  if (!cachedSlideCount || !(await hasCompletePdfPreview(outputDirectory, cachedSlideCount))) {
    const rendererPath = await resolvePdfRenderer();
    await runPdfRenderer(rendererPath, deckPath, outputDirectory);
  }
  const slideCount = await pdfPageCount(outputDirectory);
  pdfPresentationPath = await createPdfPresentationHtml(outputDirectory, slideCount);
  return slideCount;
}

async function preparePowerPointPreview(
  deckPath: string,
  slideCount: number,
  generation: number,
): Promise<void> {
  if (!powerPointPreviewDirectory) return;
  const outputDirectory = powerPointPreviewDirectory;
  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    if (!(await hasCompletePowerPointPreview(slideCount))) {
      await renderPowerPointSlides(deckPath, outputDirectory);
    }
    if (
      generation !== powerPointPreviewGeneration ||
      state.deckPath !== deckPath ||
      !(await hasCompletePowerPointPreview(slideCount))
    ) return;

    thumbnailCache.clear();
    state.previewStatus = "ready";
    state.previewError = null;
    broadcastState();
  } catch (error) {
    if (generation !== powerPointPreviewGeneration || state.deckPath !== deckPath) return;
    state.previewStatus = "error";
    state.previewError = error instanceof Error ? error.message : String(error);
    broadcastState();
  }
}

async function ensureThumbnailWindow(deckPath: string): Promise<BrowserWindow> {
  if (
    thumbnailWindow &&
    !thumbnailWindow.isDestroyed() &&
    thumbnailDeckPath === deckPath
  ) {
    return thumbnailWindow;
  }

  resetThumbnailRenderer(false);
  const window = createThumbnailWindow();
  thumbnailWindow = window;
  thumbnailDeckPath = deckPath;
  try {
    await window.loadFile(deckPath);
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

function prepareThumbnailSlide(
  window: BrowserWindow,
  index: number,
): Promise<PresentationSnapshot> {
  const requestId = ++thumbnailRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("thumbnail render timed out"));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      ipcMain.removeListener("thumbnail:ready", onReady);
      window.webContents.removeListener("destroyed", onDestroyed);
    };
    const onDestroyed = () => {
      cleanup();
      reject(new Error("thumbnail renderer closed"));
    };
    const onReady = (event: IpcMainEvent, message: ThumbnailReadyMessage) => {
      if (
        event.sender.id !== window.webContents.id ||
        message?.requestId !== requestId
      ) return;
      cleanup();
      resolve(message.snapshot);
    };

    ipcMain.on("thumbnail:ready", onReady);
    window.webContents.once("destroyed", onDestroyed);
    window.webContents.send("thumbnail:render", requestId, index);
  });
}

async function generateSlideThumbnail(
  deckPath: string,
  index: number,
): Promise<SlideThumbnail> {
  if (state.deckPath !== deckPath) {
    return { index, status: "unavailable", message: "演示已更换" };
  }

  const cached = thumbnailCache.get(index);
  if (cached) return cached;

  try {
    const window = await ensureThumbnailWindow(deckPath);
    const snapshot = await prepareThumbnailSlide(window, index);
    if (!snapshot.recognized || snapshot.index !== index) {
      return { index, status: "unavailable", message: "无法定位这一页" };
    }
    if (state.deckPath !== deckPath || thumbnailWindow !== window) {
      return { index, status: "unavailable", message: "演示已更换" };
    }

    const capture = await window.webContents.capturePage();
    const thumbnail = capture.resize({ width: 384, quality: "good" });
    const result: SlideThumbnail = {
      index,
      status: "ready",
      dataUrl: `data:image/jpeg;base64,${thumbnail.toJPEG(82).toString("base64")}`,
    };
    thumbnailCache.set(index, result);
    return result;
  } catch {
    return { index, status: "error", message: "缩略图生成失败" };
  }
}

function thumbnailFromBuffer(index: number, buffer: Buffer): SlideThumbnail | null {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) return null;
  const resized = image.resize({ width: 384, quality: "good" });
  return {
    index,
    status: "ready",
    dataUrl: `data:image/jpeg;base64,${resized.toJPEG(82).toString("base64")}`,
  };
}

async function getPowerPointThumbnail(index: number): Promise<SlideThumbnail> {
  const cached = thumbnailCache.get(index);
  if (cached) return cached;

  const previewPath = powerPointPreviewPath(index);
  if (state.previewStatus === "ready" && previewPath) {
    try {
      const result = thumbnailFromBuffer(index, await fs.readFile(previewPath));
      if (result) {
        thumbnailCache.set(index, result);
        return result;
      }
    } catch {
      // Fall through to the package thumbnail or an explicit error state.
    }
  }

  if (index === 0 && powerPointPackageThumbnail) {
    const fallback = thumbnailFromBuffer(index, powerPointPackageThumbnail);
    if (fallback) return fallback;
  }
  if (state.previewStatus === "loading") {
    return { index, status: "loading", message: "正在通过 PowerPoint 生成缩略图" };
  }
  return {
    index,
    status: "error",
    message: state.previewError ?? "这页 PowerPoint 缩略图暂时不可用",
  };
}

async function getPdfThumbnail(index: number): Promise<SlideThumbnail> {
  const cached = thumbnailCache.get(index);
  if (cached) return cached;
  const previewPath = pdfPreviewPath(index);
  if (!previewPath) {
    return { index, status: "error", message: "PDF 缩略图暂时不可用" };
  }
  try {
    const result = thumbnailFromBuffer(index, await fs.readFile(previewPath));
    if (result) {
      thumbnailCache.set(index, result);
      return result;
    }
  } catch {
    // Fall through to a user-facing error state.
  }
  return { index, status: "error", message: "PDF 缩略图暂时不可用" };
}

async function getSlideThumbnail(requestedIndex: number): Promise<SlideThumbnail> {
  const index = Math.round(Number(requestedIndex));
  if (!state.deckPath || !Number.isFinite(index)) {
    return { index: 0, status: "unavailable", message: "尚未打开演示" };
  }
  if (!state.adapterRecognized || state.slideCount <= 0) {
    return { index, status: "unavailable", message: "此演示无法自动定位页面" };
  }
  if (index < 0 || index >= state.slideCount) {
    return { index, status: "unavailable", message: "这页没有对应的演示页面" };
  }

  if (state.deckType === "powerpoint") return getPowerPointThumbnail(index);
  if (state.deckType === "pdf") return getPdfThumbnail(index);

  const cached = thumbnailCache.get(index);
  if (cached) return cached;

  const deckPath = state.deckPath;
  const task = thumbnailQueue.then(() => generateSlideThumbnail(deckPath, index));
  thumbnailQueue = task.then(() => undefined, () => undefined);
  return task;
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
  if (!cueWindow) return;
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const presentationDisplay = displays.find((display) => display.id !== primary.id) ?? primary;

  if (presentationWindow) {
    presentationWindow.setBounds(presentationDisplay.bounds, false);
    presentationWindow.setAlwaysOnTop(false);
  }

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

async function openHtmlDeck(deckPath: string): Promise<AppState> {
  const sidecarPath = notesPathForDeck(deckPath);
  const sidecarExists = await pathExists(sidecarPath);
  const notes = await readNotesFile(sidecarPath);

  state = {
    ...state,
    deckPath,
    deckName: path.basename(deckPath),
    deckType: "html",
    notesPath: sidecarPath,
    notes,
    notesSource: sidecarExists ? "local" : null,
    slideCount: 0,
    currentIndex: settings.progressByDeck[deckPath] ?? 0,
    adapter: "manual",
    adapterRecognized: false,
    previewStatus: "ready",
    previewError: null,
    lastError: null,
    savedAt: null,
  };
  settings.lastDeckPath = deckPath;
  scheduleSettingsSave();
  resetThumbnailRenderer();
  resetPowerPointPreview();
  resetPdfPreview();

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

async function openPowerPointDeck(
  deckPath: string,
  powerPointDeck?: PowerPointDeck,
): Promise<AppState> {
  const importedDeck = powerPointDeck ?? await readPowerPointDeck(deckPath);
  const sidecarPath = notesPathForDeck(deckPath);
  const sidecarExists = await pathExists(sidecarPath);
  const notes = sidecarExists
    ? ensureNoteCount(await readNotesFile(sidecarPath), importedDeck.slideCount)
    : importedDeck.notes;

  resetThumbnailRenderer();
  resetPowerPointPreview();
  resetPdfPreview();
  if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.destroy();
  presentationWindow = null;
  powerPointPackageThumbnail = importedDeck.packageThumbnail;
  powerPointPreviewDirectory = await previewDirectoryForPowerPoint(deckPath);
  const previewReady = await hasCompletePowerPointPreview(importedDeck.slideCount);
  const generation = powerPointPreviewGeneration;

  state = {
    ...state,
    deckPath,
    deckName: path.basename(deckPath),
    deckType: "powerpoint",
    notesPath: sidecarPath,
    notes,
    notesSource: sidecarExists ? "local" : "powerpoint",
    slideCount: importedDeck.slideCount,
    currentIndex: clampIndex(
      settings.progressByDeck[deckPath] ?? 0,
      importedDeck.slideCount,
    ),
    adapter: "powerpoint",
    adapterRecognized: true,
    previewStatus: previewReady ? "ready" : "loading",
    previewError: null,
    lastError: null,
    savedAt: null,
  };
  settings.lastDeckPath = deckPath;
  scheduleSettingsSave();

  if (!sidecarExists) {
    try {
      await writeNotesFile(sidecarPath, notes);
      state.savedAt = new Date().toISOString();
    } catch (error) {
      state.lastError = `无法保存 PowerPoint 讲稿副本：${String(error)}`;
    }
  }

  const snapshot = broadcastState();
  if (!previewReady) {
    void preparePowerPointPreview(deckPath, importedDeck.slideCount, generation);
  }
  return snapshot;
}

async function openPdfDeck(deckPath: string): Promise<AppState> {
  const sidecarPath = notesPathForDeck(deckPath);
  const sidecarExists = await pathExists(sidecarPath);
  const stats = await fs.stat(deckPath);
  const cacheKey = createHash("sha256")
    .update(deckPath)
    .update(String(stats.size))
    .update(String(stats.mtimeMs))
    .digest("hex")
    .slice(0, 20);
  const outputDirectory = path.join(app.getPath("userData"), "pdf-previews", cacheKey);

  resetThumbnailRenderer();
  resetPowerPointPreview();
  resetPdfPreview();
  if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.destroy();

  let slideCount: number;
  try {
    slideCount = await preparePdfPreview(deckPath, outputDirectory);
  } catch (error) {
    throw new Error(
      `无法读取 PDF：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const notes = sidecarExists
    ? ensureNoteCount(await readNotesFile(sidecarPath), slideCount)
    : ensureNoteCount([], slideCount);

  pdfPreviewDirectory = outputDirectory;
  presentationWindow = createPresentationWindow();
  presentationWindow.setTitle(`CueDeck Presentation - ${path.basename(deckPath)}`);
  try {
    await presentationWindow.loadFile(pdfPresentationPath!);
  } catch (error) {
    state.lastError = `无法打开 PDF 演示：${String(error)}`;
  }

  state = {
    ...state,
    deckPath,
    deckName: path.basename(deckPath),
    deckType: "pdf",
    notesPath: sidecarPath,
    notes,
    notesSource: sidecarExists ? "local" : null,
    slideCount,
    currentIndex: clampIndex(settings.progressByDeck[deckPath] ?? 0, slideCount),
    adapter: "pdf",
    adapterRecognized: true,
    previewStatus: "ready",
    previewError: null,
    lastError: null,
    savedAt: null,
  };
  settings.lastDeckPath = deckPath;
  scheduleSettingsSave();

  if (!sidecarExists) {
    try {
      await writeNotesFile(sidecarPath, notes);
      state.savedAt = new Date().toISOString();
    } catch (error) {
      state.lastError = `无法保存 PDF 讲稿副本：${String(error)}`;
    }
  }
  presentationWindow.webContents.send("presentation:activate", state.currentIndex);
  return broadcastState();
}

async function openDeck(deckPath: string): Promise<AppState> {
  const extension = path.extname(deckPath).toLowerCase();
  await fs.access(deckPath);
  if ([".html", ".htm"].includes(extension)) return openHtmlDeck(deckPath);
  if (powerPointExtensions.has(extension)) return openPowerPointDeck(deckPath);
  if (pdfExtensions.has(extension)) return openPdfDeck(deckPath);
  if (extension === ".ppt") {
    throw new Error("旧版 .ppt 暂不支持，请先在 PowerPoint 中另存为 .pptx。");
  }
  throw new Error("请选择 HTML、PDF 或 PowerPoint (.pptx) 演示文件。");
}

function moveManualIndex(delta: NudgeDirection): void {
  const count = Math.max(state.slideCount, state.notes.length, 1);
  state.currentIndex = clampIndex(state.currentIndex + delta, count);
  rememberProgress();
  broadcastState();
}

function sendNavigation(direction: NavigationDirection): void {
  if (state.deckType === "powerpoint") {
    void navigatePowerPoint(direction).catch((error) => {
      state.lastError = error instanceof Error ? error.message : String(error);
      broadcastState();
    });
    return;
  }
  if (!presentationWindow || presentationWindow.isDestroyed()) return;
  const keyCode = direction === "next" ? "Right" : "Left";
  presentationWindow.webContents.sendInputEvent({ type: "keyDown", keyCode });
  presentationWindow.webContents.sendInputEvent({ type: "keyUp", keyCode });
  setTimeout(() => {
    presentationWindow?.webContents.send("presentation:probe");
  }, 140);
}

function stopPowerPointPolling(): void {
  if (powerPointPollTimer) clearInterval(powerPointPollTimer);
  powerPointPollTimer = null;
  powerPointPollBusy = false;
  powerPointClosedPolls = 0;
}

async function syncPowerPointState(): Promise<void> {
  if (powerPointPollBusy || !state.presenting || state.deckType !== "powerpoint") return;
  powerPointPollBusy = true;
  try {
    const slideNumber = await powerPointSlideNumber();
    if (slideNumber === null) {
      powerPointClosedPolls += 1;
      if (powerPointClosedPolls >= 2) stopPresentation(true);
      return;
    }
    powerPointClosedPolls = 0;
    const nextIndex = clampIndex(slideNumber - 1, state.slideCount);
    if (nextIndex !== state.currentIndex) {
      state.currentIndex = nextIndex;
      rememberProgress();
      broadcastState();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.lastError !== message) {
      state.lastError = message;
      broadcastState();
    }
  } finally {
    powerPointPollBusy = false;
  }
}

function startPowerPointPolling(): void {
  stopPowerPointPolling();
  void syncPowerPointState();
  powerPointPollTimer = setInterval(() => void syncPowerPointState(), 350);
}

async function startPresentation(): Promise<AppState> {
  if (!state.deckPath) return publicState();
  setCueWindowLocked(false);
  if (!cueWindow || cueWindow.isDestroyed()) cueWindow = createCueWindow();
  arrangePresentationWindows();
  state.lastError = null;

  if (state.deckType === "powerpoint") {
    // Preview export and slideshow control both use PowerPoint Apple Events.
    // Cancel an in-flight export before starting the live show to avoid a
    // second automation request waiting behind a long PDF export.
    if (state.previewStatus === "loading") {
      cancelPowerPointPreview();
      powerPointPreviewGeneration += 1;
      state.previewStatus = "idle";
      state.previewError = null;
    }
    try {
      await startPowerPointPresentation(state.deckPath, state.currentIndex + 1);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      return broadcastState();
    }
  } else if (!presentationWindow || presentationWindow.isDestroyed()) {
    state.lastError = "演示窗口尚未准备好，请重新打开演示文件。";
    return broadcastState();
  }

  state.presenting = true;
  state.cueVisible = true;
  setupWindow?.hide();
  if (state.deckType === "html" || state.deckType === "pdf") {
    presentationWindow?.show();
    presentationWindow?.focus();
  }
  cueWindow.showInactive();
  cueWindow.moveTop();
  if (state.deckType === "powerpoint") startPowerPointPolling();
  return broadcastState();
}

function stopPresentation(skipPowerPointStop = false): void {
  const wasPowerPoint = state.deckType === "powerpoint";
  stopPowerPointPolling();
  state.presenting = false;
  state.cueVisible = false;
  presentationWindow?.hide();
  cueWindow?.hide();
  const shouldResumePreview = wasPowerPoint &&
    state.previewStatus === "idle" &&
    Boolean(state.deckPath) &&
    Boolean(powerPointPreviewDirectory);
  if (wasPowerPoint && !skipPowerPointStop) {
    void stopPowerPointPresentation().finally(() => {
      if (!shouldResumePreview || !state.deckPath) return;
      state.previewStatus = "loading";
      state.previewError = null;
      const generation = powerPointPreviewGeneration;
      void preparePowerPointPreview(state.deckPath, state.slideCount, generation);
    });
  } else if (shouldResumePreview && state.deckPath) {
    state.previewStatus = "loading";
    state.previewError = null;
    const generation = powerPointPreviewGeneration;
    void preparePowerPointPreview(state.deckPath, state.slideCount, generation);
  }
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
      title: "选择 HTML、PDF 或 PowerPoint 演示",
      properties: ["openFile"],
      filters: [
        { name: "支持的演示", extensions: ["html", "htm", "pdf", "pptx", "pptm", "ppsx", "ppsm"] },
        { name: "HTML 演示", extensions: ["html", "htm"] },
        { name: "PDF 演示", extensions: ["pdf"] },
        { name: "PowerPoint 演示", extensions: ["pptx", "pptm", "ppsx", "ppsm"] },
      ],
    };
    const result = setupWindow
      ? await dialog.showOpenDialog(setupWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return publicState();
    try {
      return await openDeck(result.filePaths[0]);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      return broadcastState();
    }
  });
  ipcMain.handle("deck:open", async (_event, deckPath: string) => {
    try {
      return await openDeck(deckPath);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      return broadcastState();
    }
  });
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
    state.notesSource = "markdown";
    await writeNotes();
    return broadcastState();
  });
  ipcMain.handle("notes:import-powerpoint", async () => {
    if (!state.deckPath || state.deckType !== "powerpoint") return publicState();
    try {
      const imported = await readPowerPointDeck(state.deckPath);
      state.notes = ensureNoteCount(imported.notes, imported.slideCount);
      state.slideCount = imported.slideCount;
      state.currentIndex = clampIndex(state.currentIndex, imported.slideCount);
      state.notesSource = "powerpoint";
      await writeNotes();
    } catch (error) {
      state.lastError = `无法重新读取 PowerPoint 备注：${error instanceof Error ? error.message : String(error)}`;
    }
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
    state.notesSource = "local";
    scheduleNoteSave();
    return broadcastState();
  });
  ipcMain.handle("thumbnail:get", (_event, index: number) => getSlideThumbnail(index));
  ipcMain.handle("presentation:start", () => startPresentation());
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
    if (
      !["html", "pdf"].includes(state.deckType ?? "") ||
      !presentationWindow ||
      event.sender.id !== presentationWindow.webContents.id
    ) return;
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
  stopPowerPointPolling();
  if (state.presenting && state.deckType === "powerpoint") void stopPowerPointPresentation();
  resetThumbnailRenderer();
  resetPowerPointPreview();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
