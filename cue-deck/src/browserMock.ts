import type { AppState, CueDeckAPI, SlideNote } from "./types";

const longScript = `客户今天要判断的不是要不要再买一个 AI 工具，而是能不能把投资判断中分散的证据、假设和责任人组织成一个可执行的工作流。

- 先讲业务触发和当前决策
- 再说明证据如何进入统一语境
- 最后落到 owner、时间和下一步输出

**停顿一下，确认客户是否认同当前痛点。**`;

const sampleNotes: SlideNote[] = [
  { id: "slide-1", title: "从决策开始，而不是从功能开始", body: longScript },
  { id: "slide-2", title: "把分散证据转成可追溯判断", body: "强调来源、假设和建议之间的边界。" },
  { id: "slide-3", title: "每一步都对应明确责任人", body: "说明 What、Who、When、How。" },
  { id: "slide-4", title: "现场演示证明工作方式的变化", body: "切到实际对象和下一步动作。" },
  { id: "slide-5", title: "用一个场景启动，再逐步扩展", body: "收尾并确认下一次会议安排。" },
];

export function installBrowserMock(): void {
  let state: AppState = {
    deckPath: "/Users/admin/Documents/Demo/aramco-ventures.html",
    deckName: "aramco-ventures.html",
    deckType: "html",
    notesPath: "/Users/admin/Documents/Demo/aramco-ventures.cue.md",
    notes: sampleNotes,
    notesSource: "local",
    slideCount: 5,
    currentIndex: 0,
    adapter: "frontend-slides",
    adapterRecognized: true,
    presenting: false,
    cueVisible: false,
    cueLocked: false,
    fontSize: 22,
    displayCount: 2,
    previewStatus: "ready",
    previewError: null,
    lastError: null,
    savedAt: new Date().toISOString(),
  };
  const listeners = new Set<(nextState: AppState) => void>();

  const update = (patch: Partial<AppState>): AppState => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
    return state;
  };
  const resolved = () => Promise.resolve(state);

  const api: CueDeckAPI = {
    getState: resolved,
    chooseDeck: resolved,
    openDeck: resolved,
    openUrl: resolved,
    importNotes: resolved,
    importPowerPointNotes: resolved,
    exportNotes: resolved,
    updateNotes: (notes) => Promise.resolve(update({ notes, savedAt: new Date().toISOString() })),
    getSlideThumbnail: (index) => Promise.resolve({
      index,
      status: "unavailable",
      message: "浏览器预览不生成 HTML 缩略图",
    }),
    startPresentation: () => Promise.resolve(update({ presenting: true, cueVisible: true })),
    stopPresentation: () => Promise.resolve(update({ presenting: false, cueVisible: false })),
    navigate: (direction) => Promise.resolve(update({
      currentIndex: Math.min(
        Math.max(state.currentIndex + (direction === "next" ? 1 : -1), 0),
        state.notes.length - 1,
      ),
    })),
    nudge: (direction) => Promise.resolve(update({
      currentIndex: Math.min(Math.max(state.currentIndex + direction, 0), state.notes.length - 1),
    })),
    setFontSize: (fontSize) => Promise.resolve(update({ fontSize })),
    toggleCueLock: () => Promise.resolve(update({ cueLocked: !state.cueLocked })),
    toggleCueVisibility: () => Promise.resolve(update({ cueVisible: !state.cueVisible })),
    editCurrent: () => Promise.resolve(update({ presenting: false, cueVisible: false })),
    onState: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };

  window.cueDeck = api;
}
