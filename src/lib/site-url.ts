import { createContext, use } from "react";

// The deployment's HTTP-actions origin (https://<name>.convex.site) — where the
// Facebook OAuth callback and the Meta webhooks land. Backend code reads it from
// `env.CONVEX_SITE_URL`; the frontend needs it whenever it has to name or open
// one of those endpoints. Provided in Root.tsx alongside the Convex client.
export const SiteUrlContext = createContext<string | null>(null);

export function useSiteUrl(): string {
  const siteUrl = use(SiteUrlContext);
  if (siteUrl === null) throw new Error("useSiteUrl must be used inside a SiteUrlContext provider");
  return siteUrl;
}
