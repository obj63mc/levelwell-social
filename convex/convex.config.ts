import { defineApp } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp({
  // Typed via `env` from ./_generated/server. Set per deployment with `npx convex env set`.
  env: {
    META_APP_ID: v.string(),
    META_APP_SECRET: v.string(),
    META_LOGIN_CONFIG_ID: v.string(),
    META_WEBHOOK_VERIFY_TOKEN: v.string(),
    META_GRAPH_VERSION: v.string(),
  },
});

// Publish queue: scheduled + immediate posts run here with retries.
app.use(workpool, { name: "publishPool" });

export default app;
