import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { DEFAULT_OWNER_EMAIL } from "../lib/owner";
import { env } from "../_generated/server";
import { describeError, graphGet, graphGetAll, graphPost, graphVersion } from "./client";

const STATE_TTL_MS = 15 * 60 * 1000;

export function redirectUri(): string {
  return `${env.CONVEX_SITE_URL}/oauth/callback`;
}

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Desktop calls this, then opens `url` in the system browser. */
export const start = mutation({
  args: {},
  returns: v.object({ state: v.string(), url: v.string() }),
  handler: async (ctx) => {
    const state = randomState();
    await ctx.db.insert("oauthStates", {
      state,
      ownerEmail: DEFAULT_OWNER_EMAIL,
      status: "pending",
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", env.META_APP_ID);
    url.searchParams.set("config_id", env.META_LOGIN_CONFIG_ID);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return { state, url: url.toString() };
  },
});

/** Desktop subscribes to this to learn when the browser flow finished. */
export const status = query({
  args: { state: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("failed"),
      ),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!doc) return null;
    return { status: doc.status, error: doc.error };
  },
});

export const getState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
  },
});

/** Atomically claims a pending, unexpired state. Throws if it can't. */
export const consumeState = internalMutation({
  args: { state: v.string() },
  returns: v.object({ ownerEmail: v.string() }),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!doc) throw new Error("Unknown login state. Start the connection again from the app.");
    if (doc.status !== "pending") throw new Error("This login link was already used. Start again from the app.");
    if (doc.expiresAt < Date.now()) {
      await ctx.db.patch("oauthStates", doc._id, { status: "failed", error: "Login link expired." });
      throw new Error("This login link expired. Start again from the app.");
    }
    await ctx.db.patch("oauthStates", doc._id, { status: "in_progress" });
    return { ownerEmail: doc.ownerEmail };
  },
});

export const finishState = internalMutation({
  args: {
    state: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
    connectionId: v.optional(v.id("connections")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!doc) return null;
    await ctx.db.patch("oauthStates", doc._id, { status: args.status, error: args.error, connectionId: args.connectionId });
    return null;
  },
});

const pageInput = v.object({
  pageId: v.string(),
  pageName: v.string(),
  pageCategory: v.optional(v.string()),
  pagePictureUrl: v.optional(v.string()),
  pageAccessToken: v.string(),
  igUserId: v.optional(v.string()),
  igUsername: v.optional(v.string()),
  igProfilePictureUrl: v.optional(v.string()),
  webhookSubscribed: v.boolean(),
  lastError: v.optional(v.string()),
});

/** Upserts the connection (by Meta user id) and its Pages (by Page id). */
export const saveConnection = internalMutation({
  args: {
    ownerEmail: v.string(),
    metaUserId: v.string(),
    metaUserName: v.string(),
    longLivedUserToken: v.string(),
    userTokenExpiresAt: v.number(),
    grantedScopes: v.array(v.string()),
    pages: v.array(pageInput),
  },
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    const { pages, ...connectionFields } = args;
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_metaUserId", (q) => q.eq("metaUserId", args.metaUserId))
      .unique();
    let connectionId: Id<"connections">;
    if (existing) {
      await ctx.db.patch("connections", existing._id, { ...connectionFields, status: "connected", lastError: undefined });
      connectionId = existing._id;
    } else {
      connectionId = await ctx.db.insert("connections", { ...connectionFields, status: "connected" });
    }

    const seen = new Set<string>();
    for (const page of pages) {
      seen.add(page.pageId);
      const current = await ctx.db
        .query("profiles")
        .withIndex("by_pageId", (q) => q.eq("pageId", page.pageId))
        .unique();
      const fields = { ...page, connectionId, ownerEmail: args.ownerEmail, status: "active" as const };
      if (current) await ctx.db.patch("profiles", current._id, fields);
      else await ctx.db.insert("profiles", fields);
    }
    // Pages the user no longer granted access to.
    const stale = await ctx.db
      .query("profiles")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
      .collect();
    for (const profile of stale) {
      if (!seen.has(profile.pageId)) {
        await ctx.db.patch("profiles", profile._id, { status: "needs_reconnect", lastError: "Page access was not granted on the last login." });
      }
    }
    return connectionId;
  },
});

