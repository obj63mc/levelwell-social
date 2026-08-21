# LevelWell Social — Overall Plan

A macOS desktop app for posting and scheduling content to Facebook Pages and Instagram professional accounts via Meta's Graph APIs, with first-comment automation and a real-time comments inbox.

Companion documents:

- [`CONVEX.md`](./CONVEX.md) — Convex backend setup and platform facts
- [`META.md`](./META.md) — Meta developer app creation, profile prerequisites, and configuration tasks
- [`UI.md`](./UI.md) — page-by-page UI inventory (what each screen contains)
- [`SETUP.md`](./SETUP.md) — macOS development environment

## Goals & Decisions

| Decision | Choice |
|---|---|
| Platforms posted to | Facebook Pages + Instagram professional accounts (Meta Graph API, version pinned in the `META_GRAPH_VERSION` env var — v26.0 today) |
| Desktop client | **Tauri v2** (macOS; ~3–10 MB bundle, system WKWebView — far lighter than Electron) |
| Backend | **Convex** — database, post queue, scheduled tasks, file storage, and *all* Graph API traffic |
| Audience | Personal use now (Meta app stays in Development mode — no App Review); architected for multi-user distribution later |
| Scheduling | Server-side via Convex scheduled functions — posts publish on time even when the Mac is off |
| First comment | Automated step in the publish pipeline, retried independently of the post |
| Inbox v1 | Comments on app-published posts; **webhook-driven, email-client UX** with a polling sweep as dev-mode path + reconciliation |

Why Convex (vs. a purely local app): it solves the three hardest problems at once — durable exact-time scheduling that doesn't depend on the Mac being awake; public long-lived file URLs, which Instagram's API requires for media; and a public HTTPS surface for the OAuth redirect and Meta webhooks. It also keeps the Meta app secret and all access tokens server-side, which is both safer and the exact shape Meta expects when the app later goes through App Review for distribution.

## Architecture

```
┌──────────── Tauri v2 macOS app (thin client) ────────────┐
│ WebView UI (React + convex client, WebSocket reactive)   │
│  Connect ▸ Dashboard (calendar) ▸ Composer ▸ Inbox ▸ … │
│ Rust shell: tray, notifications, media file pick/drag,   │
│  open system browser for OAuth                           │
└───────────────┬──────────────────────────────────────────┘
                │ Convex queries/mutations/actions + file upload URLs
┌───────────────▼────────────── Convex deployment ─────────────────────┐
│ Database: profiles (page/ig ids, tokens), posts, schedule queue,     │
│   comments, publish results/errors                                   │
│ File storage: post media (public URLs — consumed by Meta for IG)     │
│ HTTP actions (…convex.site):                                         │
│   /oauth/callback  ← Meta Facebook Login redirect URI                │
│   /webhooks/meta   ← comment webhooks (verify + signed payloads)     │
│ Actions (server-side fetch → graph.facebook.com/{version}):            │
│   token exchange & Page-token derivation (app secret in env vars)    │
│   publish pipelines (FB feed/photos/videos, IG container→publish)    │
│   first-comment step, comment polling, replies                       │
│ Scheduler: ctx.scheduler.runAt per post; crons for comment polling,  │
│   token health checks, media cleanup                                 │
└──────────────────────────────────────────────────────────────────────┘
                │ HTTPS
        Meta Graph API (Facebook Pages + Instagram)
```

