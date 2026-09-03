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
    const fields = url.searchParams.get("fields");
    if (fields === "permalink_url") body = { permalink_url: "https://www.facebook.com/p1/posts/123" };
    else if (fields === "permalink") body = { permalink: "https://www.instagram.com/p/ABC123/" };
    else if (path.endsWith("/content_publishing_limit")) body = { data: [{ quota_usage: 0, config: { quota_total: 100 } }] };
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

  test("listRange returns only the window, and stays Page-scoped", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const start = Date.now() + 3600_000;
    const inside = await upload(t, sessionToken, profileId);
    const outside = await upload(t, sessionToken, profileId);
    const base = { sessionToken, profileId, caption: "", targets: { facebook: true, instagram: false } };
    const near = await t.mutation(api.posts.create, { ...base, mediaIds: [inside], scheduledAt: start + 60_000 });
    await t.mutation(api.posts.create, { ...base, mediaIds: [outside], scheduledAt: start + 30 * 24 * 3600_000 });

    const window = { sessionToken, profileId, start, end: start + 24 * 3600_000 };
    expect((await t.query(api.posts.listRange, window)).map((p) => p._id)).toEqual([near]);

    const other = await login(t, "b", "p2");
    await expect(t.query(api.posts.listRange, { ...window, sessionToken: other.sessionToken })).rejects.toThrow(/forbidden/);
  });

  test("listActive is upcoming + failures only, oldest first", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const soon = await upload(t, sessionToken, profileId);
    const later = await upload(t, sessionToken, profileId);
    const done = await upload(t, sessionToken, profileId);
    const base = { sessionToken, profileId, caption: "", targets: { facebook: true, instagram: false } };
    const second = await t.mutation(api.posts.create, { ...base, mediaIds: [later], scheduledAt: Date.now() + 7200_000 });
    const first = await t.mutation(api.posts.create, { ...base, mediaIds: [soon], scheduledAt: Date.now() + 3600_000 });
    const publishedId = await t.mutation(api.posts.create, { ...base, mediaIds: [done], scheduledAt: Date.now() + 3600_000 });
    await t.run((ctx) => ctx.db.patch("posts", publishedId, { status: "published" }));

    expect((await t.query(api.posts.listActive, { sessionToken, profileId })).map((p) => p._id)).toEqual([first, second]);

    await t.run((ctx) => ctx.db.patch("posts", second, { status: "failed" }));
    const active = await t.query(api.posts.listActive, { sessionToken, profileId });
    expect(active.map((p) => p.status)).toEqual(["scheduled", "failed"]);
  });

  test("seeded demo posts never reach the publish pool", async () => {
    const t = setup();
    const calls = stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const { posts, media } = await t.action(internal.seed.run, {});
    expect(posts).toBeGreaterThan(0);
    expect(calls).toHaveLength(0); // the seed never talks to Meta

    const seeded = await t.query(api.posts.list, { sessionToken, profileId });
    expect(seeded).toHaveLength(posts);
    expect(seeded.every((p) => p.demo)).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.query("posts").collect()).every((p) => p.workId === undefined))).toBe(true);
    expect(seeded.some((p) => p.scheduledAt < Date.now())).toBe(true);
    expect(seeded.some((p) => p.scheduledAt > Date.now())).toBe(true);

    const broken = seeded.find((p) => p.status === "failed")!;
    await expect(t.mutation(api.posts.retry, { sessionToken, postId: broken._id })).rejects.toThrow(/Demo posts/);

    const cleared = await t.mutation(internal.seed.clear, {});
    expect(cleared).toEqual({ posts, media });
    expect(await t.query(api.posts.list, { sessionToken, profileId })).toEqual([]);
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

  test("records each channel's permalink, and survives a permalink lookup that fails", async () => {
    const t = setup();
    stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, {
      sessionToken,
      profileId,
      caption: "hi",
      mediaIds: [img],
      targets: { facebook: true, instagram: true },
      scheduledAt: Date.now() + 3600_000,
    });
    await t.action(internal.publish.run, { postId });
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({
      facebook: { status: "published", permalink: "https://www.facebook.com/p1/posts/123" },
      instagram: { status: "published", permalink: "https://www.instagram.com/p/ABC123/" },
    });

    // Facebook hands back a site-relative path for a reel; it is stored absolute
    // so the desktop app can pass it to the OS.
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      const body = url.searchParams.get("fields") === "permalink_url" ? { permalink_url: "/reel/123/" } : { id: "vid_1", video_id: "vid_1", upload_url: "u", success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const vid = await upload(t, sessionToken, profileId, "video");
    const reel = await t.mutation(api.posts.create, { sessionToken, profileId, caption: "", mediaIds: [vid], fbAsReel: true, targets: { facebook: true, instagram: false }, scheduledAt: Date.now() + 3600_000 });
    await t.action(internal.publish.run, { postId: reel });
    expect(await t.run((ctx) => ctx.db.get("posts", reel))).toMatchObject({
      facebook: { permalink: "https://www.facebook.com/reel/123/" },
    });
    // Rows stored before that normalization existed are fixed on the way out.
    await t.run((ctx) => ctx.db.patch("posts", reel, { facebook: { status: "published" as const, permalink: "/reel/456/" } }));
    expect(await t.query(api.posts.get, { sessionToken, postId: reel })).toMatchObject({
      facebook: { permalink: "https://www.facebook.com/reel/456/" },
    });

    // A permalink lookup that errors is cosmetic: the post still publishes.
    stubGraph({ fail: /^\/v[\d.]+\/(post|photo|igmedia)_/ });
    const img2 = await upload(t, sessionToken, profileId);
    const second = await t.mutation(api.posts.create, {
      sessionToken,
      profileId,
      caption: "hi",
      mediaIds: [img2],
      targets: { facebook: true, instagram: false },
      scheduledAt: Date.now() + 3600_000,
    });
    await t.action(internal.publish.run, { postId: second });
    const post = await t.query(api.posts.get, { sessionToken, postId: second });
    expect(post).toMatchObject({ facebook: { status: "published" } });
    expect(post?.facebook?.permalink).toBeUndefined();
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

  test("each channel gets its own caption and first comment", async () => {
    const t = setup();
    const calls = stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, {
      sessionToken,
      profileId,
      caption: "fb text",
      igCaption: "ig text",
      fbFirstComment: "fb link",
      igFirstComment: "ig link",
      mediaIds: [img],
      targets: { facebook: true, instagram: true },
      scheduledAt: Date.now() + 3600_000,
    });
    await t.action(internal.publish.run, { postId });

    expect(calls.find((c) => c.url.pathname.endsWith("/p1/photos"))!.url.searchParams.get("caption")).toBe("fb text");
    expect(calls.find((c) => c.url.pathname.endsWith("/ig_p1/media"))!.url.searchParams.get("caption")).toBe("ig text");
    const comments = calls.filter((c) => c.url.pathname.endsWith("/comments"));
    expect(comments.map((c) => c.url.searchParams.get("message"))).toEqual(["fb link", "ig link"]);
    const post = await t.run((ctx) => ctx.db.get("posts", postId));
    expect(post?.facebook?.commentId).toBeDefined();
    expect(post?.instagram?.commentId).toBeDefined();
  });

  test("a failed first comment does not fail the post, and is not retried twice", async () => {
    const t = setup();
    stubGraph({ fail: /\/comments$/ });
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, {
      sessionToken,
      profileId,
      caption: "hi",
      fbFirstComment: "link",
      mediaIds: [img],
      targets: { facebook: true, instagram: false },
      scheduledAt: Date.now() + 3600_000,
    });
    await t.action(internal.publish.run, { postId });
    const post = await t.run((ctx) => ctx.db.get("posts", postId));
    expect(post?.facebook).toMatchObject({ status: "published", commentError: expect.stringMatching(/First comment failed/) });

    // Republishing skips the already-published channel entirely.
    const retryCalls = stubGraph();
    await t.action(internal.publish.run, { postId });
    expect(retryCalls).toHaveLength(0);
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

describe("media cleanup", () => {
  /** Runs the purge that onComplete schedules with runAfter(0). */
  async function settleScheduled(t: ReturnType<typeof convexTest>) {
    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
  }

  /** Drives a post through publish and then the workpool completion hook. */
  async function publishAndSettle(t: ReturnType<typeof convexTest>, postId: Id<"posts">) {
    await t.action(internal.publish.run, { postId });
    await t.mutation(internal.publish.onComplete, {
      workId: "w" as never,
      context: { postId },
      result: { kind: "success", returnValue: null },
    });
    await settleScheduled(t);
  }

  const files = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);

  test("a clean publish deletes every media row and file, cover included", async () => {
    const t = setup();
    stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const vid = await upload(t, sessionToken, profileId, "video");
    const cover = await upload(t, sessionToken, profileId);
    expect(await files(t)).toBe(2);
    const postId = await t.mutation(api.posts.create, {
      sessionToken,
      profileId,
      caption: "hi",
      mediaIds: [vid],
      targets: { facebook: false, instagram: true },
      ig: { collaborators: [], userTags: [], coverMediaId: cover },
      scheduledAt: Date.now() + 3600_000,
    });
    await publishAndSettle(t, postId);

    const post = await t.run((ctx) => ctx.db.get("posts", postId));
    expect(post?.status).toBe("published");
    expect(post?.mediaIds).toEqual([]);
    expect(post?.ig.coverMediaId).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.db.query("media").collect()).length)).toBe(0);
    expect(await files(t)).toBe(0);
    // The post still renders — toSummary tolerates the missing ids.
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({ media: [] });
  });

  test("a failed first comment still purges: the post is live and never re-run", async () => {
    const t = setup();
    stubGraph({ fail: /\/comments$/ });
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, {
      sessionToken, profileId, caption: "hi", mediaIds: [img], fbFirstComment: "link",
      targets: { facebook: true, instagram: false }, scheduledAt: Date.now() + 3600_000,
    });
    await publishAndSettle(t, postId);
    // The comment is an extra on a post that is already live; the files are not
    // needed to fix it, so they go.
    expect(await t.run((ctx) => ctx.db.get("posts", postId))).toMatchObject({
      status: "published",
      mediaIds: [],
      facebook: { commentError: expect.stringMatching(/First comment failed/) },
    });
    expect(await t.run((ctx) => ctx.db.get("media", img))).toBeNull();
  });

  test("a retryable error keeps the media: lastError, partial failure, demo", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const base = { sessionToken, profileId, caption: "hi", targets: { facebook: true, instagram: false }, scheduledAt: Date.now() + 3600_000 };
    stubGraph();

    // A published post carrying a lastError keeps its media.
    const kept = await upload(t, sessionToken, profileId);
    const withError = await t.mutation(api.posts.create, { ...base, mediaIds: [kept] });
    await t.run((ctx) => ctx.db.patch("posts", withError, { status: "published", lastError: "something went wrong" }));
    await t.mutation(internal.media.cleanup, {});
    expect(await t.run((ctx) => ctx.db.get("media", kept))).not.toBeNull();

    // A partially failed post keeps its media so retry still has files to send.
    stubGraph({ fail: /\/media_publish$/ });
    const both = await upload(t, sessionToken, profileId);
    const partial = await t.mutation(api.posts.create, { ...base, mediaIds: [both], targets: { facebook: true, instagram: true } });
    await expect(t.action(internal.publish.run, { postId: partial })).rejects.toThrow(/instagram/);
    await t.mutation(internal.publish.onComplete, {
      workId: "w" as never,
      context: { postId: partial },
      result: { kind: "failed", error: "instagram: boom" },
    });
    await settleScheduled(t);
    expect(await t.run((ctx) => ctx.db.get("posts", partial))).toMatchObject({ status: "partially_failed" });
    expect(await t.run((ctx) => ctx.db.get("media", both))).not.toBeNull();
    await t.mutation(api.posts.retry, { sessionToken, postId: partial });

    // Demo rows keep their thumbnails.
    const demo = await upload(t, sessionToken, profileId);
    const demoPost = await t.mutation(api.posts.create, { ...base, mediaIds: [demo] });
    await t.run((ctx) => ctx.db.patch("posts", demoPost, { status: "published", demo: true }));
    await t.mutation(internal.media.cleanup, {});
    expect(await t.run((ctx) => ctx.db.get("media", demo))).not.toBeNull();
  });

  test("cleanup drains abandoned uploads and old tombstones, then converges", async () => {
    const t = setup();
    stubGraph();
    const { sessionToken, profileId } = await login(t, "a", "p1");
    const abandoned = await upload(t, sessionToken, profileId);
    const tombstoned = await upload(t, sessionToken, profileId);
    // Shape of a row the old 7-day retention left behind: bytes gone, row kept.
    await t.run(async (ctx) => {
      const media = (await ctx.db.get("media", tombstoned))!;
      await ctx.storage.delete(media.storageId);
      await ctx.db.patch("media", tombstoned, { status: "deleted" });
    });
    // A post published before this sweep existed still holds its media.
    const stale = await upload(t, sessionToken, profileId);
    const stalePost = await t.mutation(api.posts.create, {
      sessionToken, profileId, caption: "", mediaIds: [stale], targets: { facebook: true, instagram: false }, scheduledAt: Date.now() + 3600_000,
    });
    await t.run((ctx) => ctx.db.patch("posts", stalePost, { status: "published", facebook: { status: "published" } }));

    // A recent abandoned upload is still within its 24 h grace period.
    await t.mutation(internal.media.cleanup, {});
    expect(await t.run((ctx) => ctx.db.get("media", abandoned))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get("media", tombstoned))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get("media", stale))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get("posts", stalePost))).toMatchObject({ mediaIds: [] });

    vi.setSystemTime(Date.now() + 25 * 3600_000);
    await t.mutation(internal.media.cleanup, {});
    expect(await t.run((ctx) => ctx.db.get("media", abandoned))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("media").collect()).length)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(0);
    vi.useRealTimers();
  });
});
