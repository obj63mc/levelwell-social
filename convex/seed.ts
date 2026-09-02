import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * Dev-only demo data for the calendar and queue: `npm run seed` / `npm run seed:clear`.
 *
 * Every row is flagged `demo: true` and inserted straight into the tables — the
 * publish workpool is never touched here, and `posts.enqueue` refuses demo rows,
 * so seeded posts can never reach Meta.
 */

// 8×8 solid-colour PNGs (brand orchid / teal / light blue) so thumbnails render.
const SWATCHES = [
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mPoc1mLFTEMLQkAYjNfwU7aBvMAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNg2LwYOxpaEgA/91WBCVaAzQAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mOInnoJK2IYWhIA141wgW/2a+AAAAAASUVORK5CYII=",
];

const file = v.object({ storageId: v.id("_storage"), sizeBytes: v.number() });
const counts = v.object({ posts: v.number(), media: v.number() });

/** Stores the placeholder images, then inserts the demo rows. */
export const run = internalAction({
  args: {},
  returns: counts,
  handler: async (ctx): Promise<{ posts: number; media: number }> => {
    const files = [];
    for (const swatch of SWATCHES) {
      const bytes = Uint8Array.from(atob(swatch), (c) => c.charCodeAt(0));
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
      files.push({ storageId, sizeBytes: bytes.byteLength });
    }
    return await ctx.runMutation(internal.seed.insert, { files });
  },
});

