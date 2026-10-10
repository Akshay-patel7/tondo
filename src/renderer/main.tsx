import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { READY_MARK } from "../shared/ready";
import { App } from "./App";
import { connectToHost } from "./connection";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing the #root element");

connectToHost();

const root = createRoot(container);
flushSync(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// A task queued from requestAnimationFrame runs after that frame has painted.
requestAnimationFrame(() => {
  setTimeout(() => {
    performance.mark(READY_MARK);
    console.info(READY_MARK);
  }, 0);
});

// Main switches the theme through the page's color scheme. The change event
// comes before the frame that restyles the page, so theme-switching (index.css)
// is on for that frame and comes off in the next one, as T3 Code's applyTheme
// does. A second switch before then keeps it on.
let themeSwitchFrame = 0;
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  document.documentElement.classList.add("theme-switching");
  cancelAnimationFrame(themeSwitchFrame);
  themeSwitchFrame = requestAnimationFrame(() => {
    themeSwitchFrame = requestAnimationFrame(() => {
      document.documentElement.classList.remove("theme-switching");
    });
  });
});
