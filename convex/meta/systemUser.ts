// System-user mode: the Page credential is a never-expiring system user token
// held by the business portfolio that owns the app, rather than something each
// manager brings from their own login.
//
// This exists because Facebook Login for Business refuses to share assets from
// the portfolio that owns the app ("This Meta Business Account owns the app"),
// which is exactly the arrangement here — the app and the Page both live in the
// Level Wellness portfolio. Meta's documented answer for your own portfolio's
// assets is a business integration system user token.
import { env } from "../_generated/server";
import { describeError, graphGet, graphGetAll } from "./client";

export type SystemAccount = {
  id: string;
  name: string;
  category?: string;
  access_token: string;
  tasks?: string[];
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

type Business = { id: string; name?: string };

/** Set → system-user mode. Unset → the legacy per-manager login flow. */
export function systemUserToken(): string | undefined {
  const token = env.META_SYSTEM_USER_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

export function systemUserMode(): boolean {
  return systemUserToken() !== undefined;
}

/**
 * The business portfolio whose members may use this app. Explicit env var wins;
 * otherwise it is the (single) business the system user itself belongs to.
 */
export async function resolveBusinessId(): Promise<string> {
  if (env.META_BUSINESS_ID) return env.META_BUSINESS_ID;
  const token = systemUserToken();
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN is not set.");
  const businesses = await graphGetAll<Business>("me/businesses", { fields: "id,name" }, token);
  if (businesses.length === 0) {
    throw new Error(
      "The system user token does not belong to a business portfolio. Regenerate it with the business_management scope, or set META_BUSINESS_ID.",
    );
  }
  if (businesses.length > 1) {
    throw new Error(
      `The system user belongs to ${businesses.length} business portfolios. Set META_BUSINESS_ID to choose one.`,
    );
  }
  return businesses[0].id;
}

/**
 * Whether the person who just logged in belongs to the portfolio.
 *
 * Asked of the *user's own* token on purpose: `/{business-id}/business_users`
 * returns business-scoped ids that never equal the app-scoped id from `/me`, so
 * comparing those would silently never match. Asking which businesses the user
 * belongs to compares ids that are actually comparable.
 */
export async function userIsBusinessMember(
  userToken: string,
  businessId: string,
): Promise<{ ok: true; member: boolean } | { ok: false; reason: string }> {
  try {
    const businesses = await graphGetAll<Business>("me/businesses", { fields: "id" }, userToken);
    return { ok: true, member: businesses.some((b) => b.id === businessId) };
  } catch (error) {
    // Almost always business_management missing from the granted scopes.
    return {
      ok: false,
      reason: `Could not confirm business portfolio membership: ${describeError(error)}. The login must grant business_management.`,
    };
  }
}

/** The Pages assigned to the system user, each with a non-expiring Page token. */
export async function systemUserPages(): Promise<SystemAccount[]> {
  const token = systemUserToken();
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN is not set.");
  return await graphGetAll<SystemAccount>(
    "me/accounts",
    {
      fields: "id,name,category,access_token,tasks,picture{url},instagram_business_account{id,username,profile_picture_url}",
      limit: 100,
    },
    token,
  );
}

/** Identity-only login: no business assets are requested, so no portfolio dialog. */
export const IDENTITY_SCOPES = ["public_profile", "business_management"];

/** Sanity probe for the settings/diagnostics surface. */
export async function describeSystemUser(): Promise<{ id: string; name: string }> {
  const token = systemUserToken();
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN is not set.");
  return await graphGet<{ id: string; name: string }>("me", { fields: "id,name" }, token);
}
