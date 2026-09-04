/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import workpool from "@convex-dev/workpool/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { slugify } from "./webflow/client";

const modules = import.meta.glob("./**/*.ts");

const COLLECTION = "col_social";
const BLOG = "col_blog";

beforeEach(() => {
  process.env.META_APP_ID = "123";
  process.env.META_LOGIN_CONFIG_ID = "456";
  process.env.META_GRAPH_VERSION = "v26.0";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.WEBFLOW_SITE_TOKEN = "wf_token";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEBFLOW_SITE_TOKEN;
});

function setup() {
  const t = convexTest(schema, modules);
  workpool.register(t, "publishPool");
  return t;
}

async function login(t: ReturnType<typeof convexTest>, metaUserId = "a", pageId = "p1") {
  const { state } = await t.mutation(api.meta.oauth.start, {});
  await t.mutation(internal.meta.oauth.consumeState, { state });
  const connectionId = await t.mutation(internal.meta.oauth.saveConnection, {
    metaUserId,
    metaUserName: metaUserId,
    longLivedUserToken: "U",
    userTokenExpiresAt: 1,
    grantedScopes: [],
    pages: [{ pageId, pageName: pageId, pageAccessToken: `TOK_${metaUserId}`, tasks: ["CREATE_CONTENT", "MANAGE"], webhookSubscribed: true, igUserId: `ig_${pageId}` }],
  });
  await t.mutation(internal.meta.oauth.finishState, { state, status: "completed", connectionId });
  const { sessionToken } = await t.mutation(api.meta.oauth.claimSession, { state });
  const profiles = await t.query(api.profiles.list, { sessionToken });
  return { sessionToken, profileId: profiles[0]._id };
}

async function upload(t: ReturnType<typeof convexTest>, sessionToken: string, profileId: Id<"profiles">) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/jpeg" })));
  const { mediaId } = await t.mutation(api.media.register, { sessionToken, profileId, storageId, kind: "image", mimeType: "image/jpeg", sizeBytes: 1 });
  return mediaId;
}

/** Writes the config row directly — the settings screen's end state. */
async function configure(t: ReturnType<typeof convexTest>, postCopyRequired = false) {
  await t.mutation(internal.webflow.writeConfig, {
    siteId: "site1",
    siteName: "Level Wellness",
    collectionId: COLLECTION,
    collectionName: "Social Posts",
    blogCollectionId: BLOG,
    blogCollectionName: "Blog Posts",
    fields: { name: "name", postCopy: "post-copy", blogRef: "blog-post", link: "page-link" },
    postCopyRequired,
  });
}

/** Fake Webflow Data API. Records every request so call counts can be asserted. */
function stubWebflow(handler: (url: URL, init?: RequestInit) => Response | undefined) {
  const calls: { url: URL; method: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return handler(url, init) ?? new Response(JSON.stringify({}), { status: 200 });
  });
  return calls;
}

function itemsPage(items: { id: string; name: string; lastUpdated: string }[], total = items.length) {
  return new Response(
    JSON.stringify({
      items: items.map((i) => ({ id: i.id, lastUpdated: i.lastUpdated, fieldData: { name: i.name, slug: i.name.toLowerCase() } })),
      pagination: { limit: 100, offset: 0, total },
    }),
    { status: 200 },
  );
}

describe("feature switch", () => {
  test("with no token the feature reports off and posts.create refuses a webflow arg", async () => {
    delete process.env.WEBFLOW_SITE_TOKEN;
    const t = setup();
    const { sessionToken, profileId } = await login(t);
    expect(await t.query(api.webflow.status, { sessionToken })).toMatchObject({ enabled: false, config: null });

    const img = await upload(t, sessionToken, profileId);
    await expect(
      t.mutation(api.posts.create, {
        sessionToken,
        profileId,
        caption: "hi",
        mediaIds: [img],
        targets: { facebook: true, instagram: false },
        webflow: { name: "Item", link: "https://example.com" },
      }),
    ).rejects.toThrow(/not configured/);
  });

  test("enabled but unmapped: status has no config and posts.create still refuses", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t);
    expect(await t.query(api.webflow.status, { sessionToken })).toMatchObject({ enabled: true, config: null });

    const img = await upload(t, sessionToken, profileId);
    await expect(
      t.mutation(api.posts.create, {
        sessionToken,
        profileId,
        caption: "hi",
        mediaIds: [img],
        targets: { facebook: true, instagram: false },
        webflow: { name: "Item", link: "https://example.com" },
      }),
    ).rejects.toThrow(/Finish setting up Webflow/);
  });
});

