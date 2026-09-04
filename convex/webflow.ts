import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSession, sessionArgs } from "./lib/session";
import {
  describeWebflowError,
  slugify,
  webflowEnabled,
  webflowGet,
  webflowGetAll,
  webflowPost,
  WebflowApiError,
} from "./webflow/client";

// ---------- shapes returned by the Webflow Data API ----------

type Site = { id: string; displayName?: string; shortName?: string };
type Collection = { id: string; displayName?: string; slug?: string };
type Field = {
  id: string;
  slug: string;
  displayName?: string;
  type: string;
  isRequired?: boolean;
  validations?: { collectionId?: string } | null;
};
type CollectionDetail = Collection & { fields: Field[] };
type Item = { id: string; lastUpdated?: string; fieldData?: Record<string, unknown> };

/** Which Webflow field types may be mapped onto each of our four inputs. */
export const FIELD_TYPES = {
  name: ["PlainText"],
  postCopy: ["PlainText", "RichText"],
  blogRef: ["Reference"],
  link: ["Link"],
} as const;

const configFields = v.object({
  name: v.string(),
  postCopy: v.string(),
  blogRef: v.string(),
  link: v.string(),
});

// ---------- config helpers ----------

export async function loadConfig(ctx: QueryCtx | MutationCtx): Promise<Doc<"webflowConfig"> | null> {
  return await ctx.db.query("webflowConfig").first();
}

export const getConfig = internalQuery({
  args: {},
  handler: async (ctx) => await loadConfig(ctx),
});

// ---------- public status ----------

export const status = query({
  args: sessionArgs,
  returns: v.object({
    enabled: v.boolean(),
    config: v.union(
      v.null(),
      v.object({
        siteId: v.string(),
        siteName: v.string(),
        collectionId: v.string(),
        collectionName: v.string(),
        blogCollectionId: v.string(),
        blogCollectionName: v.string(),
        fields: configFields,
        postCopyRequired: v.boolean(),
      }),
    ),
    blogCount: v.number(),
    blogSyncedAt: v.optional(v.number()),
    blogSyncError: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionToken);
    if (!webflowEnabled()) return { enabled: false, config: null, blogCount: 0 };
    const config = await loadConfig(ctx);
    if (!config) return { enabled: true, config: null, blogCount: 0 };
    // Bounded by the picker's usefulness, not the collection size.
    const posts = await ctx.db
      .query("webflowBlogPosts")
      .withIndex("by_collectionId", (q) => q.eq("collectionId", config.blogCollectionId))
      .take(5000);
    return {
      enabled: true,
      config: {
        siteId: config.siteId,
        siteName: config.siteName,
        collectionId: config.collectionId,
        collectionName: config.collectionName,
        blogCollectionId: config.blogCollectionId,
        blogCollectionName: config.blogCollectionName,
        fields: config.fields,
        postCopyRequired: config.postCopyRequired,
      },
      blogCount: posts.length,
      blogSyncedAt: config.blogSyncedAt,
      blogSyncError: config.blogSyncError,
    };
  },
});

// ---------- discovery (settings screen) ----------

export const discover = action({
  args: sessionArgs,
  handler: async (ctx, args): Promise<{ sites: { id: string; name: string; collections: { id: string; name: string }[] }[] }> => {
    await ctx.runQuery(internal.webflow.requireCaller, { sessionToken: args.sessionToken });
    const { sites } = await webflowGet<{ sites: Site[] }>("sites");
    const out = [];
    for (const site of sites) {
      const { collections } = await webflowGet<{ collections: Collection[] }>(`sites/${site.id}/collections`);
      out.push({
        id: site.id,
        name: site.displayName ?? site.shortName ?? site.id,
        collections: collections.map((c) => ({ id: c.id, name: c.displayName ?? c.slug ?? c.id })),
      });
    }
    return { sites: out };
  },
});

export const describeCollection = action({
  args: { ...sessionArgs, collectionId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: string; name: string; fields: { slug: string; name: string; type: string; required: boolean; refCollectionId?: string }[] }> => {
    await ctx.runQuery(internal.webflow.requireCaller, { sessionToken: args.sessionToken });
    const detail = await webflowGet<CollectionDetail>(`collections/${args.collectionId}`);
    return {
      id: detail.id,
      name: detail.displayName ?? detail.slug ?? detail.id,
      fields: (detail.fields ?? []).map((f) => ({
        slug: f.slug,
        name: f.displayName ?? f.slug,
        type: f.type,
        required: f.isRequired === true,
        refCollectionId: f.validations?.collectionId,
      })),
    };
  },
});

/** Session check usable from an action (actions have no ctx.db). */
export const requireCaller = internalQuery({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionToken);
    if (!webflowEnabled()) throw new ConvexError("Webflow is not configured on this deployment.");
    return null;
  },
});

// ---------- saving the config ----------

