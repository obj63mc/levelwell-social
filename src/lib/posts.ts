import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type PostSummary = FunctionReturnType<typeof api.posts.list>[number];

export const STATUS_LABEL: Record<PostSummary["status"], string> = {
  scheduled: "Scheduled",
  publishing: "Publishing…",
  published: "Published",
  partially_failed: "Partly failed",
  failed: "Failed",
  canceled: "Canceled",
};
