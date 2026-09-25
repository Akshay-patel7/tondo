import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { READY_MARK } from "../shared/ready";
import { App } from "./App";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing the #root element");

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