export const writeConfig = internalMutation({
  args: {
    siteId: v.string(),
    siteName: v.string(),
    collectionId: v.string(),
    collectionName: v.string(),
    blogCollectionId: v.string(),
    blogCollectionName: v.string(),
    fields: configFields,
    postCopyRequired: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await loadConfig(ctx);
    const patch = { ...args, updatedAt: Date.now() };
    if (existing) {
      // Re-pointing at a different blog collection invalidates the watermark.
      const reset = existing.blogCollectionId !== args.blogCollectionId;
      await ctx.db.patch("webflowConfig", existing._id, {
        ...patch,
        ...(reset ? { blogSyncCursor: undefined, blogSyncedAt: undefined, blogSyncError: undefined } : {}),
      });
    } else {
      await ctx.db.insert("webflowConfig", patch);
    }
    return null;
  },
});

export const saveConfig = action({
  args: {
    ...sessionArgs,
    siteId: v.string(),
    siteName: v.string(),
    collectionId: v.string(),
    fields: configFields,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.webflow.requireCaller, { sessionToken: args.sessionToken });
    // Re-read the collection so a stale settings screen can't save a broken mapping.
    const detail = await webflowGet<CollectionDetail>(`collections/${args.collectionId}`);
    const bySlug = new Map((detail.fields ?? []).map((f) => [f.slug, f]));
    for (const [key, slug] of Object.entries(args.fields) as [keyof typeof FIELD_TYPES, string][]) {
      const field = bySlug.get(slug);
      if (!field) throw new ConvexError(`The field "${slug}" no longer exists on this collection.`);
      if (!(FIELD_TYPES[key] as readonly string[]).includes(field.type)) {
        throw new ConvexError(`"${field.displayName ?? slug}" is a ${field.type} field and cannot be used here.`);
      }
    }
    const postCopy = bySlug.get(args.fields.postCopy)!;
    const blogRef = bySlug.get(args.fields.blogRef)!;
    const blogCollectionId = blogRef.validations?.collectionId;
    if (!blogCollectionId) throw new ConvexError("That reference field is not linked to a collection.");
    const blog = await webflowGet<CollectionDetail>(`collections/${blogCollectionId}`);

    await ctx.runMutation(internal.webflow.writeConfig, {
      siteId: args.siteId,
      siteName: args.siteName,
      collectionId: args.collectionId,
      collectionName: detail.displayName ?? detail.slug ?? args.collectionId,
      blogCollectionId,
      blogCollectionName: blog.displayName ?? blog.slug ?? blogCollectionId,
      fields: args.fields,
      postCopyRequired: postCopy.isRequired === true,
    });
    await ctx.runAction(internal.webflow.syncBlogPosts, {});
    return null;
  },
});

// ---------- blog post mirror ----------

export const upsertBlogPosts = internalMutation({
  args: {
    collectionId: v.string(),
    items: v.array(v.object({ itemId: v.string(), name: v.string(), slug: v.string(), lastUpdated: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let added = 0;
    for (const item of args.items) {
      const existing = await ctx.db
        .query("webflowBlogPosts")
        .withIndex("by_collectionId_and_itemId", (q) => q.eq("collectionId", args.collectionId).eq("itemId", item.itemId))
        .unique();
      if (existing) {
        await ctx.db.patch("webflowBlogPosts", existing._id, item);
      } else {
        await ctx.db.insert("webflowBlogPosts", { collectionId: args.collectionId, ...item });
        added++;
      }
    }
    return added;
  },
});

export const recordSync = internalMutation({
  args: { cursor: v.optional(v.string()), error: v.optional(v.string()), clearCursor: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const config = await loadConfig(ctx);
    if (!config) return null;
    await ctx.db.patch("webflowConfig", config._id, {
      blogSyncedAt: args.error ? config.blogSyncedAt : Date.now(),
      blogSyncError: args.error,
      ...(args.clearCursor ? { blogSyncCursor: undefined } : args.cursor ? { blogSyncCursor: args.cursor } : {}),
    });
    return null;
  },
});

function itemName(item: Item): string {
  const data = item.fieldData ?? {};
  return typeof data.name === "string" ? data.name : "(untitled)";
}

function itemSlug(item: Item): string {
  const data = item.fieldData ?? {};
  return typeof data.slug === "string" ? data.slug : "";
}

/**
 * The only thing that ever asks Webflow for blog posts. Sorted newest-first, it
 * stops at the first page it has already seen, so the daily run normally costs a
 * single request however large the collection grows. Never deletes: an item
 * removed in Webflow just lingers in the picker and would not be chosen.
 */
export const syncBlogPosts = internalAction({
  args: { full: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!webflowEnabled()) return null;
    const config: Doc<"webflowConfig"> | null = await ctx.runQuery(internal.webflow.getConfig, {});
    if (!config) return null;
    if (args.full) await ctx.runMutation(internal.webflow.recordSync, { clearCursor: true });
    const cursor = args.full ? undefined : config.blogSyncCursor;

    try {
      let newest: string | undefined;
      const items = await webflowGetAll<Item>(
        `collections/${config.blogCollectionId}/items`,
        { sortBy: "lastUpdated", sortOrder: "desc" },
        // Stop as soon as a page is entirely at-or-older than the watermark.
        (page) => {
          if (!cursor) return false;
          return page.length === 0 || page.every((i) => (i.lastUpdated ?? "") <= cursor);
        },
      );
      const fresh = cursor ? items.filter((i) => (i.lastUpdated ?? "") > cursor) : items;
      for (const item of fresh) {
        const stamp = item.lastUpdated ?? "";
        if (!newest || stamp > newest) newest = stamp;
      }
      // Chunked so one mutation never walks an unbounded list.
      for (let i = 0; i < fresh.length; i += 200) {
        await ctx.runMutation(internal.webflow.upsertBlogPosts, {
          collectionId: config.blogCollectionId,
          items: fresh.slice(i, i + 200).map((item) => ({
            itemId: item.id,
            name: itemName(item),
            slug: itemSlug(item),
            lastUpdated: item.lastUpdated ?? "",
          })),
        });
      }
      await ctx.runMutation(internal.webflow.recordSync, { cursor: newest ?? cursor, error: undefined });
    } catch (error) {
      // A bad day at Webflow records itself instead of turning into a red cron.
      await ctx.runMutation(internal.webflow.recordSync, { error: describeWebflowError(error) });
    }
    return null;
  },
});

/** The Refresh button in Webflow settings. */
export const refreshBlogPosts = action({
  args: { ...sessionArgs, full: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.webflow.requireCaller, { sessionToken: args.sessionToken });
    await ctx.runAction(internal.webflow.syncBlogPosts, { full: args.full });
    return null;
  },
});

/**
 * The composer's picker. A pure query over our own mirror — reactive, instant,
 * and zero Webflow API calls while composing.
 */
export const searchBlogPosts = query({
  args: { ...sessionArgs, q: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ itemId: v.string(), name: v.string(), slug: v.string() })),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionToken);
    const config = await loadConfig(ctx);
    if (!config || !webflowEnabled()) return [];
    const rows = await ctx.db
      .query("webflowBlogPosts")
      .withIndex("by_collectionId", (q) => q.eq("collectionId", config.blogCollectionId))
      .take(5000);
    const needle = args.q.trim().toLowerCase();
    const matches = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
    return matches
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, args.limit ?? 20)
      .map((r) => ({ itemId: r.itemId, name: r.name, slug: r.slug }));
  },
});

