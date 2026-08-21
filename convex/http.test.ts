/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-app-secret";
const VERIFY = "test-verify-token";

beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = SECRET;
  process.env.META_LOGIN_CONFIG_ID = "456";
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY;
  process.env.META_GRAPH_VERSION = "v26.0";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("GET /webhooks/meta", () => {
  test("echoes hub.challenge for the right verify token", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch(`/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=42`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  test("rejects a wrong verify token", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch(`/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`);
    expect(res.status).toBe(403);
  });
});

describe("POST /webhooks/meta", () => {
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "1", changes: [] }] });

  test("stores a correctly signed event", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/webhooks/meta", {
      method: "POST",
      headers: { "X-Hub-Signature-256": await sign(body), "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(200);
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0].object).toBe("instagram");
  });

  test("rejects a forged signature without storing", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/webhooks/meta", {
      method: "POST",
      headers: { "X-Hub-Signature-256": "sha256=00" },
      body,
    });
    expect(res.status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("webhookEvents").collect())).toHaveLength(0);
  });
});

describe("OAuth state", () => {
  test("start mints a pending state and a Facebook Login for Business URL", async () => {
    const t = convexTest(schema, modules);
    const { state, url } = await t.mutation(api.meta.oauth.start, {});
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(u.searchParams.get("client_id")).toBe("123");
    expect(u.searchParams.get("config_id")).toBe("456");
    expect(u.searchParams.get("redirect_uri")).toBe("https://example.convex.site/oauth/callback");
    expect(u.searchParams.get("state")).toBe(state);
    expect(await t.query(api.meta.oauth.status, { state })).toEqual({ status: "pending", error: undefined });
  });

  test("status follows finishState and a state cannot be consumed twice", async () => {
    const t = convexTest(schema, modules);
    const { state } = await t.mutation(api.meta.oauth.start, {});
    await t.mutation(internal.meta.oauth.consumeState, { state });
    await expect(t.mutation(internal.meta.oauth.consumeState, { state })).rejects.toThrow(/already used/);
    await t.mutation(internal.meta.oauth.finishState, { state, status: "failed", error: "boom" });
    expect(await t.query(api.meta.oauth.status, { state })).toEqual({ status: "failed", error: "boom" });
    expect(await t.query(api.meta.oauth.status, { state: "nope" })).toBeNull();
  });

  test("callback with an error marks the state failed", async () => {
    const t = convexTest(schema, modules);
    const { state } = await t.mutation(api.meta.oauth.start, {});
    const res = await t.fetch(`/oauth/callback?state=${state}&error=access_denied&error_description=User+denied`);
    expect(res.status).toBe(400);
    expect(await t.query(api.meta.oauth.status, { state })).toMatchObject({ status: "failed", error: "User denied" });
  });

  test("connectionStatus is false for an unknown session and strips tokens after login", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.profiles.connectionStatus, { sessionToken: "bogus" })).toEqual({ connected: false, profiles: [] });
    const { state } = await t.mutation(api.meta.oauth.start, {});
    await t.mutation(internal.meta.oauth.consumeState, { state });
    const connectionId = await t.mutation(internal.meta.oauth.saveConnection, {
      metaUserId: "u1",
      metaUserName: "Teresa",
      longLivedUserToken: "USER_SECRET",
      userTokenExpiresAt: 1,
      grantedScopes: ["pages_show_list"],
      pages: [{ pageId: "p1", pageName: "LevelWell", pageAccessToken: "PAGE_SECRET", tasks: ["MANAGE"], igUserId: "ig1", igUsername: "levelwell", webhookSubscribed: true }],
    });
    await t.mutation(internal.meta.oauth.finishState, { state, status: "completed", connectionId });
    const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
    const status = await t.query(api.profiles.connectionStatus, { sessionToken });
    expect(status.connected).toBe(true);
    expect(status.profiles[0]).toMatchObject({ pageName: "LevelWell", igUsername: "levelwell", status: "active" });
    expect(JSON.stringify(status)).not.toMatch(/SECRET/);
  });
});
