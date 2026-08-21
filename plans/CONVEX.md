# Convex Backend — Setup Runbook & Platform Facts

Convex ([convex.dev](https://www.convex.dev)) is the backend of record for LevelWell Social: database, post queue, scheduled publishing, file storage, OAuth callback, Meta webhooks, and all Graph API traffic. This document covers the one-time setup and the platform facts the implementation depends on.

## 1. Account & Project Setup

- [ ] Create a Convex account at [dashboard.convex.dev](https://dashboard.convex.dev) (GitHub sign-in is simplest). Free tier — no card needed.
- [ ] In the repo, initialize the project:
  ```bash
  npm create convex@latest   # or, in an existing app: npm install convex && npx convex dev
  ```
  `npx convex dev` logs in, creates the project, provisions your personal **dev deployment**, writes `CONVEX_DEPLOYMENT` to `.env.local`, and starts live-syncing `convex/` functions.
- [ ] Note the two deployments every project gets:
  - **Dev**: `https://<dev-name>.convex.cloud` (functions) / `https://<dev-name>.convex.site` (HTTP actions)
  - **Prod**: created on first `npx convex deploy` — separate URL, separate env vars, separate data.
- [ ] Record both `.convex.site` URLs — they are needed in the Meta app config (OAuth redirect + webhook callback; see [`META.md`](./META.md)).

## 2. Environment Variables (secrets live here, never on the desktop)

Set per-deployment in the dashboard (Settings → Environment Variables) or via CLI:

```bash
npx convex env set META_APP_ID "<app id>"
npx convex env set META_APP_SECRET "<app secret>"
npx convex env set META_LOGIN_CONFIG_ID "<facebook login for business config id>"
npx convex env set META_WEBHOOK_VERIFY_TOKEN "<random string you generate>"
npx convex env set META_GRAPH_VERSION "v25.0"
```

- Read via `process.env.*` inside functions. Limits: 512 vars, 8 KiB/value.
- Set them on **both** dev and prod deployments (values may differ if you ever use two Meta apps).
- Meta access tokens (user/Page tokens obtained via OAuth) are stored in the **database** on profile documents, not in env vars — they are per-profile data.

## 3. Components to Install

Official Convex components (`npx convex import` per each package's README, registered in `convex/convex.config.ts`):

| Component | Purpose here |
|---|---|
| `@convex-dev/workpool` | Publish queue execution: concurrency limits, exponential-backoff retries, `onComplete` hooks |
| `@convex-dev/rate-limiter` | Enforce Meta per-account quotas (IG ~100 posts/24 h) app-side |
| `@convex-dev/workflow` | (Optional, later) durable multi-step IG pipeline: container → poll → publish → first comment |
| `@convex-dev/action-retrier` | (Alternative to workpool for simple cases) retry a single action with backoff |

## 4. Platform Facts the Design Depends On (verified 2026)

### Scheduling
- `ctx.scheduler.runAt(epochMs, fnRef, args)` / `runAfter(delayMs, …)` — callable from mutations and actions; returns an `Id<"_scheduled_functions">` (store it on the post document for cancel/re-arm).
- Scheduling from a **mutation is transactional** (rolls back with the mutation) and **durable** (persisted, survives restarts; up to **1,000,000 outstanding** scheduled functions on all plans, including free).
- Timing is "at or after" the scheduled time — seconds-level accuracy, no hard SLA. Fine for social posting.
- **Scheduled mutations are exactly-once; scheduled actions are at-most-once with NO automatic retry.** Hence the pattern: `runAt` → internal *mutation* (status transition) → enqueue Graph API work into **workpool** for retried execution. Auth context does not propagate into scheduled functions — use `internal*` functions.
- Cancel: `ctx.scheduler.cancel(id)`. No in-place reschedule — cancel + re-schedule.
- Crons: `convex/crons.ts` with `cronJobs()` (`interval`, `cron("m h dom mon dow")` — **UTC only**, min hourly granularity not required — per-minute allowed; at most one concurrent run per cron, overlaps skipped). Used for: comment polling sweep, media cleanup, token health checks.

### Actions & HTTP
- `fetch` works in actions — all Graph API calls happen here. Default (V8) runtime suffices; `"use node"` only if a Node-only SDK is ever needed.
- Limits: Convex-runtime actions up to 30 min (Node and HTTP actions 10 min); queries/mutations 1 s of user code. No auto-retry for actions — always `await` everything.
- **HTTP actions** (`convex/http.ts`, `httpRouter()`) are served at `https://<deployment>.convex.site/...` — the public HTTPS surface used for:
  - `/oauth/callback` — Meta Facebook Login redirect URI
  - `/webhooks/meta` — Meta webhook endpoint (GET `hub.challenge` handshake; POST events validated with `X-Hub-Signature-256` HMAC using `META_APP_SECRET`)
  - 20 MB request/response limit; no automatic retries (Meta retries webhook deliveries itself).

### File storage
- Upload flow: mutation calls `ctx.storage.generateUploadUrl()` → client POSTs bytes → gets `storageId` → mutation persists it. Upload URLs expire in 1 h; the upload POST has a **2-minute timeout** (relevant for ~1 GB reels on slow uplinks — fallback: Meta's resumable direct video upload).
- **`ctx.storage.getUrl(storageId)` returns a PUBLIC, non-expiring, unauthenticated URL** — this is what gets passed to Instagram as `image_url`/`video_url` (Meta downloads the file). Revocation = deleting the file → the media-cleanup cron deletes files after successful publish.
- Do not serve big media through HTTP actions (20 MB cap) — always `getUrl()`.

### Clients
- Desktop UI uses the official **`convex` JS client** (`ConvexReactClient`, `useQuery`/`useMutation`) — reactive WebSocket subscriptions give the live queue/inbox UX. Works in Tauri v2's WKWebView; add the Convex URLs to the Tauri CSP allowlist.
- An official Rust client (`convex` crate) exists if the Tauri shell ever needs direct backend access — not planned for v1.

### Auth (app users)
- **Convex Auth is still beta (2026) — avoided.** v1 runs without end-user auth: all sensitive functions are `internal*`, the deployment is personal. Multi-user later: Clerk (most mature integration) or `@convex-dev/better-auth`. Schema carries `userId` from day one.

## 5. Pricing & Limits Snapshot (2026)

| | Free | Notes |
|---|---|---|
| Function calls | 1M/mo | Plenty for personal posting + polling crons |
| DB storage / bandwidth | 0.5 GB / 1 GB/mo | Fine for post + comment documents |
| File storage | 1 GB | Media held only until published + retention window |
| **File egress** | **1 GB/mo** | **First limit hit if posting lots of video** — Meta downloading a reel counts here |
| Action compute | 20 GB-hr/mo | Ample |
| Outstanding scheduled fns | 1,000,000 | Non-issue |

- Paid: usage-based Starter, or Professional (~$25/dev/mo) with much higher included usage.
- **Fallbacks if limits bite**: IG resumable direct video upload (skips public-URL egress), or **self-hosting** — the Convex backend is open source ([github.com/get-convex/convex-backend](https://github.com/get-convex/convex-backend)), Docker-deployable with dashboard + CLI.

## 6. Deployment Workflow

- Development: `npx convex dev` (live function sync against the dev deployment) + `npm run dev` (Vite) + `npm run tauri dev`.
- Production: `npx convex deploy` pushes functions to prod; the desktop app is pointed at the prod `.convex.cloud` URL at build time.
- Tests: `vitest` with the official `convex-test` harness for queue/idempotency logic.

## 7. Setup Completion Checklist

- [ ] Convex account + project created; dev deployment live via `npx convex dev`
- [ ] Prod deployment created via first `npx convex deploy`
- [ ] All env vars from §2 set on dev **and** prod
- [ ] Components from §3 installed and registered
- [ ] Both `.convex.site` URLs registered in the Meta app ([`META.md`](./META.md) §4–5)
- [ ] Smoke test: an HTTP action responding at `https://<dev>.convex.site/webhooks/meta` (GET handshake echo)
