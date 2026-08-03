import type { CueDeckAPI } from "./types";

declare global {
  interface Window {
    cueDeck: CueDeckAPI;
  }
}

export {};
