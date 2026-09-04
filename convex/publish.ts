import { v } from "convex/values";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { pageTokenFor } from "./lib/session";
import { isFullyPublished } from "./media";
import { describeError, GraphApiError, graphGet, graphPost, graphVersion } from "./meta/client";
import { describeWebflowError, webflowEnabled } from "./webflow/client";

// ---------- state transitions (mutations) ----------

const channel = v.union(v.literal("facebook"), v.literal("instagram"));

/** Moves a queued post to `publishing` and hands the action everything it needs. */
export const begin = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.union(
    v.null(),
    v.object({
      post: v.any(),
      profile: v.any(),
      token: v.string(),
      tokenConnectionId: v.id("connections"),
      media: v.array(v.object({ _id: v.id("media"), kind: v.union(v.literal("image"), v.literal("video")), url: v.string() })),
      coverUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.postId);
    if (!post) return null;
    if (post.status !== "scheduled" && post.status !== "publishing" && post.status !== "partially_failed") return null;
    const profile = await ctx.db.get("profiles", post.profileId);
    if (!profile) return null;
    const access = await pageTokenFor(ctx, post.profileId, post.createdByConnectionId);
    if (!access) {
      await ctx.db.patch("posts", post._id, { status: "failed", lastError: "No manager of this Page is connected. Reconnect Facebook." });
      return null;
    }
    const media = [];
    for (const mediaId of post.mediaIds) {
      const m = await ctx.db.get("media", mediaId);
      const url = m && m.status !== "deleted" ? await ctx.storage.getUrl(m.storageId) : null;
      if (!m || !url) {
        await ctx.db.patch("posts", post._id, { status: "failed", lastError: "A media file is missing." });
        return null;
      }
      media.push({ _id: m._id, kind: m.kind, url });
    }
    let coverUrl: string | undefined;
    if (post.ig.coverMediaId) {
      const cover = await ctx.db.get("media", post.ig.coverMediaId);
      coverUrl = cover ? ((await ctx.storage.getUrl(cover.storageId)) ?? undefined) : undefined;
    }
    await ctx.db.patch("posts", post._id, { status: "publishing" });
    return { post, profile, token: access.token, tokenConnectionId: access.connectionId, media, coverUrl };
  },
});

/** Records per-channel progress so a retried action resumes instead of re-posting. */
export const recordChannel = internalMutation({
  args: {
    postId: v.id("posts"),
    channel: v.union(channel, v.literal("webflow")),
    patch: v.object({
      status: v.optional(v.union(v.literal("pending"), v.literal("published"), v.literal("failed"))),
      postId: v.optional(v.string()),
      photoIds: v.optional(v.array(v.string())),
      videoId: v.optional(v.string()),
      creationId: v.optional(v.string()),
      childCreationIds: v.optional(v.array(v.string())),
      mediaId: v.optional(v.string()),
      permalink: v.optional(v.string()),
      commentId: v.optional(v.string()),
      commentError: v.optional(v.string()),
      error: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
      itemId: v.optional(v.string()),
      itemSlug: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.postId);
    if (!post) return null;
    const current = post[args.channel] ?? { status: "pending" as const };
    await ctx.db.patch("posts", post._id, { [args.channel]: { ...current, ...args.patch } });
    return null;
  },
});

export const getPost = internalQuery({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => await ctx.db.get("posts", args.postId),
});

/** Graph error 190 → that manager's Page token is dead. */
export const flagReconnect = internalMutation({
  args: { profileId: v.id("profiles"), connectionId: v.id("connections"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("pageMembers")
      .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", args.connectionId).eq("profileId", args.profileId))
      .unique();
    if (member) await ctx.db.patch("pageMembers", member._id, { status: "needs_reconnect", lastError: args.error });
    return null;
  },
});

/** Workpool completion: derive the post's final status from its channels. */
export const onComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ postId: v.id("posts") })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    const post = await ctx.db.get("posts", context.postId);
    if (!post || post.status === "canceled") return null;
    const channels = [post.facebook, post.instagram].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const published = channels.filter((c) => c.status === "published").length;
    const errors = channels.map((c) => c.error).filter((e): e is string => !!e);
    let status: Doc<"posts">["status"];
    if (result.kind === "canceled") status = "canceled";
    else if (published === channels.length) status = "published";
    else if (published > 0) status = "partially_failed";
    else status = "failed";
    const lastError = result.kind === "failed" && errors.length === 0 ? result.error : errors.join(" · ") || undefined;
    await ctx.db.patch("posts", post._id, { status, workId: undefined, lastError: status === "published" ? undefined : lastError });
    // Meta already holds the bytes, so a clean publish releases our copy. Scheduled
    // rather than inlined: a purge failure must not roll back the status write.
    const settled = await ctx.db.get("posts", post._id);
    if (settled && isFullyPublished(settled)) await ctx.scheduler.runAfter(0, internal.media.purgePost, { postId: post._id });
    return null;
  },
});

