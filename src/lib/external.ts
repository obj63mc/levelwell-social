/** Opens a URL in the system browser (Tauri) or a new tab (plain browser dev). */
export async function openExternal(url: string): Promise<void> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    // The opener rejects a URL outside the capability allowlist, and a rejection
    // on a click handler is invisible — the button just looks dead. Say so.
    console.error(`Could not open ${url}`, error);
    throw error;
  }
}
