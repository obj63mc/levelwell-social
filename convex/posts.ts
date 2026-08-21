import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { publishPool } from "./lib/pool";
import { requirePageAccess, requireSession, sessionArgs, type Session } from "./lib/session";

export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAG_MAX = 30;
export const IG_MENTION_MAX = 20;
export const IG_COLLABORATOR_MAX = 3;
export const CAROUSEL_MAX = 10;
export const MIN_LEAD_MS = 60 * 1000;

const igOptions = v.object({
  collaborators: v.array(v.string()),
  userTags: v.array(v.object({ username: v.string(), x: v.optional(v.number()), y: v.optional(v.number()) })),
  shareToFeed: v.optional(v.boolean()),
  coverMediaId: v.optional(v.id("media")),
  thumbOffsetMs: v.optional(v.number()),
  altText: v.optional(v.string()),
});

const channelResult = v.object({
  status: v.union(v.literal("pending"), v.literal("published"), v.literal("failed")),
  error: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
});

export const postSummary = v.object({
  _id: v.id("posts"),
  _creationTime: v.number(),
  profileId: v.id("profiles"),
  caption: v.string(),
  targets: v.object({ facebook: v.boolean(), instagram: v.boolean() }),
  igFormat: v.union(v.literal("image"), v.literal("reel"), v.literal("carousel")),
  fbFormat: v.union(v.literal("photo"), v.literal("multi_photo"), v.literal("video"), v.literal("reel")),
  ig: igOptions,
  scheduledAt: v.number(),
  status: v.union(
    v.literal("scheduled"),
    v.literal("publishing"),
    v.literal("published"),
    v.literal("partially_failed"),
    v.literal("failed"),
    v.literal("canceled"),
  ),
  facebook: v.optional(channelResult),
  instagram: v.optional(channelResult),
  lastError: v.optional(v.string()),
  media: v.array(v.object({ _id: v.id("media"), kind: v.union(v.literal("image"), v.literal("video")), url: v.union(v.string(), v.null()) })),
});

async function toSummary(ctx: QueryCtx | MutationCtx, post: Doc<"posts">) {
  const media = [];
  for (const mediaId of post.mediaIds) {
    const m = await ctx.db.get("media", mediaId);
    if (!m) continue;
    media.push({ _id: m._id, kind: m.kind, url: m.status === "deleted" ? null : await ctx.storage.getUrl(m.storageId) });
  }
  const channel = (c?: Doc<"posts">["facebook"]) => (c ? { status: c.status, error: c.error, publishedAt: c.publishedAt } : undefined);
  return {
    _id: post._id,
    _creationTime: post._creationTime,
    profileId: post.profileId,
    caption: post.caption,
    targets: post.targets,
    igFormat: post.igFormat,
    fbFormat: post.fbFormat,
    ig: post.ig,
    scheduledAt: post.scheduledAt,
    status: post.status,
    facebook: channel(post.facebook),
    instagram: channel(post.instagram),
    lastError: post.lastError,
    media,
  };
}

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

async function loadPost(ctx: QueryCtx | MutationCtx, session: Session, postId: Id<"posts">) {
  const post = await ctx.db.get("posts", postId);
  if (!post) throw new ConvexError("Post not found.");
  await requirePageAccess(ctx, session, post.profileId);
  return post;
}

async function enqueue(ctx: MutationCtx, post: Doc<"posts">, runAt: number) {
  const workId = await publishPool.enqueueAction(
    ctx,
    internal.publish.run,
    { postId: post._id },
    { runAt, onComplete: internal.publish.onComplete, context: { postId: post._id } },
  );
  await ctx.db.patch("posts", post._id, { workId, status: "scheduled", scheduledAt: runAt, lastError: undefined });
}