// ---------- the publish action ----------

type Begin = {
  post: Doc<"posts">;
  profile: Doc<"profiles">;
  token: string;
  tokenConnectionId: Id<"connections">;
  media: { _id: Id<"media">; kind: "image" | "video"; url: string }[];
  coverUrl?: string;
};

const IG_POLL_INTERVAL_MS = 5_000;
const IG_POLL_MAX_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The text a channel actually publishes: its own edit, else the shared caption. */
function captionFor(post: Doc<"posts">, channel: "facebook" | "instagram"): string {
  return (channel === "facebook" ? post.fbCaption : post.igCaption) ?? post.caption;
}

/**
 * Posts the first comment on a just-published post. A failure here never fails
 * the post itself — it is recorded on the channel so the queue can show it.
 */
async function postFirstComment(
  ctx: ActionCtxLike,
  post: Doc<"posts">,
  channel: "facebook" | "instagram",
  objectId: string | undefined,
  token: string,
) {
  const message = (channel === "facebook" ? post.fbFirstComment : post.igFirstComment)?.trim();
  if (!message) return;
  const fresh = (await ctx.runQuery(internal.publish.getPost, { postId: post._id })) as Doc<"posts">;
  if (fresh[channel]?.commentId) return; // already posted on an earlier attempt
  const record = (patch: Record<string, unknown>) =>
    ctx.runMutation(internal.publish.recordChannel, { postId: post._id, channel, patch });
  if (!objectId) {
    await record({ commentError: "Published, but the post id needed to add the first comment was missing." });
    return;
  }
  try {
    const res = await graphPost<{ id: string }>(`${objectId}/comments`, { message }, token);
    await record({ commentId: res.id, commentError: undefined });
  } catch (error) {
    await record({ commentError: `First comment failed: ${describeError(error)}` });
  }
}

/**
 * Meta is inconsistent: Instagram always answers with a full URL, but Facebook
 * returns a site-relative path for some object types — a reel comes back as
 * "/reel/123/". A schemeless string is not something the desktop app can hand
 * to the OS, so it is made absolute before it is ever stored.
 */
export function absolutePermalink(permalink: string, channel: "facebook" | "instagram"): string {
  if (/^https?:\/\//i.test(permalink)) return permalink;
  const base = channel === "facebook" ? "https://www.facebook.com" : "https://www.instagram.com";
  return `${base}/${permalink.replace(/^\/+/, "")}`;
}

/**
 * Best-effort: the public URL of what we just published, so the calendar can
 * link out to it. A missing permalink never fails a published post.
 */
async function recordPermalink(
  ctx: ActionCtxLike,
  post: Doc<"posts">,
  channel: "facebook" | "instagram",
  objectId: string | undefined,
  token: string,
) {
  if (!objectId) return;
  const field = channel === "facebook" ? "permalink_url" : "permalink";
  try {
    const res = await graphGet<Record<string, string>>(objectId, { fields: field }, token);
    const permalink = res[field];
    if (permalink) {
      await ctx.runMutation(internal.publish.recordChannel, {
        postId: post._id,
        channel,
        patch: { permalink: absolutePermalink(permalink, channel) },
      });
    }
  } catch {
    // The post is live either way; the detail panel just won't offer a link.
  }
}

type ActionCtxLike = {
  runMutation: (ref: any, args: any) => Promise<any>;
  runQuery: (ref: any, args: any) => Promise<any>;
  runAction: (ref: any, args: any) => Promise<any>;
};

/**
 * Mirrors the post into the Webflow CMS. Deliberately shaped like
 * `postFirstComment`: it swallows every error into `webflow.error` so a CMS
 * hiccup can never make a genuinely live social post look failed.
 */
export async function publishWebflow(ctx: ActionCtxLike, postId: Id<"posts">) {
  if (!webflowEnabled()) return;
  const fresh = (await ctx.runQuery(internal.publish.getPost, { postId })) as Doc<"posts"> | null;
  const wf = fresh?.webflow;
  if (!wf) return;
  if (wf.itemId) return; // already created on an earlier attempt
  const record = (patch: Record<string, unknown>) =>
    ctx.runMutation(internal.publish.recordChannel, { postId, channel: "webflow", patch });
  try {
    const created = (await ctx.runAction(internal.webflow.createItemForPost, {
      name: wf.name,
      postCopy: wf.postCopy,
      blogItemId: wf.blogItemId,
      link: wf.link,
    })) as { itemId: string; itemSlug: string };
    await record({ status: "published", itemId: created.itemId, itemSlug: created.itemSlug, publishedAt: Date.now(), error: undefined });
  } catch (error) {
    await record({ status: "failed", error: describeWebflowError(error) });
  }
}

/** "Retry Webflow" from the Queue: re-runs only the CMS write, never the social publish. */
export const webflowOnly = internalAction({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await publishWebflow(ctx, args.postId);
    return null;
  },
});