export const insert = internalMutation({
  args: { files: v.array(file) },
  returns: counts,
  handler: async (ctx, args) => {
    const profile = await ctx.db.query("profiles").first();
    if (!profile) throw new ConvexError("No Page connected yet — sign in through the app first, then run npm run seed.");
    const member = await ctx.db
      .query("pageMembers")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .first();
    if (!member) throw new ConvexError("No Page manager on file — sign in through the app first, then run npm run seed.");
    const connectionId = member.connectionId;

    const mediaIds: Id<"media">[] = [];
    for (const f of args.files) {
      mediaIds.push(
        await ctx.db.insert("media", {
          profileId: profile._id,
          uploadedByConnectionId: connectionId,
          storageId: f.storageId,
          kind: "image",
          mimeType: "image/png",
          sizeBytes: f.sizeBytes,
          width: 8,
          height: 8,
          status: "attached",
          demo: true,
        }),
      );
    }

    // Fake permalinks point at the Page / IG profile rather than a made-up post
    // path, so clicking one in a demo lands somewhere real.
    const fbLink = `https://www.facebook.com/${profile.pageId}`;
    const igLink = profile.igUsername ? `https://www.instagram.com/${profile.igUsername}/` : undefined;
    const igAvailable = !!profile.igUserId;

    const now = new Date();
    const at = (monthOffset: number, day: number, hour: number, minute = 0) =>
      new Date(now.getFullYear(), now.getMonth() + monthOffset, day, hour, minute).getTime();

    const published = (when: number, permalink?: string) => ({ status: "published" as const, publishedAt: when, permalink });
    const failed = (error: string) => ({ status: "failed" as const, error });
    const pending = { status: "pending" as const };

    type Row = Parameters<typeof ctx.db.insert<"posts">>[1];
    const base = {
      profileId: profile._id,
      createdByConnectionId: connectionId,
      ig: { collaborators: [], userTags: [] },
      demo: true,
    };
    const rows: Row[] = [
      // ---- last month: all published, so the previous-month view has something to click.
      {
        ...base,
        caption: "Deep-breathing reset — three minutes, any time of day. Save this one for Monday morning.",
        mediaIds: [mediaIds[0]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(-1, 6, 9, 30),
        status: "published",
        facebook: published(at(-1, 6, 9, 30), fbLink),
        instagram: igAvailable ? published(at(-1, 6, 9, 31), igLink) : undefined,
      },
      {
        ...base,
        caption: "Five foods our nutrition team keeps in the fridge. Full list in the comments 👇",
        fbFirstComment: "Here's the full list: https://levelwell.com/blog/fridge-staples",
        igFirstComment: "Full list on our site — link in bio.",
        mediaIds: [mediaIds[1], mediaIds[2]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "carousel",
        fbFormat: "multi_photo",
        scheduledAt: at(-1, 13, 12, 0),
        status: "published",
        facebook: published(at(-1, 13, 12, 0), fbLink),
        instagram: igAvailable ? published(at(-1, 13, 12, 2), igLink) : undefined,
      },
      {
        ...base,
        caption: "Member spotlight: Dana, six months in and sleeping through the night again.",
        mediaIds: [mediaIds[2]],
        targets: { facebook: false, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(-1, 20, 17, 15),
        status: igAvailable ? "published" : "canceled",
        instagram: igAvailable ? published(at(-1, 20, 17, 15), igLink) : undefined,
      },
      {
        ...base,
        caption: "Reminder: the Thursday mobility class moved to 6:30pm.",
        mediaIds: [mediaIds[0]],
        targets: { facebook: true, instagram: false },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(-1, 26, 8, 0),
        status: "published",
        facebook: published(at(-1, 26, 8, 0), fbLink),
      },
      // ---- this month: a published run, a failure, a partial failure, then the queue ahead.
      {
        ...base,
        caption: "New fall class schedule is live. Same instructors, two more evening slots.",
        mediaIds: [mediaIds[1]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 3, 9, 0),
        status: "published",
        facebook: published(at(0, 3, 9, 0), fbLink),
        instagram: igAvailable ? published(at(0, 3, 9, 1), igLink) : undefined,
      },
      {
        ...base,
        caption: "Hydration check. Yes, this is your sign.",
        mediaIds: [mediaIds[2]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 8, 15, 45),
        status: "partially_failed",
        facebook: published(at(0, 8, 15, 45), fbLink),
        instagram: igAvailable ? failed("Instagram is still processing the media. Retry shortly.") : undefined,
        lastError: "instagram: Instagram is still processing the media. Retry shortly.",
      },
      {
        ...base,
        caption: "Behind the scenes at the Level Wellness kitchen.",
        mediaIds: [mediaIds[0]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 11, 11, 30),
        status: "failed",
        facebook: failed("An unknown error occurred (code 1)"),
        instagram: igAvailable ? failed("An unknown error occurred (code 1)") : undefined,
        lastError: "facebook: An unknown error occurred (code 1)",
      },
      {
        ...base,
        caption: "What one week of consistent sleep does to your resting heart rate.",
        mediaIds: [],
        targets: { facebook: true, instagram: false },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 16, 10, 0),
        status: "published",
        facebook: published(at(0, 16, 10, 0), fbLink),
      },
      {
        ...base,
        caption: "Weekend recipe: the miso greens bowl everyone asked about.",
        fbFirstComment: "Recipe card: https://levelwell.com/recipes/miso-greens",
        mediaIds: [mediaIds[1]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 22, 13, 0),
        status: "scheduled",
        facebook: pending,
        instagram: igAvailable ? pending : undefined,
      },
      {
        ...base,
        caption: "Three mobility drills for desk shoulders.",
        igCaption: "Three mobility drills for desk shoulders 🧘 #mobility #deskjob #levelwell",
        igFirstComment: "Save this for your next work-from-home day.",
        mediaIds: [mediaIds[2]],
        targets: { facebook: true, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 25, 18, 30),
        status: "scheduled",
        facebook: pending,
        instagram: igAvailable ? pending : undefined,
      },
      {
        ...base,
        caption: "Studio closed for the holiday — back on Tuesday.",
        mediaIds: [mediaIds[0]],
        targets: { facebook: true, instagram: false },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(0, 28, 8, 0),
        status: "scheduled",
        facebook: pending,
      },
      {
        ...base,
        caption: "Next month's challenge kicks off. Sign-ups open now.",
        mediaIds: [mediaIds[1]],
        targets: { facebook: false, instagram: igAvailable },
        igFormat: "image",
        fbFormat: "photo",
        scheduledAt: at(1, 2, 9, 0),
        status: igAvailable ? "scheduled" : "canceled",
        instagram: igAvailable ? pending : undefined,
      },
    ];

    for (const row of rows) await ctx.db.insert("posts", row);
    return { posts: rows.length, media: mediaIds.length };
  },
});

/** Removes exactly what `run` inserted, including the stored files. */
export const clear = internalMutation({
  args: {},
  returns: counts,
  handler: async (ctx) => {
    // Dev-only sweep over a tiny table: a `by_demo` index would be schema noise.
    const posts = await ctx.db
      .query("posts")
      // eslint-disable-next-line @convex-dev/no-filter-in-query
      .filter((q) => q.eq(q.field("demo"), true))
      .take(1000);
    for (const post of posts) await ctx.db.delete("posts", post._id);

    const media = await ctx.db
      .query("media")
      // eslint-disable-next-line @convex-dev/no-filter-in-query
      .filter((q) => q.eq(q.field("demo"), true))
      .take(1000);
    for (const m of media) {
      await ctx.storage.delete(m.storageId);
      await ctx.db.delete("media", m._id);
    }
    return { posts: posts.length, media: media.length };
  },
});