/** Creates a post and queues it: now, or at `scheduledAt`. */
export const create = mutation({
  args: {
    ...sessionArgs,
    profileId: v.id("profiles"),
    caption: v.string(),
    mediaIds: v.array(v.id("media")),
    targets: v.object({ facebook: v.boolean(), instagram: v.boolean() }),
    ig: v.optional(igOptions),
    fbAsReel: v.optional(v.boolean()),
    scheduledAt: v.optional(v.number()),
  },
  returns: v.id("posts"),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const { profile } = await requirePageAccess(ctx, session, args.profileId);
    const now = Date.now();

    if (!args.targets.facebook && !args.targets.instagram) throw new ConvexError("Pick at least one channel.");
    if (args.targets.instagram && !profile.igUserId) throw new ConvexError("This Page has no linked Instagram account.");
    if (args.mediaIds.length === 0) throw new ConvexError("Add a photo or video.");
    if (args.mediaIds.length > CAROUSEL_MAX) throw new ConvexError(`At most ${CAROUSEL_MAX} items per post.`);
    if (args.scheduledAt !== undefined && args.scheduledAt < now + MIN_LEAD_MS) {
      throw new ConvexError("Schedule at least a minute from now, or post now.");
    }
    const caption = args.caption.trim();
    if (args.targets.instagram) {
      if (caption.length > IG_CAPTION_MAX) throw new ConvexError(`Instagram captions are limited to ${IG_CAPTION_MAX} characters.`);
      if (countMatches(caption, /#\w/g) > IG_HASHTAG_MAX) throw new ConvexError(`Instagram allows at most ${IG_HASHTAG_MAX} hashtags.`);
      if (countMatches(caption, /@\w/g) > IG_MENTION_MAX) throw new ConvexError(`Instagram allows at most ${IG_MENTION_MAX} @mentions.`);
    }

    const media: Doc<"media">[] = [];
    for (const mediaId of args.mediaIds) {
      const m = await ctx.db.get("media", mediaId);
      if (!m || m.profileId !== args.profileId) throw new ConvexError("Unknown media.");
      if (m.status !== "uploaded") throw new ConvexError("A file is already attached to another post.");
      media.push(m);
    }
    const videos = media.filter((m) => m.kind === "video").length;
    const igFormat = media.length > 1 ? "carousel" : videos === 1 ? "reel" : "image";
    const fbFormat = media.length > 1 ? (videos > 0 ? "video" : "multi_photo") : videos === 1 ? (args.fbAsReel ? "reel" : "video") : "photo";
    if (args.targets.facebook && media.length > 1 && videos > 0) {
      throw new ConvexError("Facebook multi-item posts can only contain photos. Post the video separately.");
    }

    const ig = {
      collaborators: [...new Set((args.ig?.collaborators ?? []).map(normalizeUsername).filter(Boolean))],
      userTags: (args.ig?.userTags ?? [])
        .map((t) => ({ ...t, username: normalizeUsername(t.username) }))
        .filter((t) => t.username),
      shareToFeed: args.ig?.shareToFeed,
      coverMediaId: args.ig?.coverMediaId,
      thumbOffsetMs: args.ig?.thumbOffsetMs,
      altText: args.ig?.altText?.trim() || undefined,
    };
    if (ig.collaborators.length > IG_COLLABORATOR_MAX) throw new ConvexError(`At most ${IG_COLLABORATOR_MAX} collaborators.`);
    if (ig.coverMediaId) {
      const cover = await ctx.db.get("media", ig.coverMediaId);
      if (!cover || cover.profileId !== args.profileId || cover.kind !== "image") throw new ConvexError("Cover must be an image on this Page.");
    }

    for (const m of media) await ctx.db.patch("media", m._id, { status: "attached" });
    const runAt = args.scheduledAt ?? now;
    const postId = await ctx.db.insert("posts", {
      profileId: args.profileId,
      createdByConnectionId: session.connection._id,
      caption,
      mediaIds: args.mediaIds,
      targets: args.targets,
      igFormat,
      fbFormat,
      ig,
      scheduledAt: runAt,
      status: "scheduled",
      facebook: args.targets.facebook ? { status: "pending" } : undefined,
      instagram: args.targets.instagram ? { status: "pending" } : undefined,
    });
    const post = await ctx.db.get("posts", postId);
    await enqueue(ctx, post!, runAt);
    return postId;
  },
});

export const cancel = mutation({
  args: { ...sessionArgs, postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const post = await loadPost(ctx, session, args.postId);
    if (post.status !== "scheduled") throw new ConvexError("Only scheduled posts can be canceled.");
    if (post.workId) await publishPool.cancel(ctx, post.workId as Parameters<typeof publishPool.cancel>[1]);
    await ctx.db.patch("posts", post._id, { status: "canceled", workId: undefined });
    for (const mediaId of post.mediaIds) {
      const m = await ctx.db.get("media", mediaId);
      if (m && m.status === "attached") await ctx.db.patch("media", m._id, { status: "uploaded" });
    }
    return null;
  },
});

export const reschedule = mutation({
  args: { ...sessionArgs, postId: v.id("posts"), scheduledAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const post = await loadPost(ctx, session, args.postId);
    if (post.status !== "scheduled") throw new ConvexError("Only scheduled posts can be rescheduled.");
    if (args.scheduledAt < Date.now() + MIN_LEAD_MS) throw new ConvexError("Schedule at least a minute from now.");
    if (post.workId) await publishPool.cancel(ctx, post.workId as Parameters<typeof publishPool.cancel>[1]);
    await enqueue(ctx, post, args.scheduledAt);
    return null;
  },
});

/** Re-runs a failed post now. Channels that already published are skipped. */
export const retry = mutation({
  args: { ...sessionArgs, postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const post = await loadPost(ctx, session, args.postId);
    if (post.status !== "failed" && post.status !== "partially_failed") throw new ConvexError("Only failed posts can be retried.");
    await enqueue(ctx, post, Date.now());
    return null;
  },
});

export const list = query({
  args: { ...sessionArgs, profileId: v.id("profiles") },
  returns: v.array(postSummary),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    await requirePageAccess(ctx, session, args.profileId);
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_profileId_and_scheduledAt", (q) => q.eq("profileId", args.profileId))
      .order("desc")
      .take(100);
    const out = [];
    for (const post of posts) out.push(await toSummary(ctx, post));
    return out;
  },
});

export const get = query({
  args: { ...sessionArgs, postId: v.id("posts") },
  returns: v.union(postSummary, v.null()),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const post = await loadPost(ctx, session, args.postId);
    return await toSummary(ctx, post);
  },
});
