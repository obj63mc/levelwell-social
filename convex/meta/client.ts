// Minimal Graph API wrapper. Only used from actions / HTTP actions (needs fetch).
import { env } from "../_generated/server";

export function graphVersion(): string {
  return env.META_GRAPH_VERSION;
}

export function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

export class GraphApiError extends Error {
  code: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
  constructor(message: string, code: number, extra: { subcode?: number; type?: string; fbtraceId?: string } = {}) {
    super(message);
    this.name = "GraphApiError";
    this.code = code;
    this.subcode = extra.subcode;
    this.type = extra.type;
    this.fbtraceId = extra.fbtraceId;
  }
  /** Error code 190 = invalid/expired token → the profile needs a reconnect. */
  get needsReconnect(): boolean {
    return this.code === 190;
  }
}

type Params = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, params: Params, token?: string): string {
  const url = path.startsWith("https://") ? new URL(path) : new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  if (token) url.searchParams.set("access_token", token);
  return url.toString();
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphApiError(`Graph API returned non-JSON (${response.status}): ${text.slice(0, 200)}`, response.status);
  }
  if (json && typeof json === "object" && "error" in json) {
    const err = (json as { error: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string } }).error;
    throw new GraphApiError(err.message ?? "Graph API error", err.code ?? response.status, {
      subcode: err.error_subcode,
      type: err.type,
      fbtraceId: err.fbtrace_id,
    });
  }
  return json as T;
}

export async function graphGet<T>(path: string, params: Params = {}, token?: string): Promise<T> {
  const response = await fetch(buildUrl(path, params, token));
  return parse<T>(response);
}

export async function graphPost<T>(path: string, params: Params = {}, token?: string): Promise<T> {
  const response = await fetch(buildUrl(path, params, token), { method: "POST" });
  return parse<T>(response);
}

type Page<T> = { data: T[]; paging?: { next?: string } };

/** GET a list edge and follow `paging.next` until exhausted. */
export async function graphGetAll<T>(path: string, params: Params = {}, token?: string): Promise<T[]> {
  const items: T[] = [];
  let page = await graphGet<Page<T>>(path, params, token);
  items.push(...page.data);
  while (page.paging?.next) {
    // `next` already carries the access token and params.
    page = await graphGet<Page<T>>(page.paging.next);
    items.push(...page.data);
  }
  return items;
}

export function describeError(error: unknown): string {
  if (error instanceof GraphApiError) return `${error.message} (code ${error.code})`;
  if (error instanceof Error) return error.message;
  return String(error);
}
