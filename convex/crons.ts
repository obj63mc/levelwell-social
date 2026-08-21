import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Delete published media after the retention window and abandoned uploads.
crons.interval("media cleanup", { hours: 6 }, internal.media.cleanup, {});

export default crons;