describe("posts.create validation", () => {
  test("requires a name and either a blog reference or a valid link", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t);
    await configure(t);
    const base = async () => ({
      sessionToken,
      profileId,
      caption: "hi",
      mediaIds: [await upload(t, sessionToken, profileId)],
      targets: { facebook: true, instagram: false },
    });

    await expect(t.mutation(api.posts.create, { ...(await base()), webflow: { name: "  ", link: "https://a.com" } })).rejects.toThrow(/name/);
    await expect(t.mutation(api.posts.create, { ...(await base()), webflow: { name: "Item" } })).rejects.toThrow(/blog post or provide a link/);
    await expect(t.mutation(api.posts.create, { ...(await base()), webflow: { name: "Item", link: "not-a-url" } })).rejects.toThrow(/full http/);

    const postId = await t.mutation(api.posts.create, {
      ...(await base()),
      scheduledAt: Date.now() + 3600_000,
      webflow: { name: "Item", postCopy: " copy ", blogItemId: "blog1", blogItemName: "A post", link: "https://example.com/x" },
    });
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({
      webflow: { name: "Item", postCopy: "copy", blogItemId: "blog1", blogItemName: "A post", status: "pending" },
    });
  });
});

describe("publishing", () => {
  async function publishedPost(t: ReturnType<typeof convexTest>) {
    const { sessionToken, profileId } = await login(t);
    await configure(t);
    const img = await upload(t, sessionToken, profileId);
    const postId = await t.mutation(api.posts.create, {
      sessionToken,
      profileId,
      caption: "hi",
      mediaIds: [img],
      targets: { facebook: true, instagram: false },
      scheduledAt: Date.now() + 3600_000,
      webflow: { name: "My Item", blogItemId: "blog1" },
    });
    // Pretend Facebook already went live and the pool settled the post; only
    // the CMS write is under test from here.
    await t.mutation(internal.publish.recordChannel, {
      postId,
      channel: "facebook",
      patch: { status: "published", publishedAt: Date.now() },
    });
    await t.run((ctx) => ctx.db.patch("posts", postId, { status: "published" }));
    return { sessionToken, postId };
  }

  test("creates a live item with the mapped field slugs and the reference as a bare id", async () => {
    const t = setup();
    const { sessionToken, postId } = await publishedPost(t);
    const calls = stubWebflow((url) =>
      url.pathname.endsWith("/items/live") ? new Response(JSON.stringify({ id: "item_1", fieldData: { slug: "my-item" } }), { status: 200 }) : undefined,
    );

    await t.action(internal.publish.webflowOnly, { postId });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(`/v2/collections/${COLLECTION}/items/live`);
    expect(calls[0].body).toMatchObject({
      isDraft: false,
      fieldData: { name: "My Item", slug: "my-item", "blog-post": "blog1" },
    });
    // Unset optional fields are omitted, never sent as "" — Webflow rejects an
    // empty string for a required field, and "" is wrong for an optional one.
    const sent = (calls[0].body as { fieldData: Record<string, unknown> }).fieldData;
    expect(sent).not.toHaveProperty("page-link");
    expect(sent).not.toHaveProperty("post-copy");
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({
      status: "published",
      webflow: { status: "published", itemId: "item_1", itemSlug: "my-item" },
    });
  });

  test("a Webflow failure never changes the post's own status", async () => {
    const t = setup();
    const { sessionToken, postId } = await publishedPost(t);
    stubWebflow(() => new Response(JSON.stringify({ message: "collection not found", code: "not_found" }), { status: 404 }));

    await t.action(internal.publish.webflowOnly, { postId });

    const post = await t.query(api.posts.get, { sessionToken, postId });
    expect(post).toMatchObject({ status: "published" });
    expect(post?.webflow).toMatchObject({ status: "failed" });
    expect(post?.webflow?.error).toMatch(/collection not found/);
    expect(post?.webflow?.itemId).toBeUndefined();
  });

  test("retries a taken slug once with a suffix", async () => {
    const t = setup();
    const { postId } = await publishedPost(t);
    let attempt = 0;
    const calls = stubWebflow(() => {
      attempt++;
      return attempt === 1
        ? new Response(JSON.stringify({ message: "slug taken" }), { status: 409 })
        : new Response(JSON.stringify({ id: "item_2", fieldData: { slug: "my-item-abcd" } }), { status: 200 });
    });

    await t.action(internal.publish.webflowOnly, { postId });

    expect(calls).toHaveLength(2);
    const second = (calls[1].body as { fieldData: { slug: string } }).fieldData.slug;
    expect(second).toMatch(/^my-item-[0-9a-f]{4}$/);
  });

  test("is a no-op once an item exists, so a retried publish never double-creates", async () => {
    const t = setup();
    const { postId } = await publishedPost(t);
    await t.mutation(internal.publish.recordChannel, { postId, channel: "webflow", patch: { status: "published", itemId: "item_1" } });
    const calls = stubWebflow(() => undefined);

    await t.action(internal.publish.webflowOnly, { postId });

    expect(calls).toHaveLength(0);
  });
});