// ---------- creating the CMS item ----------

type CreatedItem = { id: string; fieldData?: { slug?: string } };

/**
 * Creates the live CMS item for a published post. Throws on failure — the caller
 * in publish.ts is what guarantees a failure never touches the post's status.
 */
export const createItemForPost = internalAction({
  args: {
    name: v.string(),
    postCopy: v.optional(v.string()),
    blogItemId: v.optional(v.string()),
    link: v.optional(v.string()),
  },
  returns: v.object({ itemId: v.string(), itemSlug: v.string() }),
  handler: async (ctx, args): Promise<{ itemId: string; itemSlug: string }> => {
    const config: Doc<"webflowConfig"> | null = await ctx.runQuery(internal.webflow.getConfig, {});
    if (!config) throw new ConvexError("Webflow is not set up yet.");
    const { fields } = config;

    const create = async (slug: string) => {
      const fieldData: Record<string, unknown> = {
        [fields.name]: args.name,
        slug,
      };
      // A required field rejects "", and an optional one is better left unset.
      if (args.postCopy) fieldData[fields.postCopy] = args.postCopy;
      // A Reference value is the referenced item's id as a bare string.
      if (args.blogItemId) fieldData[fields.blogRef] = args.blogItemId;
      if (args.link) fieldData[fields.link] = args.link;
      return await webflowPost<CreatedItem>(`collections/${config.collectionId}/items/live`, {
        isArchived: false,
        isDraft: false,
        fieldData,
      });
    };

    const base = slugify(args.name);
    let created: CreatedItem;
    try {
      created = await create(base);
    } catch (error) {
      // A taken slug is the one failure worth retrying automatically.
      if (error instanceof WebflowApiError && error.isConflict) {
        const suffix = Math.floor(Math.random() * 0xffff)
          .toString(16)
          .padStart(4, "0");
        created = await create(`${base}-${suffix}`);
      } else {
        throw error;
      }
    }
    return { itemId: created.id, itemSlug: created.fieldData?.slug ?? base };
  },
});

// ---------- validation shared with posts.create ----------

export const webflowInput = v.object({
  name: v.string(),
  postCopy: v.optional(v.string()),
  blogItemId: v.optional(v.string()),
  blogItemName: v.optional(v.string()),
  link: v.optional(v.string()),
});

export function validateWebflowInput(
  input: { name: string; postCopy?: string; blogItemId?: string; link?: string },
  postCopyRequired = false,
) {
  if (!input.name.trim()) throw new ConvexError("Give the Webflow item a name.");
  if (postCopyRequired && !input.postCopy?.trim()) throw new ConvexError("Post Copy is required by this Webflow collection.");
  if (!input.blogItemId && !input.link?.trim()) {
    throw new ConvexError("Select a blog post or provide a link for Webflow.");
  }
  if (input.link?.trim()) {
    try {
      const url = new URL(input.link.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
    } catch {
      throw new ConvexError("The Webflow link must be a full http(s) URL.");
    }
  }
}
