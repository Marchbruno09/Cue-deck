export type DeckType = "html" | "url" | "powerpoint" | "pdf";
export type AdapterKind = "frontend-slides" | "reveal" | "generic" | "bel" | "powerpoint" | "pdf" | "manual";
export type DeckPreviewStatus = "idle" | "loading" | "ready" | "error";
export type NotesSource = "local" | "markdown" | "powerpoint" | null;

export interface SlideNote {
  id: string;
  title: string;
  body: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppState {
  deckPath: string | null;
  deckName: string | null;
  deckType: DeckType | null;
  notesPath: string | null;
  notes: SlideNote[];
  notesSource: NotesSource;
  slideCount: number;
  currentIndex: number;
  adapter: AdapterKind;
  adapterRecognized: boolean;
  presenting: boolean;
  cueVisible: boolean;
  cueLocked: boolean;
  fontSize: number;
  displayCount: number;
  previewStatus: DeckPreviewStatus;
  previewError: string | null;
  lastError: string | null;
  savedAt: string | null;
}

export interface PresentationSnapshot {
  index: number;
  count: number;
  adapter: AdapterKind;
  recognized: boolean;
}

export type SlideThumbnailStatus = "loading" | "ready" | "unavailable" | "error";

export interface SlideThumbnail {
  index: number;
  status: SlideThumbnailStatus;
  dataUrl?: string;
  message?: string;
}

export interface ThumbnailReadyMessage {
  requestId: number;
  snapshot: PresentationSnapshot;
}

export type NavigationDirection = "next" | "previous";
export type NudgeDirection = -1 | 1;

export interface CueDeckAPI {
  getState(): Promise<AppState>;
  chooseDeck(): Promise<AppState>;
  openDeck(path: string): Promise<AppState>;
  openUrl(url: string): Promise<AppState>;
  importNotes(): Promise<AppState>;
  importPowerPointNotes(): Promise<AppState>;
  exportNotes(): Promise<AppState>;
  updateNotes(notes: SlideNote[]): Promise<AppState>;
  getSlideThumbnail(index: number): Promise<SlideThumbnail>;
  startPresentation(): Promise<AppState>;
  stopPresentation(): Promise<AppState>;
  navigate(direction: NavigationDirection): Promise<AppState>;
  nudge(direction: NudgeDirection): Promise<AppState>;
  setFontSize(size: number): Promise<AppState>;
  toggleCueLock(): Promise<AppState>;
  toggleCueVisibility(): Promise<AppState>;
  editCurrent(): Promise<AppState>;
  onState(callback: (state: AppState) => void): () => void;
}
