import { defineSchema } from "convex/server";
import { authTables } from "@convex-dev/auth/server";

// Convex Auth is installed but not yet used for sign-in.
// Its tables stay in the schema so it can be enabled later without a migration.
export default defineSchema({
  ...authTables,
});
