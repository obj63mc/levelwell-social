import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Backstop for publish-time purging: sweeps up cleanly published posts whose
// media survived, abandoned uploads, and leftover tombstone rows.
crons.interval("media cleanup", { hours: 6 }, internal.media.cleanup, {});

export default crons;