export const run = internalAction({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const input = (await ctx.runMutation(internal.publish.begin, { postId: args.postId })) as Begin | null;
    if (!input) return null;
    const { post, profile, tokenConnectionId } = input;
    const failures: string[] = [];

    const runChannel = async (name: "facebook" | "instagram", fn: () => Promise<void>) => {
      const fresh = await ctx.runQuery(internal.publish.getPost, { postId: post._id });
      const state = fresh?.[name];
      if (!post.targets[name] || state?.status === "published") return;
      try {
        await fn();
        await ctx.runMutation(internal.publish.recordChannel, {
          postId: post._id,
          channel: name,
          patch: { status: "published", publishedAt: Date.now(), error: undefined },
        });
      } catch (error) {
        const message = describeError(error);
        failures.push(`${name}: ${message}`);
        await ctx.runMutation(internal.publish.recordChannel, { postId: post._id, channel: name, patch: { status: "failed", error: message } });
        if (error instanceof GraphApiError && error.needsReconnect) {
          await ctx.runMutation(internal.publish.flagReconnect, { profileId: profile._id, connectionId: tokenConnectionId, error: message });
        }
      }
    };

    await runChannel("facebook", () => publishFacebook(ctx, input));
    await runChannel("instagram", () => publishInstagram(ctx, input));

    // Only mirror into Webflow once something actually went live socially, and
    // never let it contribute to `failures` — the social post is authoritative.
    if (post.webflow) {
      const settled = (await ctx.runQuery(internal.publish.getPost, { postId: post._id })) as Doc<"posts">;
      if (settled.facebook?.status === "published" || settled.instagram?.status === "published") {
        await publishWebflow(ctx, post._id);
      }
    }

    if (failures.length > 0) throw new Error(failures.join(" · "));
    return null;
  },
});

// ---------- Facebook Page ----------

async function publishFacebook(ctx: ActionCtxLike, { post, profile, token, media }: Begin) {
  const pageId = profile.pageId;
  const caption = captionFor(post, "facebook");
  const fresh = (await ctx.runQuery(internal.publish.getPost, { postId: post._id })) as Doc<"posts">;
  const state = fresh.facebook ?? { status: "pending" as const };
  const record = (patch: Record<string, unknown>) =>
    ctx.runMutation(internal.publish.recordChannel, { postId: post._id, channel: "facebook", patch });

  switch (post.fbFormat) {
    case "photo": {
      const res = await graphPost<{ id: string; post_id?: string }>(`${pageId}/photos`, { url: media[0].url, caption, alt_text_custom: post.ig.altText }, token);
      const postId = res.post_id ?? res.id;
      await record({ postId, photoIds: [res.id] });
      await recordPermalink(ctx, post, "facebook", postId, token);
      await postFirstComment(ctx, post, "facebook", postId, token);
      return;
    }
    case "multi_photo": {
      const photoIds = [...(state.photoIds ?? [])];
      for (let i = photoIds.length; i < media.length; i++) {
        const res = await graphPost<{ id: string }>(`${pageId}/photos`, { url: media[i].url, published: false, temporary: true }, token);
        photoIds.push(res.id);
        await record({ photoIds });
      }
      const res = await graphPost<{ id: string }>(
        `${pageId}/feed`,
        { message: caption, attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))) },
        token,
      );
      await record({ postId: res.id });
      await recordPermalink(ctx, post, "facebook", res.id, token);
      await postFirstComment(ctx, post, "facebook", res.id, token);
      return;
    }
    case "video": {
      const res = await graphPost<{ id: string }>(`${pageId}/videos`, { file_url: media[0].url, description: caption }, token);
      await record({ videoId: res.id, postId: res.id });
      await recordPermalink(ctx, post, "facebook", res.id, token);
      await postFirstComment(ctx, post, "facebook", res.id, token);
      return;
    }
    case "reel": {
      let videoId = state.videoId;
      if (!videoId) {
        const start = await graphPost<{ video_id: string; upload_url: string }>(`${pageId}/video_reels`, { upload_phase: "start" }, token);
        videoId = start.video_id;
        await record({ videoId });
        const upload = await fetch(`https://rupload.facebook.com/video-upload/${graphVersion()}/${videoId}`, {
          method: "POST",
          headers: { Authorization: `OAuth ${token}`, file_url: media[0].url },
        });
        if (!upload.ok) throw new Error(`Reel upload failed (${upload.status}): ${(await upload.text()).slice(0, 200)}`);
      }
      await graphPost<{ success: boolean }>(
        `${pageId}/video_reels`,
        { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: caption },
        token,
      );
      await record({ postId: videoId });
      await recordPermalink(ctx, post, "facebook", videoId, token);
      await postFirstComment(ctx, post, "facebook", videoId, token);
      return;
    }
  }
}

