import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
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

const PUBLISHED_RETENTION_MS = 7 * 24 * 3600 * 1000;
const ORPHAN_TTL_MS = 24 * 3600 * 1000;

/** Cron: drop files Meta no longer needs (published > 7 d ago) and abandoned uploads (> 24 h). */
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orphans = await ctx.db
      .query("media")
      .withIndex("by_status", (q) => q.eq("status", "uploaded").lt("_creationTime", now - ORPHAN_TTL_MS))
      .take(50);
    for (const media of orphans) {
      await ctx.storage.delete(media.storageId);
      await ctx.db.delete("media", media._id);
    }

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "published").lt("_creationTime", now - PUBLISHED_RETENTION_MS))
      .take(25);
    for (const post of posts) {
      if (post.demo) continue; // seeded dev rows keep their thumbnails
      for (const mediaId of post.mediaIds) {
        const media = await ctx.db.get("media", mediaId);
        if (!media || media.status === "deleted") continue;
        await ctx.storage.delete(media.storageId);
        await ctx.db.patch("media", media._id, { status: "deleted" });
      }
    }
    return null;
  },
});
