import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Backstop for publish-time purging: sweeps up cleanly published posts whose
// media survived, abandoned uploads, and leftover tombstone rows.
crons.interval("media cleanup", { hours: 6 }, internal.media.cleanup, {});

// Tops up the local mirror of the Webflow blog collection so the composer's
// picker never has to call Webflow. Self-guards: inert unless WEBFLOW_SITE_TOKEN
// is set and a collection has been mapped in settings.
crons.interval("webflow blog sync", { hours: 24 }, internal.webflow.syncBlogPosts, {});

export default crons;
