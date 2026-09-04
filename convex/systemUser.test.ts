/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const BUSINESS = "biz_levelwellness";
const OTHER_BUSINESS = "biz_someone_else";

beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = "secret";
  process.env.META_GRAPH_VERSION = "v26.0";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.META_SYSTEM_USER_TOKEN = "SYSTEM_TOKEN";
  process.env.META_BUSINESS_ID = BUSINESS;
  delete process.env.META_LOGIN_CONFIG_ID;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.META_SYSTEM_USER_TOKEN;
  delete process.env.META_BUSINESS_ID;
});

/**
 * Fake Graph API. `userBusinesses` is what the *logged-in user's* token sees;
 * the system token always sees the Page. Distinguished by the access_token, which
 * is exactly the distinction the membership gate depends on.
 */
function stubGraph(opts: { userBusinesses?: string[]; userBusinessesFail?: boolean; systemPages?: number } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const token = url.searchParams.get("access_token");
    calls.push(`${path}?token=${token}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    if (path.endsWith("/oauth/access_token")) return json({ access_token: "USER_TOKEN", expires_in: 5184000 });
    if (path.endsWith("/me") && token === "USER_TOKEN") return json({ id: "user_1", name: "Teresa" });
    if (path.endsWith("/me/permissions")) return json({ data: [{ permission: "business_management", status: "granted" }] });
    if (path.endsWith("/me/businesses")) {
      if (token === "USER_TOKEN") {
        if (opts.userBusinessesFail) return json({ error: { message: "(#100) Missing Permission", code: 100 } }, 400);
        return json({ data: (opts.userBusinesses ?? [BUSINESS]).map((id) => ({ id })) });
      }
      return json({ data: [{ id: BUSINESS }] });
    }
    if (path.endsWith("/me/accounts")) {
      const n = opts.systemPages ?? 1;
      return json({
        data: Array.from({ length: n }, (_, i) => ({
          id: `page_${i}`,
          name: `Page ${i}`,
          access_token: "SYSTEM_PAGE_TOKEN",
          tasks: ["CREATE_CONTENT", "MANAGE"],
          instagram_business_account: { id: `ig_${i}`, username: `ig${i}` },
        })),
      });
    }
    if (path.endsWith("/subscribed_apps")) return json({ success: true });
    return json({});
  });
  return calls;
}

async function callback(t: ReturnType<typeof convexTest>) {
  const { state } = await t.mutation(api.meta.oauth.start, {});
  const res = await t.fetch(`/oauth/callback?state=${state}&code=CODE`);
  return { state, res };
}

describe("authorize url", () => {
  test("asks for identity scopes only, never a business-asset config", async () => {
    const t = convexTest(schema, modules);
    const { url } = await t.mutation(api.meta.oauth.start, {});
    const u = new URL(url);
    // config_id is what triggers the portfolio picker that refuses the app owner's
    // own Page, so it must not be present in system-user mode.
    expect(u.searchParams.get("config_id")).toBeNull();
    expect(u.searchParams.get("scope")).toBe("public_profile,business_management");
  });

  test("falls back to the login configuration when no system token is set", async () => {
    delete process.env.META_SYSTEM_USER_TOKEN;
    process.env.META_LOGIN_CONFIG_ID = "456";
    const t = convexTest(schema, modules);
    const { url } = await t.mutation(api.meta.oauth.start, {});
    expect(new URL(url).searchParams.get("config_id")).toBe("456");
    expect(new URL(url).searchParams.get("scope")).toBeNull();
  });

  test("refuses to start when neither is configured", async () => {
    delete process.env.META_SYSTEM_USER_TOKEN;
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.meta.oauth.start, {})).rejects.toThrow(/META_SYSTEM_USER_TOKEN or META_LOGIN_CONFIG_ID/);
  });
});

describe("membership gate", () => {
  test("a portfolio member gets a session and the Page token lands on the Page", async () => {
    const t = convexTest(schema, modules);
    stubGraph({ userBusinesses: [BUSINESS] });
    const { state, res } = await callback(t);
    expect(res.status).toBe(200);
    expect(await t.query(api.meta.oauth.status, { state })).toMatchObject({ status: "completed" });

    const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
    const status = await t.query(api.profiles.connectionStatus, { sessionToken });
    expect(status.connected).toBe(true);
    expect(status.profiles[0]).toMatchObject({ pageName: "Page 0", status: "active" });
    // The credential is Page-scoped, not person-scoped.
    const profile = await t.run((ctx) => ctx.db.query("profiles").first());
    expect(profile?.pageAccessToken).toBe("SYSTEM_PAGE_TOKEN");
    // And it is never exposed to the client.
    expect(JSON.stringify(status)).not.toMatch(/SYSTEM_PAGE_TOKEN/);
  });

  test("a non-member is refused and no connection is created", async () => {
    const t = convexTest(schema, modules);
    stubGraph({ userBusinesses: [OTHER_BUSINESS] });
    const { state } = await callback(t);
    expect(await t.query(api.meta.oauth.status, { state })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/not a member of this business portfolio/),
    });
    expect(await t.run((ctx) => ctx.db.query("connections").first())).toBeNull();
  });

  test("a missing business_management grant is reported as such, not as 'no Pages'", async () => {
    const t = convexTest(schema, modules);
    stubGraph({ userBusinessesFail: true });
    const { state } = await callback(t);
    expect(await t.query(api.meta.oauth.status, { state })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/must grant business_management/),
    });
  });

  test("explains an empty system user asset list", async () => {
    const t = convexTest(schema, modules);
    stubGraph({ systemPages: 0 });
    const { state } = await callback(t);
    expect(await t.query(api.meta.oauth.status, { state })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/No Pages are assigned to the system user/),
    });
  });
});

describe("page token resolution", () => {
  test("publishing uses the Page's system token even when the manager is disconnected", async () => {
    const t = convexTest(schema, modules);
    stubGraph({ userBusinesses: [BUSINESS] });
    const { state } = await callback(t);
    const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
    const profiles = await t.query(api.profiles.list, { sessionToken });
    const profileId = profiles[0]._id;

    // Every manager goes needs_reconnect; the Page credential is unaffected.
    await t.run(async (ctx) => {
      for (const m of await ctx.db.query("pageMembers").collect()) {
        await ctx.db.patch("pageMembers", m._id, { status: "needs_reconnect" });
      }
    });
    const access = await t.run(async (ctx) => {
      const { pageTokenFor } = await import("./lib/session");
      return await pageTokenFor(ctx, profileId);
    });
    expect(access?.token).toBe("SYSTEM_PAGE_TOKEN");
  });
});
