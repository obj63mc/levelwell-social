import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifySignature } from "./webhooks";

const http = httpRouter();

auth.addHttpRoutes(http);

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · LevelWell Social</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#fafafa;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#a1a1aa;line-height:1.5}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Meta Facebook Login redirect URI.
http.route({
  path: "/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

    if (!state) return page("Invalid request", "<p>Missing login state. Start the connection again from the app.</p>", 400);
    if (error || !code) {
      await ctx.runMutation(internal.meta.oauth.finishState, {
        state,
        status: "failed",
        error: error ?? "Facebook did not return an authorization code.",
      });
      return page("Login cancelled", `<p>${escapeHtml(error ?? "No authorization code was returned.")}</p><p>You can close this tab and try again in LevelWell Social.</p>`, 400);
    }

    try {
      await ctx.runAction(internal.meta.oauth.completeConnect, { code, state });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return page("Connection failed", `<p>${escapeHtml(message)}</p><p>Close this tab and try again in LevelWell Social.</p>`, 500);
    }
    return page("Connected", "<p>Your Facebook Pages and Instagram accounts are linked.</p><p>You can close this tab and return to LevelWell Social.</p>");
  }),
});

// Meta webhook verification handshake.
http.route({
  path: "/webhooks/meta",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }),
});

// Meta webhook deliveries (comments etc.). Verified, stored raw, acked fast.
http.route({
  path: "/webhooks/meta",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const valid = await verifySignature(rawBody, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET);
    if (!valid) return new Response("Invalid signature", { status: 401 });

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const object =
      payload && typeof payload === "object" && typeof (payload as { object?: unknown }).object === "string"
        ? (payload as { object: string }).object
        : "unknown";
    await ctx.runMutation(internal.webhooks.recordEvent, { object, payload });
    return new Response("EVENT_RECEIVED", { status: 200 });
  }),
});

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default http;
