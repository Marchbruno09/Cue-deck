import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installBrowserMock } from "./browserMock";
import "./styles.css";

if (import.meta.env.DEV && !window.cueDeck) {
  installBrowserMock();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
