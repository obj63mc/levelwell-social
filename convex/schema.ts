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

  // Raw, signature-verified Meta webhook deliveries (processed by the inbox later).
  webhookEvents: defineTable({
    object: v.string(),
    payload: v.any(),
    processedAt: v.optional(v.number()),
  }).index("by_processedAt", ["processedAt"]),
});
