import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Identity = the Meta user who logged in (connections + sessions).
// Content scope = the Facebook Page (profiles); any Meta user who admins the
// Page (pageMembers, rebuilt from /me/accounts on every login) shares its content.
export default defineSchema({
  // One per Facebook user grant (Facebook Login for Business).
  connections: defineTable({
    metaUserId: v.string(),
    metaUserName: v.string(),
    longLivedUserToken: v.string(),
    userTokenExpiresAt: v.number(),
    grantedScopes: v.array(v.string()),
    status: v.union(v.literal("connected"), v.literal("needs_reconnect")),
    lastError: v.optional(v.string()),
  }).index("by_metaUserId", ["metaUserId"]),

  // App sessions minted after a successful Meta login. Only the SHA-256 hash is stored.
  sessions: defineTable({
    tokenHash: v.string(),
    connectionId: v.id("connections"),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_connectionId", ["connectionId"]),

  // One per Facebook Page (+ its linked Instagram professional account). Shared by all its managers.
  profiles: defineTable({
    pageId: v.string(),
    pageName: v.string(),
    pageCategory: v.optional(v.string()),
    pagePictureUrl: v.optional(v.string()),
    igUserId: v.optional(v.string()),
    igUsername: v.optional(v.string()),
    igProfilePictureUrl: v.optional(v.string()),
    webhookSubscribed: v.boolean(),
  })
    .index("by_pageId", ["pageId"])
    .index("by_igUserId", ["igUserId"]),

  // Which Meta users may manage which Page, each with their own Page token.
  pageMembers: defineTable({
    profileId: v.id("profiles"),
    connectionId: v.id("connections"),
    pageAccessToken: v.string(),
    tasks: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_reconnect")),
    lastError: v.optional(v.string()),
  })
    .index("by_connectionId_and_profileId", ["connectionId", "profileId"])
    .index("by_profileId", ["profileId"]),

  // OAuth CSRF state; the desktop app subscribes to it to learn the outcome,
  // then claims its session token from it exactly once.
  oauthStates: defineTable({
    state: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    connectionId: v.optional(v.id("connections")),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
  }).index("by_state", ["state"]),

  // Uploaded assets (Convex file storage). Public getUrl() is what Meta downloads at publish time.
  media: defineTable({
    profileId: v.id("profiles"),
    uploadedByConnectionId: v.id("connections"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("image"), v.literal("video")),
    mimeType: v.string(),
    sizeBytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    status: v.union(v.literal("uploaded"), v.literal("attached"), v.literal("deleted")),
    demo: v.optional(v.boolean()),
  })
    .index("by_profileId_and_status", ["profileId", "status"])
    .index("by_status", ["status"]),

  // A post belongs to the Page and publishes to any of its channels. Per-channel
  // sub-objects hold the idempotency keys so a retried publish never double-posts.
  posts: defineTable({
    profileId: v.id("profiles"),
    createdByConnectionId: v.id("connections"),
    // `caption` is the composer's primary-channel text; the per-channel fields
    // override it when the user edits the cross-posted copy separately.
    caption: v.string(),
    fbCaption: v.optional(v.string()),
    igCaption: v.optional(v.string()),
    // Posted as a comment on the post itself right after it publishes — the
    // place for links that don't belong in the body.
    fbFirstComment: v.optional(v.string()),
    igFirstComment: v.optional(v.string()),
    mediaIds: v.array(v.id("media")),
    targets: v.object({ facebook: v.boolean(), instagram: v.boolean() }),
    igFormat: v.union(v.literal("image"), v.literal("reel"), v.literal("carousel")),
    fbFormat: v.union(v.literal("photo"), v.literal("multi_photo"), v.literal("video"), v.literal("reel")),
    ig: v.object({
      collaborators: v.array(v.string()),
      userTags: v.array(v.object({ username: v.string(), x: v.optional(v.number()), y: v.optional(v.number()) })),
      shareToFeed: v.optional(v.boolean()),
      coverMediaId: v.optional(v.id("media")),
      thumbOffsetMs: v.optional(v.number()),
      altText: v.optional(v.string()),
    }),
    scheduledAt: v.number(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("publishing"),
      v.literal("published"),
      v.literal("partially_failed"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    workId: v.optional(v.string()),
    facebook: v.optional(
      v.object({
        status: v.union(v.literal("pending"), v.literal("published"), v.literal("failed")),
        postId: v.optional(v.string()),
        photoIds: v.optional(v.array(v.string())),
        videoId: v.optional(v.string()),
        permalink: v.optional(v.string()),
        commentId: v.optional(v.string()),
        commentError: v.optional(v.string()),
        error: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
      }),
    ),
    instagram: v.optional(
      v.object({
        status: v.union(v.literal("pending"), v.literal("published"), v.literal("failed")),
        creationId: v.optional(v.string()),
        childCreationIds: v.optional(v.array(v.string())),
        mediaId: v.optional(v.string()),
        permalink: v.optional(v.string()),
        commentId: v.optional(v.string()),
        commentError: v.optional(v.string()),
        error: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
      }),
    ),
    lastError: v.optional(v.string()),
    // Dev-only rows from `npm run seed`: never enqueued on the publish pool.
    demo: v.optional(v.boolean()),
  })
    .index("by_profileId_and_status", ["profileId", "status"])
    .index("by_profileId_and_scheduledAt", ["profileId", "scheduledAt"])
    .index("by_status", ["status"]),

  // Raw, signature-verified Meta webhook deliveries (processed by the inbox later).
  webhookEvents: defineTable({
    object: v.string(),
    payload: v.any(),
    processedAt: v.optional(v.number()),
  }).index("by_processedAt", ["processedAt"]),
});
