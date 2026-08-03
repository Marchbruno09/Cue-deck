export type AdapterKind = "frontend-slides" | "reveal" | "generic" | "manual";

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
  notesPath: string | null;
  notes: SlideNote[];
  slideCount: number;
  currentIndex: number;
  adapter: AdapterKind;
  adapterRecognized: boolean;
  presenting: boolean;
  cueVisible: boolean;
  cueLocked: boolean;
  fontSize: number;
  displayCount: number;
  lastError: string | null;
  savedAt: string | null;
}

export interface PresentationSnapshot {
  index: number;
  count: number;
  adapter: AdapterKind;
  recognized: boolean;
}

export type NavigationDirection = "next" | "previous";
export type NudgeDirection = -1 | 1;

export interface CueDeckAPI {
  getState(): Promise<AppState>;
  chooseDeck(): Promise<AppState>;
  openDeck(path: string): Promise<AppState>;
  importNotes(): Promise<AppState>;
  exportNotes(): Promise<AppState>;
  updateNotes(notes: SlideNote[]): Promise<AppState>;
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
