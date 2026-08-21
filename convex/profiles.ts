import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { DEFAULT_OWNER_EMAIL } from "./lib/owner";

// Public shape: never includes access tokens.
export const profileSummary = v.object({
  _id: v.id("profiles"),
  pageId: v.string(),
  pageName: v.string(),
  pageCategory: v.optional(v.string()),
  pagePictureUrl: v.optional(v.string()),
  igUserId: v.optional(v.string()),
  igUsername: v.optional(v.string()),
  igProfilePictureUrl: v.optional(v.string()),
  webhookSubscribed: v.boolean(),
  status: v.union(v.literal("active"), v.literal("needs_reconnect")),
  lastError: v.optional(v.string()),
});

export function toSummary(p: Doc<"profiles">) {
  return {
    _id: p._id,
    pageId: p.pageId,
    pageName: p.pageName,
    pageCategory: p.pageCategory,
    pagePictureUrl: p.pagePictureUrl,
    igUserId: p.igUserId,
    igUsername: p.igUsername,
    igProfilePictureUrl: p.igProfilePictureUrl,
    webhookSubscribed: p.webhookSubscribed,
    status: p.status,
    lastError: p.lastError,
  };
}

/** Drives the first-launch gate: no connection → Connect screen. */
export const connectionStatus = query({
  args: {},
  returns: v.object({
    connected: v.boolean(),
    connection: v.optional(
      v.object({
        _id: v.id("connections"),
        metaUserName: v.string(),
        status: v.union(v.literal("connected"), v.literal("needs_reconnect")),
        userTokenExpiresAt: v.number(),
        grantedScopes: v.array(v.string()),
      }),
    ),
    profiles: v.array(profileSummary),
  }),
  handler: async (ctx) => {
    const connection = await ctx.db
      .query("connections")
      .withIndex("by_ownerEmail", (q) => q.eq("ownerEmail", DEFAULT_OWNER_EMAIL))
      .first();
    if (!connection) return { connected: false, profiles: [] };
    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connection._id))
      .collect();
    return {
      connected: true,
      connection: {
        _id: connection._id,
        metaUserName: connection.metaUserName,
        status: connection.status,
        userTokenExpiresAt: connection.userTokenExpiresAt,
        grantedScopes: connection.grantedScopes,
      },
      profiles: profiles.map(toSummary),
    };
  },
});

export const list = query({
  args: {},
  returns: v.array(profileSummary),
  handler: async (ctx) => {
    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_ownerEmail", (q) => q.eq("ownerEmail", DEFAULT_OWNER_EMAIL))
      .collect();
    return profiles.map(toSummary);
  },
});
