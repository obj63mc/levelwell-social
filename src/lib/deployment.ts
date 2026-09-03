import { useSyncExternalStore } from "react";

/**
 * The Convex deployment this install talks to. Not baked into the bundle: a
 * release ships unconfigured (see vite.config.ts, `release` mode) so a download
 * never points at someone else's backend. The build-time env vars are only a
 * default for local dev and maintainer builds.
 *
 * Both URLs are one record under one key, so they can never be half-set.
 */
export type Deployment = {
  /** Functions and the realtime WebSocket: https://<name>.convex.cloud */
  convexUrl: string;
  /** HTTP actions — OAuth callback, Meta webhooks: https://<name>.convex.site */
  siteUrl: string;
};

const KEY = "lw.deployment";
const listeners = new Set<() => void>();

// import.meta.env values are inlined at build time; `undefined` in a release build.
const envDefault: Deployment | null =
  import.meta.env.VITE_CONVEX_URL && import.meta.env.VITE_CONVEX_SITE_URL
    ? { convexUrl: import.meta.env.VITE_CONVEX_URL, siteUrl: import.meta.env.VITE_CONVEX_SITE_URL }
    : null;

export function getDeployment(): Deployment | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage unavailable: fall through to the build-time default.
  }
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Deployment).convexUrl === "string" &&
        typeof (parsed as Deployment).siteUrl === "string"
      ) {
        return { convexUrl: (parsed as Deployment).convexUrl, siteUrl: (parsed as Deployment).siteUrl };
      }
    } catch {
      // Malformed: treat as unconfigured rather than crashing the shell.
    }
  }
  return envDefault;
}

export function setDeployment(deployment: Deployment | null): void {
  try {
    if (deployment) localStorage.setItem(KEY, JSON.stringify(deployment));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the choice just won't persist across launches.
  }
  listeners.forEach((l) => l());
}

export function clearDeployment(): void {
  setDeployment(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// getSnapshot must be referentially stable between renders, so cache the parse
// and only rebuild it when the underlying string changes.
let cachedRaw: string | null = null;
let cachedValue: Deployment | null = envDefault;
function snapshot(): Deployment | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = getDeployment();
  }
  return cachedValue;
}

export function useDeployment(): Deployment | null {
  return useSyncExternalStore(subscribe, snapshot, () => envDefault);
}

const HOST = /^(?:https?:\/\/)?([a-z0-9-]+)\.convex\.(cloud|site)$/i;
const NAME = /^[a-z0-9-]+$/i;

/**
 * Canonicalises a deployment URL. Accepts `name`, `name.convex.cloud` or the full
 * https form; returns `https://<name>.convex.<kind>`, or null if it isn't one.
 * A URL for the *other* kind returns null too — the caller reports that specially.
 */
export function normalizeConvexUrl(input: string, kind: "cloud" | "site"): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (NAME.test(trimmed)) return `https://${trimmed.toLowerCase()}.convex.${kind}`;
  const match = HOST.exec(trimmed);
  if (!match || match[2].toLowerCase() !== kind) return null;
  return `https://${match[1].toLowerCase()}.convex.${kind}`;
}

/** True when the input is a well-formed URL for the *other* deployment host. */
export function isWrongKind(input: string, kind: "cloud" | "site"): boolean {
  const match = HOST.exec(input.trim().replace(/\/+$/, ""));
  return match !== null && match[2].toLowerCase() !== kind;
}

/** Prefill for the site field: the same deployment name on `.convex.site`. */
export function siteUrlFor(convexUrl: string): string {
  const normalized = normalizeConvexUrl(convexUrl, "cloud");
  return normalized ? normalized.replace(/\.convex\.cloud$/, ".convex.site") : "";
}
