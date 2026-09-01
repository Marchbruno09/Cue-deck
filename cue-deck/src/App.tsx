import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  FileText,
  FolderOpen,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  Import,
  Lock,
  LoaderCircle,
  Minus,
  MonitorPlay,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScreenShare,
  Unlock,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createEmptyNote } from "./lib/notes";
import type { AdapterKind, AppState, SlideNote, SlideThumbnail } from "./types";

const emptyState: AppState = {
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

function useAppState() {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.cueDeck.getState().then((nextState) => {
      if (!mounted) return;
      setState(nextState);
      setReady(true);
    });
    const unsubscribe = window.cueDeck.onState((nextState) => {
      setState(nextState);
      setReady(true);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { state, setState, ready };
}

function adapterLabel(adapter: AdapterKind): string {
  switch (adapter) {
    case "frontend-slides":
      return "Frontend Slides";
    case "reveal":
      return "Reveal.js";
    case "generic":
      return "通用 HTML";
    case "bel":
      return "Bel 场景同步";
    case "powerpoint":
      return "Microsoft PowerPoint";
    case "pdf":
      return "PDF 页面";
    default:
      return "手动同步";
  }
}

function deckTypeLabel(deckType: AppState["deckType"]): string {
  switch (deckType) {
    case "url":
      return "本地网页";
    case "powerpoint":
      return "PowerPoint";
    case "pdf":
      return "PDF";
    default:
      return "HTML";
  }
}

function savedLabel(savedAt: string | null): string {
  if (!savedAt) return "本机草稿";
  const time = new Date(savedAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${time} 已保存`;
}

function LocalUrlDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (url: string) => void;
}) {
  const [draft, setDraft] = useState("http://127.0.0.1:4174/");

  useEffect(() => {
    if (open) setDraft("http://127.0.0.1:4174/");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="url-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="url-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <div className="url-dialog-heading">
          <div className="url-dialog-icon"><Globe2 size={20} /></div>
          <div>
            <h2>连接本地网页</h2>
            <p>网页会在 CueDeck 的演示窗口中运行，页面内的点击和输入仍然可用。</p>
          </div>
        </div>
        <label className="field-label" htmlFor="local-url">本地网页 URL</label>
        <input
          id="local-url"
          className="url-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="http://127.0.0.1:4174/prototypes/demo.html"
          autoFocus
          spellCheck={false}
          disabled={busy}
        />
        <p className="url-dialog-hint">仅允许 localhost、127.0.0.1 或 ::1 地址。</p>
        {error && <p className="url-dialog-error">{error}</p>}
        <div className="url-dialog-actions">
          <button type="button" className="secondary-command" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="primary-command" disabled={busy || !draft.trim()}>
            {busy ? <LoaderCircle className="thumbnail-spinner" size={16} /> : <Globe2 size={16} />}
            {busy ? "正在连接" : "连接网页"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SetupView({ state }: { state: AppState }) {
  const [draftNotes, setDraftNotes] = useState<SlideNote[]>(state.notes);
  const [selectedIndex, setSelectedIndex] = useState(state.currentIndex);
  const [busy, setBusy] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<SlideThumbnail | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const thumbnailRequest = useRef(0);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setDraftNotes(state.notes);
  }, [state.deckPath, state.notes]);

  useEffect(() => {
    const upperBound = Math.max(draftNotes.length, state.slideCount, 1) - 1;
    setSelectedIndex((current) => Math.min(Math.max(current, 0), upperBound));
  }, [draftNotes.length, state.slideCount]);

  useEffect(() => {
    if (!state.presenting) setSelectedIndex(state.currentIndex);
  }, [state.currentIndex, state.presenting]);

  const run = useCallback(async (label: string, operation: () => Promise<AppState>) => {
    setBusy(label);
    try {
      await operation();
    } finally {
      setBusy(null);
    }
  }, []);

  const connectUrl = useCallback(async (url: string) => {
    setBusy("url");
    setUrlError(null);
    try {
      const nextState = await window.cueDeck.openUrl(url);
      if (nextState.lastError) {
        setUrlError(nextState.lastError);
        return;
      }
      setUrlDialogOpen(false);
    } finally {
      setBusy(null);
    }
  }, []);

  const queueSave = useCallback((notes: SlideNote[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.cueDeck.updateNotes(notes);
    }, 280);
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const updateNote = (patch: Partial<SlideNote>) => {
    const notes = [...draftNotes];
    while (notes.length <= selectedIndex) notes.push(createEmptyNote(notes.length));
    notes[selectedIndex] = { ...notes[selectedIndex], ...patch };
    setDraftNotes(notes);
    queueSave(notes);
  };

  const addNote = () => {
    const notes = [...draftNotes, createEmptyNote(draftNotes.length)];
    setDraftNotes(notes);
    setSelectedIndex(notes.length - 1);
    queueSave(notes);
  };

  const selectedNote = draftNotes[selectedIndex] ?? createEmptyNote(selectedIndex);
  const rowCount = Math.max(draftNotes.length, state.slideCount);
  const extraNotes = Math.max(0, draftNotes.length - state.slideCount);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, rowCount]);

  useEffect(() => {
    const requestId = ++thumbnailRequest.current;
    let cancelled = false;
    setThumbnail(null);
    setThumbnailLoading(true);
    void window.cueDeck.getSlideThumbnail(selectedIndex).then((result) => {
      if (cancelled || thumbnailRequest.current !== requestId) return;
      setThumbnail(result);
      setThumbnailLoading(false);
    }).catch(() => {
      if (cancelled || thumbnailRequest.current !== requestId) return;
      setThumbnail({
        index: selectedIndex,
        status: "error",
        message: "缩略图生成失败",
      });
      setThumbnailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    selectedIndex,
    state.adapterRecognized,
    state.deckPath,
    state.previewStatus,
    state.slideCount,
  ]);

  if (!state.deckPath) {
    return (
      <>
        <main className="empty-shell">
          <div className="brand-lockup">
            <div className="brand-mark"><MonitorPlay size={24} /></div>
            <div>
              <h1>CueDeck</h1>
              <p>私密提词 · HTML / 本地网页 / PDF / PowerPoint</p>
            </div>
          </div>
          <div className="empty-actions">
            <button
              className="primary-command large-command"
              onClick={() => run("open", window.cueDeck.chooseDeck)}
              disabled={busy !== null}
            >
              <FolderOpen size={20} />
              选择演示文件
            </button>
            <button
              className="secondary-command large-command"
              onClick={() => { setUrlError(null); setUrlDialogOpen(true); }}
              disabled={busy !== null}
            >
              <Globe2 size={20} />
              连接本地网页
            </button>
          </div>
          {state.lastError && <p className="error-text">{state.lastError}</p>}
        </main>
        <LocalUrlDialog
          open={urlDialogOpen}
          busy={busy === "url"}
          error={urlError}
          onClose={() => setUrlDialogOpen(false)}
          onSubmit={connectUrl}
        />
      </>
    );
  }

  return (
    <main className="setup-shell">
      <header className="app-header">
        <div className="brand-lockup compact">
          <div className="brand-mark"><MonitorPlay size={20} /></div>
          <div>
            <h1>CueDeck</h1>
            <p>{state.deckName}</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="save-status">
            {state.savedAt ? <Check size={15} /> : <Save size={15} />}
            {savedLabel(state.savedAt)}
          </span>
          <button
            className="secondary-command"
            onClick={() => run("open", window.cueDeck.chooseDeck)}
            disabled={busy !== null}
          >
            <FolderOpen size={17} />
            更换演示
          </button>
          <button
            className="secondary-command"
            onClick={() => { setUrlError(null); setUrlDialogOpen(true); }}
            disabled={busy !== null}
          >
            <Globe2 size={17} />
            连接网页
          </button>
          <button
            className="primary-command"
            onClick={() => run("present", window.cueDeck.startPresentation)}
            disabled={busy !== null}
          >
            <ScreenShare size={18} />
            开始演示
          </button>
        </div>
      </header>

      {state.lastError && <div className="error-banner">{state.lastError}</div>}

      <section className="setup-workspace">
        <aside className="slide-rail">
          <div className="rail-heading">
            <span>讲稿页</span>
            <span className="count-label">{rowCount || 0}</span>
          </div>
          <div className="slide-list">
            {Array.from({ length: rowCount }, (_, index) => {
              const note = draftNotes[index] ?? createEmptyNote(index);
              const isExtra = index >= state.slideCount && state.slideCount > 0;
              return (
                <button
                  key={note.id || index}
                  ref={selectedIndex === index ? selectedRowRef : undefined}
                  className={`slide-row ${selectedIndex === index ? "selected" : ""}`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="slide-number">{index + 1}</span>
                  <span className="slide-title">{note.title || `第 ${index + 1} 页`}</span>
                  {isExtra && <span className="extra-tag">多余</span>}
                </button>
              );
            })}
          </div>
          <button className="rail-add" onClick={addNote}>
            <Plus size={16} />
            新增讲稿页
          </button>
        </aside>

        <section className="editor-pane">
          <div className="editor-heading">
            <div>
              <span className="eyebrow">第 {selectedIndex + 1} 页</span>
              <h2>{selectedNote.title || `第 ${selectedIndex + 1} 页`}</h2>
            </div>
            <div className="editor-actions">
              <button
                className="secondary-command"
                onClick={() => run("import", window.cueDeck.importNotes)}
                disabled={busy !== null}
              >
                <Import size={17} />
                导入 Markdown
              </button>
              {state.deckType === "powerpoint" && (
                <button
                  className="secondary-command"
                  onClick={() => run("ppt-notes", window.cueDeck.importPowerPointNotes)}
                  disabled={busy !== null}
                  title="重新读取 PPT 中的 speaker notes"
                >
                  <RefreshCw size={16} />
                  读取 PPT 备注
                </button>
              )}
              <button
                className="icon-command"
                onClick={() => run("export", window.cueDeck.exportNotes)}
                disabled={busy !== null}
                title="导出 Markdown"
                aria-label="导出 Markdown"
              >
                <Download size={18} />
              </button>
            </div>
          </div>

          <label className="field-label" htmlFor="cue-title">页面提示</label>
          <input
            id="cue-title"
            className="title-input"
            value={selectedNote.title}
            onChange={(event) => updateNote({ title: event.target.value })}
            placeholder={`第 ${selectedIndex + 1} 页`}
          />

          <label className="field-label" htmlFor="cue-body">讲稿</label>
          <textarea
            id="cue-body"
            className="script-editor"
            value={selectedNote.body}
            onChange={(event) => updateNote({ body: event.target.value })}
            placeholder="输入这一页要讲的内容…"
            spellCheck
          />

          <div className="editor-lower">
            <section className="notes-preview-section">
              <div className="preview-heading">
                <EyeOff size={16} />
                提词卡预览
              </div>
              <div className="markdown-preview">
                {selectedNote.body ? (
                  <ReactMarkdown>{selectedNote.body}</ReactMarkdown>
                ) : (
                  <span className="empty-preview">本页讲稿为空</span>
                )}
              </div>
            </section>

            <figure className="slide-thumbnail">
              <figcaption>
                <span><ImageIcon size={15} /> 演示页面</span>
                <strong>第 {selectedIndex + 1} 页</strong>
              </figcaption>
              <div
                className={`slide-thumbnail-frame ${thumbnail?.status ?? "loading"}`}
                aria-live="polite"
              >
                {thumbnailLoading || thumbnail?.status === "loading" ? (
                  <div className="thumbnail-state">
                    <LoaderCircle className="thumbnail-spinner" size={20} />
                    <span>{thumbnail?.message ?? "正在生成缩略图"}</span>
                  </div>
                ) : thumbnail?.status === "ready" && thumbnail.dataUrl ? (
                  <img
                    src={thumbnail.dataUrl}
                    alt={`第 ${selectedIndex + 1} 页 ${deckTypeLabel(state.deckType)} 缩略图`}
                  />
                ) : (
                  <div className="thumbnail-state">
                    <ImageIcon size={21} />
                    <span>{thumbnail?.message ?? "无法生成缩略图"}</span>
                  </div>
                )}
              </div>
            </figure>
          </div>
        </section>

        <aside className="status-pane">
          <div className="status-section">
            <span className="eyebrow">演示同步</span>
            <strong>{adapterLabel(state.adapter)}</strong>
            <span className={`status-dot-row ${state.adapterRecognized ? "ok" : "manual"}`}>
              <span className="status-dot" />
              {state.adapterRecognized ? `${state.slideCount} 页已同步` : "手动同步模式"}
            </span>
            {state.deckType === "powerpoint" && (
              <span className="notes-source">
                {state.notesSource === "powerpoint"
                  ? "已读取 PPT speaker notes"
                  : state.notesSource === "markdown"
                    ? "当前使用导入的 Markdown"
                    : "当前使用本机讲稿副本"}
              </span>
            )}
          </div>
          <div className="status-section">
            <span className="eyebrow">Zoom 共享窗口</span>
            <strong className="share-window-name">
              {state.deckType === "powerpoint"
                ? `PowerPoint Slide Show - ${state.deckName}`
                : `CueDeck Presentation - ${state.deckName}`}
            </strong>
            <span className="privacy-state"><Lock size={15} /> 私密提词窗已保护</span>
          </div>
          {state.deckType === "url" && (
            <div className="status-section">
              <span className="eyebrow">本地网页地址</span>
              <code className="source-url" title={state.deckPath ?? undefined}>{state.deckPath}</code>
            </div>
          )}
          <div className="status-section metrics">
            <div>
              <span>屏幕</span>
              <strong>{state.displayCount}</strong>
            </div>
            <div>
              <span>演示页</span>
              <strong>{state.slideCount || "—"}</strong>
            </div>
            <div>
              <span>讲稿页</span>
              <strong>{draftNotes.length}</strong>
            </div>
          </div>
          {extraNotes > 0 && (
            <div className="mismatch-notice">
              <FileText size={17} />
              {extraNotes} 页讲稿尚未匹配 {deckTypeLabel(state.deckType)}
            </div>
          )}
          <div className="status-spacer" />
          <p className="sidecar-path" title={state.notesPath ?? undefined}>
            {state.notesPath}
          </p>
        </aside>
      </section>
      <LocalUrlDialog
        open={urlDialogOpen}
        busy={busy === "url"}
        error={urlError}
        onClose={() => setUrlDialogOpen(false)}
        onSubmit={connectUrl}
      />
    </main>
  );
}

function CueView({ state }: { state: AppState }) {
  const currentNote = state.notes[state.currentIndex] ?? createEmptyNote(state.currentIndex);
  const nextNote = state.notes[state.currentIndex + 1];

  const navigate = useCallback((direction: "next" | "previous") => {
    void window.cueDeck.navigate(direction);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        navigate("next");
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        navigate("previous");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const handleCueBodyClick = () => {
    if (window.getSelection()?.toString()) return;
    navigate("next");
  };

  return (
    <main className={`cue-shell ${state.cueLocked ? "locked" : ""}`}>
      <header className="cue-titlebar">
        <span
          className="cue-drag-handle"
          title={state.cueLocked ? "位置已锁定，请先解锁" : "拖动悬浮卡片"}
          aria-label={state.cueLocked ? "位置已锁定" : "拖动悬浮卡片"}
        >
          <GripVertical size={17} />
        </span>
        <div className="private-label"><Lock size={13} /> 私密</div>
        <span className="cue-deck-name" title={state.deckName ?? undefined}>{state.deckName}</span>
        <span className="cue-counter">
          {Math.min(state.currentIndex + 1, Math.max(state.slideCount, state.notes.length, 1))}
          <span>/</span>
          {Math.max(state.slideCount, state.notes.length, 1)}
        </span>
        <div className="cue-window-actions">
          <button
            className={`cue-icon-button ${state.cueLocked ? "active" : ""}`}
            onClick={() => void window.cueDeck.toggleCueLock()}
            title={state.cueLocked ? "解锁位置" : "锁定位置"}
            aria-label={state.cueLocked ? "解锁位置" : "锁定位置"}
            aria-pressed={state.cueLocked}
          >
            {state.cueLocked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
          <button
            className="cue-icon-button"
            onClick={() => void window.cueDeck.editCurrent()}
            title="编辑当前讲稿"
            aria-label="编辑当前讲稿"
          >
            <Pencil size={16} />
          </button>
          <button
            className="cue-icon-button"
            onClick={() => void window.cueDeck.toggleCueVisibility()}
            title="隐藏提词卡"
            aria-label="隐藏提词卡"
          >
            <EyeOff size={17} />
          </button>
        </div>
      </header>

      <div className="cue-page-heading">
        <span>第 {state.currentIndex + 1} 页</span>
        <strong>{currentNote.title}</strong>
      </div>

      <section
        className="cue-script"
        style={{ fontSize: `${state.fontSize}px` }}
        onClick={handleCueBodyClick}
        title="点击进入下一步"
      >
        {currentNote.body ? (
          <ReactMarkdown>{currentNote.body}</ReactMarkdown>
        ) : (
          <p className="cue-empty">本页讲稿为空</p>
        )}
      </section>

      <footer className="cue-footer">
        <div className="next-cue">
          <span>下一页</span>
          <strong>{nextNote?.title ?? "演示结束"}</strong>
        </div>
        <div className="cue-controls">
          {!state.adapterRecognized && (
            <div className="manual-controls" aria-label="讲稿页码校准">
              <button
                onClick={() => void window.cueDeck.nudge(-1)}
                title="仅将讲稿校准到上一页"
                aria-label="仅将讲稿校准到上一页"
              >
                <ChevronLeft size={16} />
              </button>
              <span>校准</span>
              <button
                onClick={() => void window.cueDeck.nudge(1)}
                title="仅将讲稿校准到下一页"
                aria-label="仅将讲稿校准到下一页"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <div className="font-controls" aria-label="讲稿字号">
            <button
              onClick={() => void window.cueDeck.setFontSize(state.fontSize - 2)}
              title="减小字号"
              aria-label="减小字号"
            >
              <Minus size={15} />
            </button>
            <span>{state.fontSize}</span>
            <button
              onClick={() => void window.cueDeck.setFontSize(state.fontSize + 2)}
              title="增大字号"
              aria-label="增大字号"
            >
              <Plus size={15} />
            </button>
          </div>
          <button
            className="cue-nav-button previous"
            onClick={() => navigate("previous")}
            title="上一页"
            aria-label="上一页"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="cue-nav-button next"
            onClick={() => navigate("next")}
            title="下一步"
            aria-label="下一步"
          >
            <ArrowRight size={19} />
          </button>
        </div>
      </footer>
    </main>
  );
}

export default function App() {
  const { state, ready } = useAppState();
  const view = useMemo(
    () => new URLSearchParams(window.location.search).get("view") ?? "setup",
    [],
  );

  if (!ready) return <div className="loading-shell" />;
  return view === "cue" ? <CueView state={state} /> : <SetupView state={state} />;
}
