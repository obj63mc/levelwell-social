import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requirePageAccess, requireSession, sessionArgs, type Session } from "./lib/session";

export const NOTE_MAX = 5000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const noteSummary = v.object({ _id: v.id("notes"), date: v.string(), body: v.string() });

function validateDate(date: string): string {
  if (!DATE_RE.test(date)) throw new ConvexError("Dates must look like YYYY-MM-DD.");
  return date;
}

function cleanBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new ConvexError("A note can't be empty.");
  if (body.length > NOTE_MAX) throw new ConvexError(`Notes are limited to ${NOTE_MAX} characters.`);
  return body;
}

async function loadNote(ctx: QueryCtx | MutationCtx, session: Session, noteId: Id<"notes">) {
  const note = await ctx.db.get("notes", noteId);
  if (!note) throw new ConvexError("Note not found.");
  await requirePageAccess(ctx, session, note.profileId);
  return note;
}

/** Notes on days in [start, end) — the calendar's visible grid, oldest first. */
export const listRange = query({
  args: { ...sessionArgs, profileId: v.id("profiles"), start: v.string(), end: v.string() },
  returns: v.array(noteSummary),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    await requirePageAccess(ctx, session, args.profileId);
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_profileId_and_date", (q) => q.eq("profileId", args.profileId).gte("date", args.start).lt("date", args.end))
      .take(500);
    return notes.map((n) => ({ _id: n._id, date: n.date, body: n.body }));
  },
});

export const create = mutation({
  args: { ...sessionArgs, profileId: v.id("profiles"), date: v.string(), body: v.string() },
  returns: v.id("notes"),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    await requirePageAccess(ctx, session, args.profileId);
    return await ctx.db.insert("notes", {
      profileId: args.profileId,
      createdByConnectionId: session.connection._id,
      date: validateDate(args.date),
      body: cleanBody(args.body),
    });
  },
});

export const update = mutation({
  args: { ...sessionArgs, noteId: v.id("notes"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const note = await loadNote(ctx, session, args.noteId);
    await ctx.db.patch("notes", note._id, { body: cleanBody(args.body) });
    return null;
  },
});

export const remove = mutation({
  args: { ...sessionArgs, noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionToken);
    const note = await loadNote(ctx, session, args.noteId);
    await ctx.db.delete("notes", note._id);
    return null;
  },
});