describe("required Post Copy", () => {
  test("is enforced when the mapped Webflow field is required", async () => {
    const t = setup();
    const { sessionToken, profileId } = await login(t);
    await configure(t, true);
    const img = await upload(t, sessionToken, profileId);
    const base = {
      sessionToken,
      profileId,
      caption: "hi",
      mediaIds: [img],
      targets: { facebook: true, instagram: false },
      scheduledAt: Date.now() + 3600_000,
    };
    await expect(
      t.mutation(api.posts.create, { ...base, webflow: { name: "Item", link: "https://example.com" } }),
    ).rejects.toThrow(/Post Copy is required/);

    const postId = await t.mutation(api.posts.create, {
      ...base,
      webflow: { name: "Item", postCopy: "why this matters", link: "https://example.com" },
    });
    expect(await t.query(api.posts.get, { sessionToken, postId })).toMatchObject({
      webflow: { postCopy: "why this matters" },
    });
  });
});

describe("blog post sync", () => {
  test("first run pages the collection; the next run costs one request and adds nothing", async () => {
    const t = setup();
    const { sessionToken } = await login(t);
    await configure(t);

    let calls = stubWebflow(() =>
      itemsPage([
        { id: "b1", name: "Alpha", lastUpdated: "2026-01-02T00:00:00Z" },
        { id: "b2", name: "Beta", lastUpdated: "2026-01-01T00:00:00Z" },
      ]),
    );
    await t.action(internal.webflow.syncBlogPosts, {});
    expect(calls).toHaveLength(1);
    expect(await t.query(api.webflow.status, { sessionToken })).toMatchObject({ blogCount: 2 });

    // Same items come back; the watermark stops the walk and nothing is inserted.
    calls = stubWebflow(() =>
      itemsPage([
        { id: "b1", name: "Alpha", lastUpdated: "2026-01-02T00:00:00Z" },
        { id: "b2", name: "Beta", lastUpdated: "2026-01-01T00:00:00Z" },
      ]),
    );
    await t.action(internal.webflow.syncBlogPosts, {});
    expect(calls).toHaveLength(1);
    expect(await t.query(api.webflow.status, { sessionToken })).toMatchObject({ blogCount: 2 });

    // A newer item is picked up, and an edited old one updates in place.
    stubWebflow(() =>
      itemsPage([
        { id: "b3", name: "Gamma", lastUpdated: "2026-02-01T00:00:00Z" },
        { id: "b1", name: "Alpha renamed", lastUpdated: "2026-01-30T00:00:00Z" },
      ]),
    );
    await t.action(internal.webflow.syncBlogPosts, {});
    const status = await t.query(api.webflow.status, { sessionToken });
    expect(status).toMatchObject({ blogCount: 3 });
    const names = (await t.query(api.webflow.searchBlogPosts, { sessionToken, q: "" })).map((r) => r.name);
    expect(names).toContain("Alpha renamed");
    expect(names).not.toContain("Alpha");
  });

  test("a sync failure is recorded instead of thrown, so the cron stays green", async () => {
    const t = setup();
    const { sessionToken } = await login(t);
    await configure(t);
    stubWebflow(() => new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }));

    await expect(t.action(internal.webflow.syncBlogPosts, {})).resolves.toBeNull();
    expect(await t.query(api.webflow.status, { sessionToken })).toMatchObject({ blogSyncError: expect.stringMatching(/rate limit/i) });
  });

  test("no-ops without a token or without a config", async () => {
    const t = setup();
    const calls = stubWebflow(() => undefined);
    // Enabled but unmapped.
    await expect(t.action(internal.webflow.syncBlogPosts, {})).resolves.toBeNull();
    // Mapped but the token is gone.
    await configure(t);
    delete process.env.WEBFLOW_SITE_TOKEN;
    await expect(t.action(internal.webflow.syncBlogPosts, {})).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("searchBlogPosts filters on our own mirror without calling Webflow", async () => {
    const t = setup();
    const { sessionToken } = await login(t);
    await configure(t);
    await t.mutation(internal.webflow.upsertBlogPosts, {
      collectionId: BLOG,
      items: [
        { itemId: "b1", name: "Healing After Surgery", slug: "healing", lastUpdated: "2026-01-01T00:00:00Z" },
        { itemId: "b2", name: "Nutrition Basics", slug: "nutrition", lastUpdated: "2026-01-01T00:00:00Z" },
      ],
    });
    const calls = stubWebflow(() => undefined);
    const hits = await t.query(api.webflow.searchBlogPosts, { sessionToken, q: "heal" });
    expect(hits).toEqual([{ itemId: "b1", name: "Healing After Surgery", slug: "healing" }]);
    expect(calls).toHaveLength(0);
  });
});

describe("slugify", () => {
  test("produces url-safe slugs and never an empty one", () => {
    expect(slugify("Healing After Surgery")).toBe("healing-after-surgery");
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("!!!")).toBe("item");
  });
});
