/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import workpool from "@convex-dev/workpool/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_LOGIN_CONFIG_ID = "456";
  process.env.META_GRAPH_VERSION = "v26.0";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const t = convexTest(schema, modules);
  workpool.register(t, "publishPool");
  return t;
}

async function login(t: ReturnType<typeof convexTest>, metaUserId: string, pageId: string, ig = true) {
  const { state } = await t.mutation(api.meta.oauth.start, {});
  await t.mutation(internal.meta.oauth.consumeState, { state });
  const connectionId = await t.mutation(internal.meta.oauth.saveConnection, {
    metaUserId,
    metaUserName: metaUserId,
    longLivedUserToken: "U",
    userTokenExpiresAt: 1,
    grantedScopes: [],
    pages: [{ pageId, pageName: pageId, pageAccessToken: `TOK_${metaUserId}`, tasks: [], webhookSubscribed: true, igUserId: ig ? `ig_${pageId}` : undefined }],
  });
  await t.mutation(internal.meta.oauth.finishState, { state, status: "completed", connectionId });
  const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
  const profiles = await t.query(api.profiles.list, { sessionToken });
  return { sessionToken, profileId: profiles[0]._id };
}

async function upload(t: ReturnType<typeof convexTest>, sessionToken: string, profileId: Id<"profiles">, kind: "image" | "video" = "image", mimeType = kind === "image" ? "image/jpeg" : "video/mp4") {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: mimeType })));
  const { mediaId } = await t.mutation(api.media.register, { sessionToken, profileId, storageId, kind, mimeType, sizeBytes: 1 });
  return mediaId;
}

/** Fake Graph API: records calls, answers by path, optional per-path failures. */
function stubGraph(opts: { fail?: RegExp } = {}) {
  const calls: { url: URL; method: string }[] = [];
  let n = 0;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? "GET" });
    const path = url.pathname;
    if (opts.fail?.test(path)) {
      return new Response(JSON.stringify({ error: { message: "boom", code: 1 } }), { status: 400 });
    }
    let body: unknown = { id: `id_${++n}` };
    if (path.endsWith("/content_publishing_limit")) body = { data: [{ quota_usage: 0, config: { quota_total: 100 } }] };
    else if (path.endsWith("/photos")) body = { id: `photo_${++n}`, post_id: `post_${n}` };
    else if (/\/(ig_[^/]+|id_\d+|child_\d+)$/.test(path) && url.searchParams.get("fields")?.includes("status_code")) {
      body = { status_code: "FINISHED" };
    } else if (path.endsWith("/media_publish")) body = { id: `igmedia_${++n}` };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

describe("posts.create", () => {
  test("validates channels, media and schedule; derives formats; attaches media", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const base = { sessionToken, profileId, caption: "hi", mediaIds: [img], targets: { facebook: true, instagram: true } };

    await expect(t.mutation(api.posts.create, { ...base, targets: { facebook: false, instagram: false } })).rejects.toThrow(/at least one channel/);
    await expect(t.mutation(api.posts.create, { ...base, mediaIds: [] })).rejects.toThrow(/Add a photo/);
    await expect(t.mutation(api.posts.create, { ...base, scheduledAt: Date.now() - 1 })).rejects.toThrow(/at least a minute/);
    await expect(t.mutation(api.posts.create, { ...base, caption: "#a ".repeat(31) })).rejects.toThrow(/30 hashtags/);

    const postId = await t.mutation(api.posts.create, { ...base, scheduledAt: Date.now() + 3600_000 });
    const post = (await t.query(api.posts.list, { sessionToken, profileId }))[0];
    expect(post._id).toBe(postId);
    expect(post).toMatchObject({ status: "scheduled", igFormat: "image", fbFormat: "photo" });
    expect(await t.run((ctx) => ctx.db.get("media", img))).toMatchObject({ status: "attached" });
    await expect(t.mutation(api.posts.create, base)).rejects.toThrow(/already attached/);

    const vid = await upload(t, sessionToken, profileId, "video");
    const reel = await t.mutation(api.posts.create, { ...base, mediaIds: [vid], fbAsReel: true, scheduledAt: Date.now() + 3600_000 });
    expect(await t.query(api.posts.get, { sessionToken, postId: reel })).toMatchObject({ igFormat: "reel", fbFormat: "reel" });
  });

  test("rejects PNG images and Instagram on a Page without IG; other Pages can't see posts", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t, "a", "p1", false);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await expect(
      t.mutation(api.media.register, { sessionToken, profileId, storageId, kind: "image", mimeType: "image/png", sizeBytes: 1 }),
    ).rejects.toThrow(/JPEG/);
    const img = await upload(t, sessionToken, profileId);
    await expect(
      t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [img], targets: { facebook: false, instagram: true } }),
    ).rejects.toThrow(/no linked Instagram/);
    const postId = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [img], targets: { facebook: true, instagram: false }, scheduledAt: Date.now() + 3600_000 });

    const other = await login(t, "b", "p2");
    expect(await t.query(api.posts.list, { sessionToken: other.sessionToken, profileId: other.profileId })).toEqual([]);
    await expect(t.query(api.posts.get, { sessionToken: other.sessionToken, postId })).rejects.toThrow(/forbidden/);
    await expect(t.mutation(api.posts.cancel, { sessionToken: other.sessionToken, postId })).rejects.toThrow(/forbidden/);
  });

  test("cancel releases media; reschedule moves the time", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const later = Date.now() + 3600_000;
    const postId = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [img], targets: { facebook: true, instagram: false }, scheduledAt: later });
    await t.mutation(api.posts.reschedule, { sessionToken, postId, scheduledAt: later + 60_000 });
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({ status: "scheduled", scheduledAt: later + 60_000 });
    await t.mutation(api.posts.cancel, { sessionToken, postId });
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({ status: "canceled" });
    expect(await t.run((ctx) => ctx.db.get("media", img))).toMatchObject({ status: "uploaded" });
    await expect(t.mutation(api.posts.retry, { sessionToken, postId })).rejects.toThrow(/Only failed/);
  });
});

