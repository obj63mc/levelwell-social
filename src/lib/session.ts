import { useSyncExternalStore } from "react";

// The app session token minted after a successful Meta login. Lives in the
// Tauri webview's localStorage (app-private on macOS); only its hash is stored server-side.
const KEY = "lw.sessionToken";
const listeners = new Set<() => void>();

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the session just won't persist across launches.
  }
  listeners.forEach((l) => l());
}

export function clearSessionToken(): void {
  setSessionToken(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribe, getSessionToken, () => null);
}
