/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_pool from "../lib/pool.js";
import type * as lib_session from "../lib/session.js";
import type * as media from "../media.js";
import type * as meta_client from "../meta/client.js";
import type * as meta_oauth from "../meta/oauth.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as publish from "../publish.js";
import type * as system from "../system.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  http: typeof http;
  "lib/pool": typeof lib_pool;
  "lib/session": typeof lib_session;
  media: typeof media;
  "meta/client": typeof meta_client;
  "meta/oauth": typeof meta_oauth;
  posts: typeof posts;
  profiles: typeof profiles;
  publish: typeof publish;
  system: typeof system;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  publishPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"publishPool">;
};
