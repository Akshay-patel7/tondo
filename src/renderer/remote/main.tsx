import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RemoteApp } from "./App";
import { startRemoteConnection } from "./connection";
import "../index.css";
import "./remote.css";

const root = document.getElementById("root");
if (!root) throw new Error("Remote root is missing");
const media = window.matchMedia("(prefers-color-scheme: dark)");
function scheme(): void {
  document.documentElement.classList.toggle("dark", media.matches);
}
media.addEventListener("change", scheme);
scheme();
function viewport(): void {
  const visual = window.visualViewport;
  document.documentElement.style.setProperty(
    "--remote-height",
    `${visual?.height ?? window.innerHeight}px`,
  );
  document.documentElement.style.setProperty("--remote-top", `${visual?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener("resize", viewport);
window.visualViewport?.addEventListener("scroll", viewport);
window.addEventListener("resize", viewport);
viewport();
startRemoteConnection();
createRoot(root).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
);
