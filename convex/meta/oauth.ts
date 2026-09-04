import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { hashToken, randomHex, requireSession, sessionArgs } from "../lib/session";
import { describeError, graphGet, graphGetAll, graphPost, graphVersion } from "./client";
import {
  IDENTITY_SCOPES,
  resolveBusinessId,
  systemUserMode,
  systemUserPages,
  userIsBusinessMember,
  type SystemAccount,
} from "./systemUser";

const STATE_TTL_MS = 15 * 60 * 1000;

export function redirectUri(): string {
  return `${env.CONVEX_SITE_URL}/oauth/callback`;
}

/** Desktop calls this, then opens `url` in the system browser. */
export const start = mutation({
  args: {},
  returns: v.object({ state: v.string(), url: v.string() }),
  handler: async (ctx) => {
    const state = randomHex(32);
    await ctx.db.insert("oauthStates", {
      state,
      status: "pending",
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", env.META_APP_ID);
    if (systemUserMode()) {
      // Identity only. Asking for no business assets means Meta never shows the
      // portfolio picker that refuses to share the app owner's own Page.
      url.searchParams.set("scope", IDENTITY_SCOPES.join(","));
    } else if (env.META_LOGIN_CONFIG_ID) {
      url.searchParams.set("config_id", env.META_LOGIN_CONFIG_ID);
    } else {
      throw new ConvexError("Set META_SYSTEM_USER_TOKEN or META_LOGIN_CONFIG_ID on this deployment.");
    }
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

/**
 * Once `status` is completed, the desktop claims its app session exactly once.
 * The token is never exposed through the reactive `status` query.
 */
export const claimSession = mutation({
  args: { state: v.string() },
  returns: v.object({ sessionToken: v.string() }),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!doc || doc.status !== "completed" || !doc.connectionId) throw new Error("Login has not completed.");
    if (doc.claimedAt !== undefined) throw new Error("This login was already claimed. Start again from the app.");
    if (doc.expiresAt < Date.now()) throw new Error("This login link expired. Start again from the app.");
    const now = Date.now();
    await ctx.db.patch("oauthStates", doc._id, { claimedAt: now });
    const sessionToken = randomHex(32);
    await ctx.db.insert("sessions", {
      tokenHash: await hashToken(sessionToken),
      connectionId: doc.connectionId,
      createdAt: now,
      lastSeenAt: now,
    });
    return { sessionToken };
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
  returns: v.null(),
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
    return null;
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
  tasks: v.array(v.string()),
  igUserId: v.optional(v.string()),
  igUsername: v.optional(v.string()),
  igProfilePictureUrl: v.optional(v.string()),
  webhookSubscribed: v.boolean(),
  lastError: v.optional(v.string()),
});

/**
 * Upserts the connection (by Meta user id), each Page (by Page id, shared by all
 * its managers), and this user's membership + Page token on each Page.
 */
export const saveConnection = internalMutation({
  args: {
    metaUserId: v.string(),
    metaUserName: v.string(),
    longLivedUserToken: v.string(),
    userTokenExpiresAt: v.number(),
    grantedScopes: v.array(v.string()),
    pages: v.array(pageInput),
    // True when the page tokens come from the portfolio's system user.
    systemUser: v.optional(v.boolean()),
  },
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    const { pages, systemUser, ...connectionFields } = args;
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

    const granted = new Set<Id<"profiles">>();
    for (const page of pages) {
      const { pageAccessToken, tasks, lastError, ...rest } = page;
      // The shared system token lives on the Page; per-manager tokens do not.
      const pageFields = { ...rest, pageAccessToken: systemUser ? pageAccessToken : undefined };
      const current = await ctx.db
        .query("profiles")
        .withIndex("by_pageId", (q) => q.eq("pageId", page.pageId))
        .unique();
      let profileId: Id<"profiles">;
      if (current) {
        await ctx.db.patch("profiles", current._id, pageFields);
        profileId = current._id;
      } else {
        profileId = await ctx.db.insert("profiles", pageFields);
      }
      granted.add(profileId);

      const memberFields = { pageAccessToken, tasks, status: "active" as const, lastError };
      const member = await ctx.db
        .query("pageMembers")
        .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", connectionId).eq("profileId", profileId))
        .unique();
      if (member) await ctx.db.patch("pageMembers", member._id, memberFields);
      else await ctx.db.insert("pageMembers", { profileId, connectionId, ...memberFields });
    }

    // Pages this user no longer granted access to. The Page itself (and its content) stays.
    const memberships = await ctx.db
      .query("pageMembers")
      .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", connectionId))
      .collect();
    for (const member of memberships) {
      if (!granted.has(member.profileId)) {
        await ctx.db.patch("pageMembers", member._id, { status: "needs_reconnect", lastError: "Page access was not granted on the last login." });
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
  tasks?: string[];
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

/** Called by the /oauth/callback HTTP action. Runs the whole token chain. */
export const completeConnect = internalAction({
  args: { code: v.string(), state: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Throws (and the callback page shows why) if the state is unknown, used, or expired.
    await ctx.runMutation(internal.meta.oauth.consumeState, { state: args.state });

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

      // 4. Pages (with never-expiring Page tokens) + linked Instagram accounts.
      //
      // System-user mode inverts where these come from: the Pages belong to the
      // portfolio's system user, not to whoever just logged in, so the login only
      // has to prove the person is allowed in.
      let accounts: (Account | SystemAccount)[];
      if (systemUserMode()) {
        const businessId = await resolveBusinessId();
        const membership = await userIsBusinessMember(userToken, businessId);
        if (!membership.ok) throw new Error(membership.reason);
        if (!membership.member) {
          throw new Error("You are not a member of this business portfolio. Ask an admin to add you in Meta Business settings.");
        }
        accounts = await systemUserPages();
        if (accounts.length === 0) {
          throw new Error("No Pages are assigned to the system user. Add the Page to it in Business settings → Users → System users → Add assets.");
        }
      } else {
        accounts = await graphGetAll<Account>(
          "me/accounts",
          {
            fields:
              "id,name,category,access_token,tasks,picture{url},instagram_business_account{id,username,profile_picture_url}",
            limit: 100,
          },
          userToken,
        );
        if (accounts.length === 0) {
          throw new Error("No Facebook Pages were granted. Pick at least one Page you admin during login.");
        }
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
          tasks: account.tasks ?? [],
          igUserId: account.instagram_business_account?.id,
          igUsername: account.instagram_business_account?.username,
          igProfilePictureUrl: account.instagram_business_account?.profile_picture_url,
          webhookSubscribed,
          lastError,
        });
      }

      const connectionId: Id<"connections"> = await ctx.runMutation(internal.meta.oauth.saveConnection, {
        metaUserId: me.id,
        metaUserName: me.name,
        longLivedUserToken: userToken,
        userTokenExpiresAt,
        grantedScopes,
        pages,
        systemUser: systemUserMode(),
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

/** Ends this app session only; the Meta grant stays so the next login reuses it. */
export const signOut = mutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { session } = await requireSession(ctx, args.sessionToken);
    await ctx.db.patch("sessions", session._id, { revokedAt: Date.now() });
    return null;
  },
});

/**
 * "Disconnect Facebook": removes this Meta user's grant, sessions, and Page
 * memberships. Pages and their content remain for the other managers.
 */
export const disconnect = mutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { connection } = await requireSession(ctx, args.sessionToken);
    const members = await ctx.db
      .query("pageMembers")
      .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", connection._id))
      .collect();
    for (const member of members) await ctx.db.delete("pageMembers", member._id);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connection._id))
      .collect();
    for (const session of sessions) await ctx.db.delete("sessions", session._id);
    await ctx.db.delete("connections", connection._id);
    return null;
  },
});
