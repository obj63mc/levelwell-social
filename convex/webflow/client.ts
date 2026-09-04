// Minimal Webflow Data API v2 wrapper. Only used from actions (needs fetch).
// Deliberately shaped like ../meta/client.ts so both integrations read the same.
import { ConvexError } from "convex/values";
import { env } from "../_generated/server";

export const WEBFLOW_BASE = "https://api.webflow.com/v2";

/** The whole feature switch: no token declared on the deployment means "off". */
export function webflowEnabled(): boolean {
  return typeof env.WEBFLOW_SITE_TOKEN === "string" && env.WEBFLOW_SITE_TOKEN.length > 0;
}

function requireToken(): string {
  const token = env.WEBFLOW_SITE_TOKEN;
  if (!token) throw new ConvexError("Webflow is not configured on this deployment.");
  return token;
}

export class WebflowApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, extra: { code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "WebflowApiError";
    this.status = status;
    this.code = extra.code;
    this.details = extra.details;
  }
  /** 401 = the site token was revoked or rotated → settings must be revisited. */
  get needsReconnect(): boolean {
    return this.status === 401;
  }
  /** 409 on a create means the slug is taken. */
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

type Params = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, params: Params): string {
  const url = new URL(`${WEBFLOW_BASE}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new WebflowApiError(`Webflow returned non-JSON (${response.status}): ${text.slice(0, 200)}`, response.status);
  }
  if (!response.ok) {
    const err = json as { message?: string; code?: string; details?: unknown };
    throw new WebflowApiError(err.message ?? `Webflow request failed (${response.status})`, response.status, {
      code: err.code,
      details: err.details,
    });
  }
  return json as T;
}

export async function webflowGet<T>(path: string, params: Params = {}): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    headers: { authorization: `Bearer ${requireToken()}`, accept: "application/json" },
  });
  return parse<T>(response);
}

export async function webflowPost<T>(path: string, body: unknown, params: Params = {}): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireToken()}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parse<T>(response);
}

export type WebflowPage<T> = { items: T[]; pagination?: { limit: number; offset: number; total: number } };

/**
 * Pages a list endpoint 100 at a time. `stopWhen` lets the caller quit early —
 * the blog sync uses it to stop at the first page it has already seen, so a
 * daily run normally costs a single request no matter how big the collection is.
 */
export async function webflowGetAll<T>(
  path: string,
  params: Params = {},
  stopWhen?: (items: T[]) => boolean,
): Promise<T[]> {
  const limit = 100;
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await webflowGet<WebflowPage<T>>(path, { ...params, limit, offset });
    const items = page.items ?? [];
    all.push(...items);
    if (stopWhen?.(items)) break;
    offset += limit;
    const total = page.pagination?.total ?? all.length;
    if (items.length === 0 || offset >= total) break;
  }
  return all;
}

/** User-facing message for anything thrown by this client. */
export function describeWebflowError(error: unknown): string {
  if (error instanceof WebflowApiError) {
    if (error.needsReconnect) return "Webflow rejected the site token. Check WEBFLOW_SITE_TOKEN.";
    if (error.isRateLimited) return "Webflow rate limit reached. Try again in a minute.";
    return `${error.message}${error.code ? ` (${error.code})` : ""}`;
  }
  if (error instanceof ConvexError) return String(error.data);
  return error instanceof Error ? error.message : String(error);
}

/** Webflow requires a unique slug on every item; never leave it to chance. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
  return base || "item";
}