// ---------- Instagram ----------

type ContainerStatus = { status_code: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED"; status?: string };

async function waitForContainer(creationId: string, token: string) {
  const deadline = Date.now() + IG_POLL_MAX_MS;
  for (;;) {
    const res = await graphGet<ContainerStatus>(creationId, { fields: "status_code,status" }, token);
    if (res.status_code === "FINISHED" || res.status_code === "PUBLISHED") return;
    if (res.status_code === "ERROR" || res.status_code === "EXPIRED") {
      throw new Error(`Instagram could not process the media: ${res.status ?? res.status_code}`);
    }
    if (Date.now() > deadline) throw new Error("Instagram is still processing the media. Retry shortly.");
    await sleep(IG_POLL_INTERVAL_MS);
  }
}

async function publishInstagram(ctx: ActionCtxLike, { post, profile, token, media, coverUrl }: Begin) {
  const igUserId = profile.igUserId;
  if (!igUserId) throw new Error("This Page has no linked Instagram account.");
  const caption = captionFor(post, "instagram");
  const fresh = (await ctx.runQuery(internal.publish.getPost, { postId: post._id })) as Doc<"posts">;
  const state = fresh.instagram ?? { status: "pending" as const };
  const record = (patch: Record<string, unknown>) =>
    ctx.runMutation(internal.publish.recordChannel, { postId: post._id, channel: "instagram", patch });

  const quota = await graphGet<{ data: { quota_usage: number; config?: { quota_total?: number } }[] }>(
    `${igUserId}/content_publishing_limit`,
    { fields: "quota_usage,config" },
    token,
  );
  const usage = quota.data?.[0];
  if (usage && usage.quota_usage >= (usage.config?.quota_total ?? 100)) {
    throw new Error("Instagram's 24-hour publishing limit is reached. Retry later.");
  }

  const common = {
    collaborators: post.ig.collaborators.length ? JSON.stringify(post.ig.collaborators) : undefined,
    user_tags: post.ig.userTags.length
      ? JSON.stringify(post.ig.userTags.map((t) => (post.igFormat === "image" ? { username: t.username, x: t.x ?? 0.5, y: t.y ?? 0.5 } : { username: t.username })))
      : undefined,
  };

  let creationId = state.creationId;
  if (!creationId) {
    switch (post.igFormat) {
      case "image": {
        const res = await graphPost<{ id: string }>(
          `${igUserId}/media`,
          { image_url: media[0].url, caption, alt_text: post.ig.altText, ...common },
          token,
        );
        creationId = res.id;
        break;
      }
      case "reel": {
        const res = await graphPost<{ id: string }>(
          `${igUserId}/media`,
          {
            media_type: "REELS",
            video_url: media[0].url,
            caption,
            share_to_feed: post.ig.shareToFeed ?? true,
            cover_url: coverUrl,
            thumb_offset: coverUrl ? undefined : post.ig.thumbOffsetMs,
            ...common,
          },
          token,
        );
        creationId = res.id;
        break;
      }
      case "carousel": {
        const children = [...(state.childCreationIds ?? [])];
        for (let i = children.length; i < media.length; i++) {
          const m = media[i];
          const res = await graphPost<{ id: string }>(
            `${igUserId}/media`,
            m.kind === "video"
              ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true }
              : { image_url: m.url, is_carousel_item: true },
            token,
          );
          children.push(res.id);
          await record({ childCreationIds: children });
        }
        for (const child of children) await waitForContainer(child, token);
        const res = await graphPost<{ id: string }>(
          `${igUserId}/media`,
          { media_type: "CAROUSEL", children: children.join(","), caption, collaborators: common.collaborators },
          token,
        );
        creationId = res.id;
        break;
      }
    }
    await record({ creationId });
  }

  await waitForContainer(creationId, token);
  const published = await graphPost<{ id: string }>(`${igUserId}/media_publish`, { creation_id: creationId }, token);
  await record({ mediaId: published.id });
  await recordPermalink(ctx, post, "instagram", published.id, token);
  await postFirstComment(ctx, post, "instagram", published.id, token);
}
