import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Convex Auth is installed but not yet used for sign-in.
// Its tables stay in the schema so it can be enabled later without a migration.
export default defineSchema({
  ...authTables,

  // One per Facebook user grant (Facebook Login for Business).
  connections: defineTable({
    ownerEmail: v.string(),
    metaUserId: v.string(),
    metaUserName: v.string(),
    longLivedUserToken: v.string(),
    userTokenExpiresAt: v.number(),
    grantedScopes: v.array(v.string()),
    status: v.union(v.literal("connected"), v.literal("needs_reconnect")),
    lastError: v.optional(v.string()),
  })
    .index("by_ownerEmail", ["ownerEmail"])
    .index("by_metaUserId", ["metaUserId"]),

  // One per Facebook Page (+ its linked Instagram professional account).
  profiles: defineTable({
    connectionId: v.id("connections"),
    ownerEmail: v.string(),
    pageId: v.string(),
    pageName: v.string(),
    pageCategory: v.optional(v.string()),
    pagePictureUrl: v.optional(v.string()),
    pageAccessToken: v.string(),
    igUserId: v.optional(v.string()),
    igUsername: v.optional(v.string()),
    igProfilePictureUrl: v.optional(v.string()),
    webhookSubscribed: v.boolean(),
    status: v.union(v.literal("active"), v.literal("needs_reconnect")),
    lastError: v.optional(v.string()),
  })
    .index("by_pageId", ["pageId"])
    .index("by_connectionId", ["connectionId"])
    .index("by_ownerEmail", ["ownerEmail"]),

  // OAuth CSRF state; the desktop app subscribes to it to learn the outcome.
  oauthStates: defineTable({
    state: v.string(),
    ownerEmail: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    connectionId: v.optional(v.id("connections")),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),

  // Raw, signature-verified Meta webhook deliveries (processed by the inbox later).
  webhookEvents: defineTable({
    object: v.string(),
    payload: v.any(),
    processedAt: v.optional(v.number()),
  }).index("by_processedAt", ["processedAt"]),
});