describe("publish.run", () => {
  test("publishes an image to both channels and records ids", async () => {
    const t = setup();
    const calls = stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "cap", mediaIds: [img], targets: { facebook: true, instagram: true }, ig: { collaborators: ["@Friend"], userTags: [{ username: "tagged" }] }, scheduledAt: Date.now() + 3600_000 });
    await t.action(internal.publish.run, { postId });
    const post = await t.run((ctx) => ctx.db.get("posts", postId));
    expect(post?.facebook).toMatchObject({ status: "published", postId: expect.stringMatching(/^post_/) });
    expect(post?.instagram).toMatchObject({ status: "published", creationId: expect.stringMatching(/^id_/), mediaId: expect.stringMatching(/^igmedia_/) });
    const igCreate = calls.find((c) => c.url.pathname.endsWith("/ig_p1/media"))!;
    expect(igCreate.url.searchParams.get("collaborators")).toBe('["friend"]');
    expect(JSON.parse(igCreate.url.searchParams.get("user_tags")!)).toEqual([{ username: "tagged", x: 0.5, y: 0.5 }]);
    expect(igCreate.url.searchParams.get("access_token")).toBe("TOK_a");
  });

  test("a failed channel is retried without re-posting the successful one", async () => {
    const t = setup();
    stubGraph({ fail: /\/media_publish$/ });
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [img], targets: { facebook: true, instagram: true }, scheduledAt: Date.now() + 3600_000 });
    await expect(t.action(internal.publish.run, { postId })).rejects.toThrow(/instagram: boom/);
    let post = await t.run((ctx) => ctx.db.get("posts", postId));
    expect(post?.facebook?.status).toBe("published");
    expect(post?.instagram).toMatchObject({ status: "failed", creationId: expect.stringMatching(/^id_/) });

    const retryCalls = stubGraph();
    await t.action(internal.publish.run, { postId });
    post = await t.run((ctx) => ctx.db.get("posts", postId));
    expect(post?.instagram?.status).toBe("published");
    expect(retryCalls.some((c) => c.url.pathname.endsWith("/photos"))).toBe(false); // Facebook not re-posted
    expect(retryCalls.some((c) => c.url.pathname.endsWith("/ig_p1/media"))).toBe(false); // container reused
  });

  test("carousel creates children then the parent; token error flags the member", async () => {
    const t = setup();
    const calls = stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const a = await upload(t, sessionToken, profileId);
    const b = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [a, b], targets: { facebook: true, instagram: true }, scheduledAt: Date.now() + 3600_000 });
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({ igFormat: "carousel", fbFormat: "multi_photo" });
    await t.action(internal.publish.run, { postId });
    const igCreates = calls.filter((c) => c.url.pathname.endsWith("/ig_p1/media"));
    expect(igCreates.map((c) => c.url.searchParams.get("is_carousel_item"))).toEqual(["true", "true", null]);
    expect(igCreates[2].url.searchParams.get("children")).toMatch(/^id_\d+,id_\d+$/);
    const feed = calls.find((c) => c.url.pathname.endsWith("/p1/feed"))!;
    expect(JSON.parse(feed.url.searchParams.get("attached_media")!)).toHaveLength(2);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), { status: 400 }));
    const c = await upload(t, sessionToken, profileId);
    const p2 = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [c], targets: { facebook: true, instagram: false }, scheduledAt: Date.now() + 3600_000 });
    await expect(t.action(internal.publish.run, { postId: p2 })).rejects.toThrow(/code 190/);
    expect((await t.query(api.profiles.list, { sessionToken }))[0].status).toBe("needs_reconnect");
  });
});
