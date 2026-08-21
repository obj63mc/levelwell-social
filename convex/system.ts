import { query } from "./_generated/server";

// Lightweight connectivity check used by the desktop shell to prove the
// webview can reach the Convex deployment (WebSocket allowed by the Tauri CSP).
export const ping = query({
  args: {},
  handler: async () => ({ ok: true, serverTime: Date.now() }),
});
