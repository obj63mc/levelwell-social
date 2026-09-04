import { v } from "convex/values";
import { query } from "./_generated/server";
import { isUnauthenticated, profilesForSession, requireSession, sessionArgs, type PageAccess } from "./lib/session";

// Public shape: never includes access tokens. Page fields + this manager's membership status.
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
  // Page tasks Meta actually granted this manager. Missing ones mean publishing
  // will fail later, so the Dashboard can warn before a post is ever composed.
  missingTasks: v.array(v.string()),
});

export function toSummary({ profile: p, member }: PageAccess) {
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
    status: member.status,
    lastError: member.lastError,
    missingTasks: missingTasks(member.tasks),
  };
}

/** Publishing needs both: CREATE_CONTENT to post, MANAGE for webhooks/metadata. */
export const REQUIRED_TASKS = ["CREATE_CONTENT", "MANAGE"];

export function missingTasks(tasks: string[]): string[] {
  return REQUIRED_TASKS.filter((t) => !tasks.includes(t));
}

/** Drives the first-launch gate: no (valid) session → Connect screen. */
export const connectionStatus = query({
  args: sessionArgs,
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
  handler: async (ctx, args) => {
    let session;
    try {
      session = await requireSession(ctx, args.sessionToken);
    } catch (error) {
      if (isUnauthenticated(error)) return { connected: false, profiles: [] };
      throw error;
    }
    const { connection } = session;
    const pages = await profilesForSession(ctx, session);
    return {
      connected: true,
      connection: {
        _id: connection._id,
        metaUserName: connection.metaUserName,
        status: connection.status,
        userTokenExpiresAt: connection.userTokenExpiresAt,
        grantedScopes: connection.grantedScopes,
      },
      profiles: pages.map(toSummary),
    };
  },
});

/** Pages the caller may manage. */
export const list = query({
  args: sessionArgs,
  returns: v.array(profileSummary),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    return (await profilesForSession(ctx, session)).map(toSummary);
  },
});
