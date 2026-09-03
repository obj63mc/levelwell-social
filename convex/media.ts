import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { requirePageAccess, requireSession, sessionArgs } from "./lib/session";

export const IMAGE_TYPES = ["image/jpeg"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export const mediaKind = v.union(v.literal("image"), v.literal("video"));

/** Step 1 of an upload: a short-lived URL the desktop POSTs the file bytes to. */
export const generateUploadUrl = mutation({
  args: { ...sessionArgs, profileId: v.id("profiles") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    await requirePageAccess(ctx, session, args.profileId);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2: record the uploaded file against the Page. */
export const register = mutation({
  args: {
    ...sessionArgs,
    profileId: v.id("profiles"),
    storageId: v.id("_storage"),
    kind: mediaKind,
    mimeType: v.string(),
    sizeBytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  returns: v.object({ mediaId: v.id("media"), url: v.string() }),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    await requirePageAccess(ctx, session, args.profileId);
    const { sessionToken: _token, ...fields } = args;
    if (fields.kind === "image") {
      if (!IMAGE_TYPES.includes(fields.mimeType)) throw new ConvexError("Images must be JPEG (Instagram requirement).");
      if (fields.sizeBytes > MAX_IMAGE_BYTES) throw new ConvexError("Images must be 8 MB or smaller.");
    } else {
      if (!VIDEO_TYPES.includes(fields.mimeType)) throw new ConvexError("Videos must be MP4 or MOV.");
      if (fields.sizeBytes > MAX_VIDEO_BYTES) throw new ConvexError("Videos must be 300 MB or smaller.");
    }
    const mediaId = await ctx.db.insert("media", { ...fields, uploadedByConnectionId: session.connection._id, status: "uploaded" });
    const url = await ctx.storage.getUrl(fields.storageId);
    if (!url) throw new ConvexError("Upload not found. Try again.");
    return { mediaId, url };
  },
});

/** Removes an asset that isn't attached to a post yet. */
export const remove = mutation({
  args: { ...sessionArgs, mediaId: v.id("media") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const media = await ctx.db.get("media", args.mediaId);
    if (!media) return null;
    await requirePageAccess(ctx, session, media.profileId);
    if (media.status !== "uploaded") throw new ConvexError("This file is attached to a post.");
    await ctx.storage.delete(media.storageId);
    await ctx.db.delete("media", media._id);
    return null;
  },
});

const ORPHAN_TTL_MS = 24 * 3600 * 1000;
const PURGE_POSTS_PER_RUN = 25;
const PURGE_MEDIA_PER_RUN = 50;

/**
 * We hold a post's files only while the post itself might still be republished.
 * Once every targeted channel is live, Meta has the bytes and ours are dead
 * weight. A failed first comment deliberately does *not* count: the comment is
 * an extra on top of a post that is already live and is never re-run, so
 * holding its media would keep it forever. Channel errors and `lastError` do
 * count — those are the posts `posts.retry` still needs files for.
 */
export function isFullyPublished(post: Doc<"posts">): boolean {
  if (post.status !== "published" || post.demo || post.lastError) return false;
  for (const channel of [post.facebook, post.instagram]) {
    if (!channel) continue;
    if (channel.status !== "published" || channel.error) return false;
  }
  return true;
}

/** Deletes every asset a published post owns — bytes and row — and unlinks them. */
async function purge(ctx: MutationCtx, post: Doc<"posts">) {
  const ids = new Set<Id<"media">>(post.mediaIds);
  if (post.ig.coverMediaId) ids.add(post.ig.coverMediaId);
  for (const id of ids) {
    const media = await ctx.db.get("media", id);
    if (!media) continue;
    // A tombstone from the old retention sweep has no bytes left to delete.
    if (media.status !== "deleted") await ctx.storage.delete(media.storageId);
    await ctx.db.delete("media", media._id);
  }
  await ctx.db.patch("posts", post._id, { mediaIds: [], ig: { ...post.ig, coverMediaId: undefined } });
}

/** Scheduled the moment a post publishes cleanly: Meta has the bytes, we don't need them. */
export const purgePost = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.postId);
    // Re-checked here, not just at the call site: a retry or a late-written
    // commentError between scheduling and running must still hold the files.
    if (post && isFullyPublished(post)) await purge(ctx, post);
    return null;
  },
});

/** Read-only: what a `cleanup` run would reclaim. Safe to run against prod. */
export const purgePreview = internalQuery({
  args: {},
  returns: v.object({
    postsToPurge: v.number(),
    mediaFromPosts: v.number(),
    bytesFromPosts: v.number(),
    postsHeldBack: v.number(),
    abandonedUploads: v.number(),
    tombstones: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const out = { postsToPurge: 0, mediaFromPosts: 0, bytesFromPosts: 0, postsHeldBack: 0, abandonedUploads: 0, tombstones: 0 };
    for (const post of await ctx.db.query("posts").withIndex("by_status", (q) => q.eq("status", "published")).collect()) {
      const ids = new Set<Id<"media">>(post.mediaIds);
      if (post.ig.coverMediaId) ids.add(post.ig.coverMediaId);
      if (ids.size === 0) continue;
      if (!isFullyPublished(post)) {
        out.postsHeldBack++;
        continue;
      }
      out.postsToPurge++;
      for (const id of ids) {
        const media = await ctx.db.get("media", id);
        if (!media) continue;
        out.mediaFromPosts++;
        if (media.status !== "deleted") out.bytesFromPosts += media.sizeBytes;
      }
    }
    for (const media of await ctx.db.query("media").withIndex("by_status", (q) => q.eq("status", "uploaded")).collect()) {
      if (media._creationTime < now - ORPHAN_TTL_MS) out.abandonedUploads++;
    }
    out.tombstones = (await ctx.db.query("media").withIndex("by_status", (q) => q.eq("status", "deleted")).collect()).length;
    return out;
  },
});

/**
 * Cron: the backstop behind `purgePost`. Drains posts published before this
 * sweep existed (or whose purge never ran), abandoned uploads, and the
 * tombstone rows the old 7-day retention left behind.
 */
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orphans = await ctx.db
      .query("media")
      .withIndex("by_status", (q) => q.eq("status", "uploaded").lt("_creationTime", now - ORPHAN_TTL_MS))
      .take(PURGE_MEDIA_PER_RUN);
    for (const media of orphans) {
      await ctx.storage.delete(media.storageId);
      await ctx.db.delete("media", media._id);
    }

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .take(PURGE_POSTS_PER_RUN);
    for (const post of posts) {
      if (post.mediaIds.length === 0 && !post.ig.coverMediaId) continue; // already purged
      if (isFullyPublished(post)) await purge(ctx, post);
    }

    // Bytes are already gone on these; only the row is left to reclaim.
    const tombstones = await ctx.db
      .query("media")
      .withIndex("by_status", (q) => q.eq("status", "deleted"))
      .take(PURGE_MEDIA_PER_RUN);
    for (const media of tombstones) await ctx.db.delete("media", media._id);
    return null;
  },
});
