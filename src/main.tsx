import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "./index.css";
import App from "./App.tsx";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Follow the macOS appearance; shadcn/ui themes via the `.dark` class.
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorScheme = () =>
  document.documentElement.classList.toggle("dark", colorScheme.matches);
applyColorScheme();
colorScheme.addEventListener("change", applyColorScheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
