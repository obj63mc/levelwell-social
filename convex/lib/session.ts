import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** Spread into the `args` of every public function that acts on behalf of a user. */
export const sessionArgs = { sessionToken: v.string() };

export function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type Session = { session: Doc<"sessions">; connection: Doc<"connections"> };

/** Resolves a session token to its Meta user. Throws ConvexError("unauthenticated") otherwise. */
export async function requireSession(ctx: Ctx, token: string): Promise<Session> {
  const tokenHash = await hashToken(token);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session || session.revokedAt !== undefined) throw new ConvexError("unauthenticated");
  const connection = await ctx.db.get("connections", session.connectionId);
  if (!connection) throw new ConvexError("unauthenticated");
  return { session, connection };
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ConvexError && error.data === "unauthenticated";
}

export type PageAccess = { profile: Doc<"profiles">; member: Doc<"pageMembers"> };

/** The caller must be an active manager of the Page. Throws ConvexError("forbidden") otherwise. */
export async function requirePageAccess(ctx: Ctx, { connection }: Session, profileId: Id<"profiles">): Promise<PageAccess> {
  const member = await ctx.db
    .query("pageMembers")
    .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", connection._id).eq("profileId", profileId))
    .unique();
  if (!member || member.status !== "active") throw new ConvexError("forbidden");
  const profile = await ctx.db.get("profiles", profileId);
  if (!profile) throw new ConvexError("forbidden");
  return { profile, member };
}

/**
 * A usable Page token for background work (webhook processing, scheduled publishing):
 * the preferred manager's token if still active, else any active manager's. Null if none.
 */
export async function pageTokenFor(
  ctx: Ctx,
  profileId: Id<"profiles">,
  preferConnectionId?: Id<"connections">,
): Promise<{ token: string; connectionId: Id<"connections"> } | null> {
  if (preferConnectionId) {
    const preferred = await ctx.db
      .query("pageMembers")
      .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", preferConnectionId).eq("profileId", profileId))
      .unique();
    if (preferred?.status === "active") return { token: preferred.pageAccessToken, connectionId: preferred.connectionId };
  }
  // A Page has a handful of managers; scan them for an active one.
  const members = await ctx.db
    .query("pageMembers")
    .withIndex("by_profileId", (q) => q.eq("profileId", profileId))
    .take(50);
  const fallback = members.find((m) => m.status === "active");
  return fallback ? { token: fallback.pageAccessToken, connectionId: fallback.connectionId } : null;
}

/** Pages this Meta user may manage, with their membership row. Bounded: a user admins a handful of Pages. */
export async function profilesForSession(ctx: Ctx, { connection }: Session): Promise<PageAccess[]> {
  const members = await ctx.db
    .query("pageMembers")
    .withIndex("by_connectionId_and_profileId", (q) => q.eq("connectionId", connection._id))
    .take(200);
  const out: PageAccess[] = [];
  for (const member of members) {
    const profile = await ctx.db.get("profiles", member.profileId);
    if (profile) out.push({ profile, member });
  }
  return out;
}
