import { defineApp } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp({
  // Typed via `env` from ./_generated/server. Set per deployment with `npx convex env set`.
  env: {
    META_APP_ID: v.string(),
    META_APP_SECRET: v.string(),
    // Optional: only used by the legacy Facebook Login for Business flow, which
    // cannot grant assets from the portfolio that owns the app.
    META_LOGIN_CONFIG_ID: v.optional(v.string()),
    META_WEBHOOK_VERIFY_TOKEN: v.string(),
    META_GRAPH_VERSION: v.string(),
    // Setting this switches the app to system-user mode: Page tokens come from a
    // never-expiring system user token instead of each manager's login, and login
    // is reduced to identifying the person.
    META_SYSTEM_USER_TOKEN: v.optional(v.string()),
    // The business portfolio whose members may use the app. Auto-discovered from
    // the system user token when omitted.
    META_BUSINESS_ID: v.optional(v.string()),
    // Optional: setting it is what turns the Webflow CMS cross-posting on.
    WEBFLOW_SITE_TOKEN: v.optional(v.string()),
  },
});

// Publish queue: scheduled + immediate posts run here with retries.
app.use(workpool, { name: "publishPool" });

export default app;