The desktop client is deliberately thin: the React UI talks to Convex with the official `convex` client (reactive WebSocket queries → live queue/inbox updates with no refresh; works in Tauri's WKWebView — allow the Convex URL in the Tauri CSP). The Rust side handles shell concerns only: menu-bar/tray presence, macOS notifications, native file pickers and drag-drop for media, and opening the system browser for OAuth. Little to no custom Rust business logic.

Frameworks considered and rejected for the client: native Swift/SwiftUI (best OS integration but much slower path to a polished multi-pane UI; Convex is TS/React-first), Wails v3 (still beta), Flutter (~30–60 MB, non-native feel), Compose Desktop (JVM footprint), .NET MAUI (Mac Catalyst is wrong for menu-bar apps).

## Meta API Strategy

Full details and setup tasks in [`META.md`](./META.md). The load-bearing facts:

- **API flavor: Instagram API with Facebook Login** (`graph.facebook.com`). One Facebook OAuth grant covers a Page *and* its linked IG professional account, and Page tokens derived from a long-lived user token **never expire** — the best token story available. The newer "Instagram API with Instagram Login" flavor (no Page needed, 60-day refreshable tokens) can be added later for IG-only users; both products can coexist on one Meta app.
- **OAuth is server-side**: the app opens the system browser to Meta's authorize URL (Facebook Login for Business `config_id` + `state` minted by a Convex mutation); the redirect URI is the Convex HTTP action `https://<deployment>.convex.site/oauth/callback`, which verifies `state`, exchanges the code, derives long-lived user + Page tokens, and stores everything server-side. Nothing secret ever touches the desktop.
- **Instagram has no native scheduling** and containers expire after 24 h — our scheduler is the only mechanism. Facebook Pages *do* support native `scheduled_publish_time` (min 10 min out; max 75 days per docs, ~30 days per some reports — probe empirically); exposed as an optional per-post toggle, not load-bearing.
- **IG media must be a public URL** (`image_url`/`video_url` — Meta downloads it; no binary upload for images). Convex `ctx.storage.getUrl()` provides exactly that. FB accepts binary upload but uses the same URL path for one pipeline.
- **IG publish quota**: ~100 API-published posts per rolling 24 h per account (docs are inconsistent, 50 vs 100) — read live usage from `GET /{ig-user-id}/content_publishing_limit` and surface it in the UI.
- IG media types: single image; single video **must be `media_type=REELS`**; `STORIES` (no stickers/links via API); `CAROUSEL` of 2–10 child containers.

### Publishing endpoints (reference)

| Action | Endpoint |
|---|---|
| FB text/link post | `POST /{page-id}/feed` (`message`, `link`) |
| FB photo | `POST /{page-id}/photos` |
| FB video / reel | `POST /{page-id}/videos`, `/{page-id}/video_reels` |
| FB native scheduling | `published=false` + `scheduled_publish_time` on the above |
| IG publish | `POST /{ig-user-id}/media` (container) → poll `status_code=FINISHED` → `POST /{ig-user-id}/media_publish?creation_id=…` |
| First comment | IG: `POST /{ig-media-id}/comments` · FB: `POST /{page-post-id}/comments` (authored as Page) |
| Reply | IG: `POST /{ig-comment-id}/replies` · FB: comment on the comment id |
| Read comments | Webhooks (IG `comments` field; Page `feed`) into `/webhooks/meta`, plus `GET …/comments` polling sweep |

## Scheduling & Queue (Convex-native)

- A scheduled post is a document: `status ∈ {draft, scheduled, publishing, published, failed, canceled}`, `scheduledAt`, `attempts`, `lastError`, and the id of its pending scheduled function.
- A mutation writes the post and calls `ctx.scheduler.runAt(scheduledAt, …)` — scheduling from a mutation is transactional and durable (persisted, survives restarts, up to 1M outstanding jobs on every plan). Edit/cancel = `ctx.scheduler.cancel(id)` + re-arm.
- **Retry semantics**: scheduled *mutations* are exactly-once; scheduled *actions* are at-most-once with no auto-retry. So `runAt` targets an internal mutation that marks the post `publishing` and hands the Graph API work to **`@convex-dev/workpool`** (backoff retries, concurrency limits, `onComplete`). The multi-step IG flow (container → poll → publish → first comment) may graduate to **`@convex-dev/workflow`** (durable steps); start with workpool + an in-action polling loop.
- Idempotency: status transitions via mutation before each Graph call; the IG `creation_id` is recorded on the post so a retried step never double-posts.
- **`@convex-dev/rate-limiter`** guards Meta quotas alongside the live `content_publishing_limit` check.
- The UI shows live status via reactive queries; success/failure also fires a macOS notification when the app is running.

## Media Pipeline

- Composer uploads media → `ctx.storage.generateUploadUrl()` → Convex file storage; posts reference storage IDs. (Upload URLs expire in 1 h; the upload POST has a 2-minute timeout — fine for images/normal video, a constraint for ~1 GB reels on slow uplinks; fallback is IG's resumable direct video upload via `rupload.facebook.com`.)
- At publish time the action passes `ctx.storage.getUrl(mediaId)` (public, non-expiring) to Meta.
- A cleanup cron deletes media after successful publish (configurable retention) — limits public-URL exposure and keeps storage within plan limits. Note Meta's downloads count as file egress (free tier: 1 GB/mo) — heavy video posting is the first paid trigger; images are a non-issue.

## First Comment & Inbox

- The publish pipeline ends with an optional `first_comment` step, retried independently (post success + comment failure ≠ post failure).
- **Webhooks (primary)**: `/webhooks/meta` handles Meta's GET verification handshake (`hub.challenge` + verify token from env vars) and validates POSTed events via `X-Hub-Signature-256` HMAC (app secret), then upserts comments (dedup by platform comment id) marked unread.
- **Email-client UX for free**: the inbox is a reactive Convex query — a webhook insert appears in the open UI instantly over WebSocket. Unread counts badge the tray icon; the Rust shell fires a macOS "New comment on <post>" notification.
- **Dev-mode caveat → hybrid**: in Development mode Meta only delivers webhooks for app-role users' activity; real followers' comments won't fire webhooks until the app is Live (which requires App Review). A low-frequency polling cron (per-post cursor over app-published posts) therefore runs regardless — the guaranteed path during dev mode and reconciliation for missed deliveries once Live. Same table, same UI.
- Reply = mutation → action → platform comment/reply endpoint, written into the thread optimistically and confirmed by the action result.

## App Auth (desktop → Convex)

- **The Facebook login is the app login** — no separate sign-in. A successful Meta OAuth mints an app session (`sessions`, hashed) that the desktop sends as `sessionToken` with every call (`convex/lib/session.ts`). Sensitive functions are `internal*`; public queries never return access tokens.
- **Identity vs. content scope**: identity = the Meta user (`connections`); content (posts, calendar, inbox, DMs) belongs to the **Facebook Page** (`profiles`) and is shared by every Meta user who admins that Page (`pageMembers`, rebuilt from `/me/accounts` at each login). Two managers therefore see and manage the same content; each acts with their own Page token. Details in [`CONVEX.md`](./CONVEX.md#auth-app-users).

## Repository Layout (to be created)

```
levelwell-social/
├─ convex/                    # Convex backend (TypeScript)
│  ├─ schema.ts               # connections, profiles, oauthStates, webhookEvents (+ posts, comments, media later)
│  ├─ convex.config.ts        # typed META_* env vars
│  ├─ http.ts                 # HTTP actions: /oauth/callback, /webhooks/meta
│  ├─ lib/session.ts          # requireSession / requirePageAccess / pageTokenFor
│  ├─ profiles.ts             # connectionStatus / list (token-free shapes)
│  ├─ webhooks.ts             # signature check, raw event storage
│  ├─ meta/                   # Graph API layer
│  │  ├─ client.ts            # typed fetch wrapper, error mapping, paging
│  │  ├─ oauth.ts             # start/status, code→token→long-lived→Page-token chain, webhook subscribe
│  │  ├─ publishFacebook.ts   # feed/photos/videos (+ optional native scheduling)
│  │  ├─ publishInstagram.ts  # container → status poll → media_publish
│  │  └─ comments.ts          # first comment, replies, comment polling
│  ├─ posts.ts                # mutations/queries: compose, schedule, cancel, reschedule
│  ├─ publish.ts              # internal action: publish pipeline + first-comment step
│  ├─ inbox.ts                # webhook upsert, poll cron target, reply mutation/action
│  ├─ crons.ts                # comment polling sweep, media cleanup, token health
│  └─ media.ts                # generateUploadUrl, storage-URL helpers
├─ src/                       # desktop frontend (React + TS + Vite + convex client)
│  ├─ views/ (ConnectMeta, Dashboard; Composer, Inbox, Settings… later)
│  ├─ components/ (ui/ = shadcn, icons.tsx = brand glyphs)
│  └─ lib/ (utils, openExternal)
├─ src-tauri/                 # thin Rust shell (tray, notifications, browser open, drag-drop)
└─ plans/                     # this plan + setup runbooks
```

## Build Phases

1. **Foundation** — ✅ Convex project + Tauri v2 scaffold with React, shadcn/ui and the convex client; no end-user auth in v1.
2. **Connect** — ✅ First-launch Connect screen → Meta OAuth via `/oauth/callback`; token chain to never-expiring Page tokens stored server-side; Pages subscribed to webhooks; `/webhooks/meta` handshake + HMAC validation storing raw events; Dashboard shell listing connected Pages + linked IG accounts.
2c. **Sessions & Page scoping** — ✅ Convex Auth removed; app sessions claimed after Meta login; Pages shared across managers via `pageMembers`.
2b. **Dashboard calendar** — month calendar of scheduled posts with Facebook/Instagram icons per day linking to the in-app post (see [`UI.md`](./UI.md)); designed in the UI session.
3. **Composer + immediate publish** — media upload to Convex storage; per-platform caption overrides; publish-now pipelines for FB and IG; first-comment step; result notifications.
4. **Scheduling** — `scheduler.runAt` per post with cancel/re-arm on edit; Calendar/Queue view with live status; workpool retries/backoff; optional FB native-scheduling toggle.
5. **Inbox v1** — process stored `webhookEvents` into comments; polling cron; unified reactive inbox with reply, read/unread, tray badge, notifications.
6. **Polish** — IG quota display, media-cleanup cron, empirical probe of FB scheduling window, app icon + notarization.

*(Per-page UI: [`UI.md`](./UI.md). Calendar, Composer and Inbox design: follow-up UI session.)*

## Verification

- **Backend**: `convex dev` + vitest with `convex-test` for queue state transitions (including crash-during-publish idempotency and cancel/re-arm); Graph client tests against recorded fixtures.
- **End-to-end (manual, real Meta dev app)**: connect a real Page + IG account (app-role accounts, Development mode); publish an image post to both platforms with first comment; schedule a post 10+ min out, quit the Mac app entirely, confirm Convex publishes on time; comment from a role-holding account and confirm real-time webhook delivery to the open inbox, plus polling pickup with webhooks muted; reply from the Inbox and confirm on-platform.
- **Runtime checks**: `content_publishing_limit` before each IG publish; scheduled-window probe for FB native scheduling.

## Known Constraints & Open Items

- Convex free tier covers text/image posting comfortably; heavy video hits the 1 GB/mo file-egress limit first (fallbacks: resumable direct video upload to Meta, or self-hosted Convex).
- Register and smoke-test the `.convex.site` OAuth redirect early (standard HTTPS, expected to be accepted by Meta — verify in phase 2 first).
- Meta doc ambiguities to resolve empirically: FB native-schedule max window (75 vs ~30 days); IG daily publish cap (50 vs 100 — runtime endpoint is ground truth).
- IG Stories via API carry no stickers/links; single IG videos must be Reels.
- Convex crons are UTC; scheduled functions run "at or after" the target time (seconds-level accuracy, no hard SLA) — fine for social posting.
- Development-mode webhook delivery covers only app-role users' activity; real-follower comments arrive via the polling sweep until the app goes Live.
