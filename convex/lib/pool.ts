import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

/** Publish queue. Actions are idempotent (per-channel keys on the post), so retries are safe. */
export const publishPool = new Workpool(components.publishPool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 30_000, base: 2 },
});
