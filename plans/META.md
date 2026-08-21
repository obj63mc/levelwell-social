# Meta Developer Platform — App Creation & Configuration Runbook

Everything needed on the Meta side (developers.facebook.com) before LevelWell Social can post. Facts verified against Meta docs as of Aug 2026. The Graph API version is pinned in the Convex env var `META_GRAPH_VERSION` (**v26.0** today); plan an annual bump — Meta ships ~3 versions/year, each supported ~2 years.

## 1. Account & Profile Prerequisites

- [x] A Facebook account with a **Meta developer account** (register at [developers.facebook.com](https://developers.facebook.com) — instant, free).
- [x] For each profile the app will manage:
  - [x] The Instagram account is converted to **Professional** (Business or Creator): Instagram app → Settings → Account type.
  - [x] The IG professional account is **linked to a Facebook Page** you admin (Page Settings → Linked accounts → Instagram). This link is what makes the IG account reachable through the Facebook-Login token chain.
  - [x] You are an **admin** of the Facebook Page (full control).

## 2. Create the App

- [x] developers.facebook.com → My Apps → **Create App** (use-case-based flow):
  - App type/path: **Business**.
  - Add use cases covering: **Pages management/publishing** ("Manage everything on your Page") and the **Instagram Graph API** with Facebook Login (the FB-Login flavor of the Instagram API — chosen because one OAuth grant covers Page + linked IG, and Page tokens never expire).
- [x] App Settings → Basic: record **App ID** and **App Secret** → store as Convex env vars (`META_APP_ID`, `META_APP_SECRET`; see [`CONVEX.md`](./CONVEX.md) §2). The secret lives only in Convex.
- [x] Do **not** set the app category to Native/Desktop in Advanced settings — token exchange happens server-side in Convex, which is exactly Meta's recommended pattern, and Native/Desktop mode disables secret-based server calls.

## 3. Facebook Login for Business Configuration

Business permissions on newer apps are requested via a **Configuration** rather than raw scopes:

- [x] Products → Facebook Login for Business → Configurations → **Create configuration**.
- [x] Include these permissions:

  | Permission | Why |
  |---|---|
  | `pages_show_list` | List the user's Pages during connect |
  | `pages_read_engagement` | Read Page content/engagement (required companion) |
  | `pages_manage_posts` | Publish/schedule Page posts |
  | `pages_manage_engagement` | Create comments as the Page (first comment, replies) |
  | `pages_read_user_content` | Read visitor comments on Page posts (inbox) |
  | `pages_manage_metadata` | Subscribe the Page to webhooks (`/subscribed_apps`) |
  | `instagram_basic` | Read the linked IG account |
  | `instagram_content_publish` | Publish to IG |
  | `instagram_manage_comments` | Read/create/reply IG comments |
  | `business_management` | Business-asset traversal during connect |

- [x] Record the **`config_id`** → Convex env var `META_LOGIN_CONFIG_ID`. The authorize URL uses `config_id` (not `scope`).

## 4. OAuth Redirect Configuration

- [x] Facebook Login for Business → Settings → **Valid OAuth Redirect URIs**: add both Convex deployments:
  - `https://<dev-deployment>.convex.site/oauth/callback`
  - `https://<prod-deployment>.convex.site/oauth/callback`
- [x] Flow implemented (`convex/meta/oauth.ts`, `convex/http.ts`): desktop app opens the system browser → `https://www.facebook.com/{version}/dialog/oauth?client_id=…&config_id=…&state=…&redirect_uri=…` → Meta redirects to the Convex HTTP action → callback verifies `state`, exchanges `code` for a short-lived user token, upgrades it via `grant_type=fb_exchange_token` (long-lived, ~60 days), calls `GET /me/accounts` to derive **Page access tokens (no expiration)**, resolves the linked IG account via `GET /{page-id}?fields=instagram_business_account`, stores all of it, and renders a "connected — return to the app" page.
- [x] Smoke-test early: `.convex.site` is a standard HTTPS domain and should be accepted, but verify the redirect round-trip before building on it.

## 5. Webhooks (comments inbox)

The endpoint is live in `convex/http.ts` (GET handshake, POST HMAC validation → `webhookEvents` table). Verified with curl against the dev deployment.

- [ ] Products → **Webhooks** → add product.
- [ ] Callback URL: `https://<dev-deployment>.convex.site/webhooks/meta`; Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`. Meta allows **one callback URL per topic per app**, so the dev deployment receives events for now; switch to prod when going Live.
  - Self-check before clicking Verify: `curl "https://<dev>.convex.site/webhooks/meta?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123"` must print `123`.
- [ ] Subscribe fields:
  - **Instagram** topic → `comments` field.
  - **Page** topic → `feed` field (covers comments on Page posts).
- [x] Per connected Page the connect flow calls `POST /{page-id}/subscribed_apps?subscribed_fields=feed` (requires `pages_manage_metadata`); result is shown on the Dashboard profile card (`webhookSubscribed`).
- [x] Every webhook POST is validated: `X-Hub-Signature-256` HMAC-SHA256 over the raw body using the App Secret; invalid → 401, not stored.
- [ ] **Delivery caveat:** in Development mode, webhooks fire only for activity by app-role users. Real followers' comments arrive via the polling sweep until the app is Live. Plan already accounts for this (hybrid inbox).

## 6. App Mode, Roles & Review

**Now (personal use): stay in Development mode — indefinitely, legitimately.**

- Development mode grants automatic **Standard Access** to all permissions for accounts holding an app role. Meta explicitly does not require App Review for developers using the API for themselves.
- [ ] Ensure your own account is app **Admin** (it is, as creator). Add any collaborators as **Testers** (they must accept the invite).
- The Pages/IG accounts used must belong to role-holding users.

**Later (distribution / Live mode):**

- [ ] **App Review** per permission: use-case descriptions + screencast of the app exercising each permission (~2–4 weeks).
- [ ] **Business Verification** of a business entity (required for Advanced Access to business permissions); Tech Provider verification if serving other businesses.
- [ ] Privacy Policy URL, App Icon, Data Deletion instructions URL — required before switching Live.
- The Convex architecture already matches what review expects (hosted service holds the secret; tokens server-side) — going Live is process work, not re-architecture. Going Live is also what unlocks webhook delivery for non-role users.

## 7. API Behavior Cheat Sheet (implementation-relevant)

### Tokens
- User token: short-lived (hours) → long-lived (~60 d) via `fb_exchange_token` (server-side, needs App Secret).
- **Page tokens from a long-lived user token do not expire** (invalidated only by password change, deauthorization, or security events). Store per-Page; re-run connect flow to recover from invalidation. Handle Graph error code 190 (invalid token) by flagging the profile "needs reconnect".

### Publishing
- FB Page: `POST /{page-id}/feed` (text/link), `/photos`, `/videos`, `/video_reels`. Native scheduling: `published=false&scheduled_publish_time=<unix>` — min 10 min ahead; max per docs 75 days but reports suggest ~30 — **probe empirically**.
- Instagram: `POST /{ig-user-id}/media` → poll `GET /{container-id}?fields=status_code` until `FINISHED` → `POST /{ig-user-id}/media_publish?creation_id=…`.
  - Media must be **publicly downloadable URLs** (Convex `storage.getUrl()`); no binary image upload. Containers expire after 24 h — create them at publish time, not at schedule time.
  - Types: image; single video **must be `media_type=REELS`**; `STORIES`; `CAROUSEL` (2–10 children, each `is_carousel_item=true`; reels can't be carousel children).
  - **No native IG scheduling** — our Convex scheduler is the mechanism.
  - Quota: ~100 API posts per rolling 24 h per IG account (docs inconsistent, 50 vs 100) — treat `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config` as ground truth; check before publishing and surface in the UI.

### Comments
- First comment: IG `POST /{ig-media-id}/comments?message=…`; FB `POST /{page-post-id}/comments?message=…` (authored as the Page).
- Replies: IG `POST /{ig-comment-id}/replies`; FB comment on the comment id.
- Read/poll: `GET /{ig-media-id}/comments`, `GET /{page-post-id}/comments` with paging cursors.

## 8. Setup Completion Checklist

- [x] IG account(s) Professional + linked to admin'd Page(s)
- [x] Business-type app created with Pages + Instagram use cases
- [x] App ID / App Secret stored in Convex env vars
- [x] Facebook Login for Business configuration created; `config_id` stored
- [x] OAuth redirect URIs (dev + prod `.convex.site`) registered and round-trip tested
- [ ] Webhooks product configured (callback verified, IG `comments` + Page `feed` subscribed)
- [ ] App remains in Development mode; roles confirmed
- [ ] Test: full connect flow yields a Page token + IG user id; a test post publishes to both platforms
