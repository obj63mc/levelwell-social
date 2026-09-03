import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Root from "./Root.tsx";

// Follow the macOS appearance; shadcn/ui themes via the `.dark` class.
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorScheme = () =>
  document.documentElement.classList.toggle("dark", colorScheme.matches);
applyColorScheme();
colorScheme.addEventListener("change", applyColorScheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