type TokenResponse = { access_token: string; token_type?: string; expires_in?: number };
type Me = { id: string; name: string };
type Permission = { permission: string; status: "granted" | "declined" | "expired" };
type Account = {
  id: string;
  name: string;
  category?: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

/** Called by the /oauth/callback HTTP action. Runs the whole token chain. */
export const completeConnect = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Throws (and the callback page shows why) if the state is unknown, used, or expired.
    const claimed: { ownerEmail: string } = await ctx.runMutation(internal.meta.oauth.consumeState, { state: args.state });
    const ownerEmail = claimed.ownerEmail;

    try {
      const appId = env.META_APP_ID;
      const appSecret = env.META_APP_SECRET;

      // 1. code → short-lived user token
      const shortLived = await graphGet<TokenResponse>("oauth/access_token", {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri(),
        code: args.code,
      });

      // 2. short-lived → long-lived user token (~60 days)
      const longLived = await graphGet<TokenResponse>("oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived.access_token,
      });
      const userToken = longLived.access_token;
      const userTokenExpiresAt = Date.now() + (longLived.expires_in ?? 60 * 24 * 3600) * 1000;

      // 3. who granted, and what
      const me = await graphGet<Me>("me", { fields: "id,name" }, userToken);
      const permissions = await graphGetAll<Permission>("me/permissions", {}, userToken);
      const grantedScopes = permissions.filter((p) => p.status === "granted").map((p) => p.permission);

      // 4. Pages (with never-expiring Page tokens) + linked Instagram accounts
      const accounts = await graphGetAll<Account>(
        "me/accounts",
        {
          fields:
            "id,name,category,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}",
          limit: 100,
        },
        userToken,
      );
      if (accounts.length === 0) {
        throw new Error("No Facebook Pages were granted. Pick at least one Page you admin during login.");
      }

      // 5. Subscribe each Page to webhooks (feed → comments on Page posts)
      const pages = [];
      for (const account of accounts) {
        let webhookSubscribed = false;
        let lastError: string | undefined;
        try {
          await graphPost<{ success: boolean }>(`${account.id}/subscribed_apps`, { subscribed_fields: "feed" }, account.access_token);
          webhookSubscribed = true;
        } catch (error) {
          lastError = `Webhook subscription failed: ${describeError(error)}`;
        }
        pages.push({
          pageId: account.id,
          pageName: account.name,
          pageCategory: account.category,
          pagePictureUrl: account.picture?.data?.url,
          pageAccessToken: account.access_token,
          igUserId: account.instagram_business_account?.id,
          igUsername: account.instagram_business_account?.username,
          igProfilePictureUrl: account.instagram_business_account?.profile_picture_url,
          webhookSubscribed,
          lastError,
        });
      }

      const connectionId: Id<"connections"> = await ctx.runMutation(internal.meta.oauth.saveConnection, {
        ownerEmail,
        metaUserId: me.id,
        metaUserName: me.name,
        longLivedUserToken: userToken,
        userTokenExpiresAt,
        grantedScopes,
        pages,
      });
      await ctx.runMutation(internal.meta.oauth.finishState, { state: args.state, status: "completed", connectionId });
    } catch (error) {
      const message = describeError(error);
      await ctx.runMutation(internal.meta.oauth.finishState, { state: args.state, status: "failed", error: message });
      throw error;
    }
    return null;
  },
});

/** Dev convenience + "sign out of Facebook" — removes the grant and its Pages locally. */
export const disconnect = mutation({
  args: { connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .collect();
    for (const profile of profiles) await ctx.db.delete("profiles", profile._id);
    const connection: Doc<"connections"> | null = await ctx.db.get("connections", args.connectionId);
    if (connection) await ctx.db.delete("connections", connection._id);
    return null;
  },
});
