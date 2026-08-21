/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { requirePageAccess, requireSession } from "./lib/session";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_LOGIN_CONFIG_ID = "456";
  process.env.META_GRAPH_VERSION = "v26.0";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});

function page(pageId: string, token: string) {
  return { pageId, pageName: `Page ${pageId}`, pageAccessToken: token, tasks: ["MANAGE"], webhookSubscribed: true };
}

/** Runs the whole login handoff for one Meta user and returns their session token. */
async function login(t: ReturnType<typeof convexTest>, metaUserId: string, pages: ReturnType<typeof page>[]) {
  const { state } = await t.mutation(api.meta.oauth.start, {});
  await t.mutation(internal.meta.oauth.consumeState, { state });
  const connectionId = await t.mutation(internal.meta.oauth.saveConnection, {
    metaUserId,
    metaUserName: `User ${metaUserId}`,
    longLivedUserToken: `USER_${metaUserId}`,
    userTokenExpiresAt: 1,
    grantedScopes: [],
    pages,
  });
  await t.mutation(internal.meta.oauth.finishState, { state, status: "completed", connectionId });
  const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
  return { sessionToken, connectionId, state };
}

describe("sessions", () => {
  test("claimSession is single-use and requires a completed state", async () => {
    const t = convexTest(schema, modules);
    const { state: pending } = await t.mutation(api.meta.oauth.start, {});
    await expect(t.mutation(api.meta.oauth.claimSession, { state: pending })).rejects.toThrow(/not completed/);
    const { state } = await login(t, "a", [page("p1", "TOK_A")]);
    await expect(t.mutation(api.meta.oauth.claimSession, { state })).rejects.toThrow(/already claimed/);
  });

  test("tokens are stored hashed and signOut revokes only that session", async () => {
    const t = convexTest(schema, modules);
    const { sessionToken } = await login(t, "a", [page("p1", "TOK_A")]);
    const rows = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(sessionToken);
    await t.mutation(api.meta.oauth.signOut, { sessionToken });
    expect(await t.query(api.profiles.connectionStatus, { sessionToken })).toEqual({ connected: false, profiles: [] });
    await expect(t.mutation(api.meta.oauth.signOut, { sessionToken })).rejects.toThrow();
    // The Meta grant survives a sign-out.
    expect(await t.run((ctx) => ctx.db.query("connections").collect())).toHaveLength(1);
  });
});

describe("shared Pages", () => {
  test("two managers of one Page share a single profile with their own tokens", async () => {
    const t = convexTest(schema, modules);
    const a = await login(t, "a", [page("p1", "TOK_A")]);
    const b = await login(t, "b", [page("p1", "TOK_B"), page("p2", "TOK_B2")]);
    const c = await login(t, "c", [page("p9", "TOK_C")]);

    const profiles = await t.run((ctx) => ctx.db.query("profiles").collect());
    expect(profiles.map((p) => p.pageId).sort()).toEqual(["p1", "p2", "p9"]);
    const p1 = profiles.find((p) => p.pageId === "p1")!;
    const members = await t.run((ctx) =>
      ctx.db.query("pageMembers").withIndex("by_profileId", (q) => q.eq("profileId", p1._id)).collect(),
    );
    expect(members.map((m) => m.pageAccessToken).sort()).toEqual(["TOK_A", "TOK_B"]);

    const statusA = await t.query(api.profiles.connectionStatus, { sessionToken: a.sessionToken });
    const statusB = await t.query(api.profiles.connectionStatus, { sessionToken: b.sessionToken });
    expect(statusA.profiles.map((p) => p.pageId)).toEqual(["p1"]);
    expect(statusB.profiles.map((p) => p.pageId).sort()).toEqual(["p1", "p2"]);

    await t.run(async (ctx) => {
      const sessionB = await requireSession(ctx, b.sessionToken);
      const access = await requirePageAccess(ctx, sessionB, p1._id);
      expect(access.member.pageAccessToken).toBe("TOK_B");
      const sessionC = await requireSession(ctx, c.sessionToken);
      await expect(requirePageAccess(ctx, sessionC, p1._id)).rejects.toThrow(/forbidden/);
    });

    // Disconnecting A leaves the Page and B's membership intact.
    await t.mutation(api.meta.oauth.disconnect, { sessionToken: a.sessionToken });
    expect(await t.query(api.profiles.connectionStatus, { sessionToken: a.sessionToken })).toMatchObject({ connected: false });
    const remaining = await t.run((ctx) =>
      ctx.db.query("pageMembers").withIndex("by_profileId", (q) => q.eq("profileId", p1._id)).collect(),
    );
    expect(remaining.map((m) => m.pageAccessToken)).toEqual(["TOK_B"]);
    expect(await t.run((ctx) => ctx.db.query("profiles").collect())).toHaveLength(3);
  });

  test("re-login without a Page marks only that membership needs_reconnect", async () => {
    const t = convexTest(schema, modules);
    await login(t, "a", [page("p1", "TOK_A"), page("p2", "TOK_A")]);
    const again = await login(t, "a", [page("p1", "TOK_A_NEW")]);
    expect(await t.run((ctx) => ctx.db.query("connections").collect())).toHaveLength(1);
    const status = await t.query(api.profiles.connectionStatus, { sessionToken: again.sessionToken });
    expect(status.profiles.map((p) => [p.pageId, p.status]).sort()).toEqual([
      ["p1", "active"],
      ["p2", "needs_reconnect"],
    ]);
  });
});
