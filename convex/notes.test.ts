/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_LOGIN_CONFIG_ID = "456";
  process.env.META_GRAPH_VERSION = "v26.0";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});

async function login(t: ReturnType<typeof convexTest>, metaUserId: string, pageId: string) {
  const { state } = await t.mutation(api.meta.oauth.start, {});
  await t.mutation(internal.meta.oauth.consumeState, { state });
  const connectionId = await t.mutation(internal.meta.oauth.saveConnection, {
    metaUserId,
    metaUserName: metaUserId,
    longLivedUserToken: "U",
    userTokenExpiresAt: 1,
    grantedScopes: [],
    pages: [{ pageId, pageName: pageId, pageAccessToken: `TOK_${metaUserId}`, tasks: [], webhookSubscribed: true }],
  });
  await t.mutation(internal.meta.oauth.finishState, { state, status: "completed", connectionId });
  const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
  const profiles = await t.query(api.profiles.list, { sessionToken });
  return { sessionToken, profileId: profiles[0]._id };
}

describe("notes", () => {
  test("create, list by day range, update, remove", async () => {
    const t = convexTest(schema, modules);
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const range = { sessionToken, profileId, start: "2026-10-01", end: "2026-11-01" };

    const first = await t.mutation(api.notes.create, { sessionToken, profileId, date: "2026-10-18", body: "  Launch week  " });
    const second = await t.mutation(api.notes.create, { sessionToken, profileId, date: "2026-10-18", body: "Second idea" });
    await t.mutation(api.notes.create, { sessionToken, profileId, date: "2026-11-01", body: "Next month" });

    const october = await t.query(api.notes.listRange, range);
    expect(october.map((n) => n.body).sort()).toEqual(["Launch week", "Second idea"]);

    await t.mutation(api.notes.update, { sessionToken, noteId: first, body: "Launch week, final" });
    await t.mutation(api.notes.remove, { sessionToken, noteId: second });
    expect(await t.query(api.notes.listRange, range)).toEqual([{ _id: first, date: "2026-10-18", body: "Launch week, final" }]);
  });

  test("rejects empty bodies, malformed dates and other Pages' managers", async () => {
    const t = convexTest(schema, modules);
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const other = await login(t, "b", "p2");

    await expect(t.mutation(api.notes.create, { sessionToken, profileId, date: "2026-10-18", body: "   " })).rejects.toThrow(/empty/);
    await expect(t.mutation(api.notes.create, { sessionToken, profileId, date: "2026-10-8", body: "x" })).rejects.toThrow(/YYYY-MM-DD/);

    const noteId = await t.mutation(api.notes.create, { sessionToken, profileId, date: "2026-10-18", body: "mine" });
    await expect(t.mutation(api.notes.update, { sessionToken: other.sessionToken, noteId, body: "theirs" })).rejects.toThrow(/forbidden/);
    await expect(t.mutation(api.notes.remove, { sessionToken: other.sessionToken, noteId })).rejects.toThrow(/forbidden/);
    await expect(
      t.query(api.notes.listRange, { sessionToken: other.sessionToken, profileId, start: "2026-10-01", end: "2026-11-01" }),
    ).rejects.toThrow(/forbidden/);
  });
});
