# Phase 3 implementation plan — Posts (compose, post now, schedule, publish)

_Saved 2026-08-21 for implementation in a separate session. Research answers are also summarized at the bottom._


## Context

Connect + sessions + Page scoping are done. Next is the core product loop: create a post (asset + caption), target the Page's Facebook and/or Instagram channel, and either publish immediately or at a scheduled time — durably, from Convex, whether or not the Mac is awake.

Research outcomes that shape the design (recorded in `plans/META.md`):
- **Trending/licensed audio: not available via API.** Audio must be in the video file. We flag this in the Composer and offer a "post manually" reminder path later (not in this phase).
- **IG collaborators (≤3) and user tags: supported** on images, Reels, carousels (not Stories). Facebook Pages: no user tagging via API.
- **Cross-posting: no API toggle** (IG⇄FB "share to" is in-app only). We publish separately to each selected channel from the same asset + caption — which also gives "post to only one" for free.
- IG has no native scheduling; IG media must be public URLs (Convex storage); IG images must be JPEG; single IG video ⇒ Reel; carousel = 2–10 children (images/videos, no reels as children); ~100 IG API posts/24h (`content_publishing_limit`), FB Reels 30/24h.
- Facebook: photo `POST /{page}/photos` (`url`, `caption`, `alt_text_custom`), multi-photo = photos with `published=false` + `POST /{page}/feed` `attached_media`, video `POST /{page}/videos` (`file_url`, `description`), Reel = `video_reels` start → `rupload` with `file_url` header → finish.

User decisions: IG formats = **feed image, Reel, carousel** (Stories later); **functional Composer + Queue** now (polish in the UI session); **`@convex-dev/workpool`** for execution; **Convex schedules everything** (no FB native scheduling).

## Data model (`convex/schema.ts`)

```
media: { profileId, uploadedByConnectionId, storageId: v.id("_storage"), kind: "image"|"video",
         mimeType, sizeBytes, width?, height?, durationMs?, status: "uploaded"|"attached"|"deleted" }
  .index("by_profileId_and_status", ["profileId","status"])

posts: {
  profileId, createdByConnectionId,
  caption: string,                      // shared; IG limit 2200 chars / 30 hashtags / 20 @mentions
  mediaIds: v.array(v.id("media")),     // 1 item, or 2–10 for carousel (ordered)
  targets: { facebook: boolean, instagram: boolean },
  igFormat: "image"|"reel"|"carousel",  // derived from media at create time, stored for clarity
  fbFormat: "photo"|"multi_photo"|"video"|"reel",
  ig: { collaborators: string[], userTags: {username, x?, y?}[], shareToFeed?: boolean,
        coverMediaId?: v.id("media"), thumbOffsetMs?: number, altText?: string },
  scheduledAt?: number,                 // epoch ms; undefined = publish now
  status: "scheduled"|"publishing"|"published"|"partially_failed"|"failed"|"canceled",
  workId?: string,                      // workpool id for cancel
  facebook?: { status: "pending"|"published"|"failed", postId?, photoIds?: string[], videoId?, error?, publishedAt? },
  instagram?:{ status: "pending"|"published"|"failed", creationId?, childCreationIds?: string[], mediaId?, error?, publishedAt? },
  lastError?: string,
}
  .index("by_profileId_and_status", ["profileId","status"])
  .index("by_profileId_and_scheduledAt", ["profileId","scheduledAt"])   // calendar later
```
Per-channel sub-objects hold the idempotency keys (`creationId`, `photoIds`, `postId`): a retried action resumes from the last recorded step and never double-posts. No `draft` status this phase.

## Backend

### `convex/convex.config.ts`
`app.use(workpool, { name: "publishPool" })` (import `@convex-dev/workpool/convex.config.js`). `convex/lib/pool.ts`: `new Workpool(components.publishPool, { maxParallelism: 2, retryActionsByDefault: true, defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 30_000, base: 2 } })`.

### `convex/media.ts`
- `generateUploadUrl({ sessionToken, profileId })` (mutation): `requireSession` → `requirePageAccess` → `ctx.storage.generateUploadUrl()`.
- `register({ sessionToken, profileId, storageId, kind, mimeType, sizeBytes, width?, height?, durationMs? })` (mutation) → `media` row, returns `{ mediaId, url }` (`ctx.storage.getUrl` for preview).
- `remove({ sessionToken, mediaId })` — only while `uploaded`.
- Validation: images `image/jpeg` only (client converts PNG→JPEG, see UI), ≤ 8 MB; video `video/mp4|video/quicktime`, ≤ 300 MB (Convex upload limit is higher; keep sane).

### `convex/posts.ts` (public, all `sessionArgs` + `requirePageAccess`)
- `create({ sessionToken, profileId, caption, mediaIds, targets, ig, fbFormat?, scheduledAt? })` (mutation): validates — ≥1 target; IG requires media; IG image⇒JPEG; single video⇒`igFormat: "reel"`; carousel 2–10 and no video if any child invalid; `scheduledAt` ≥ now + 1 min when set; caption limits; collaborators ≤ 3 (strip `@`); profile must have `igUserId` when IG targeted; marks media `attached`. Inserts post `status: "scheduled"`, then `pool.enqueueAction(ctx, internal.publish.run, { postId }, { runAt: scheduledAt ?? now, onComplete: internal.publish.onComplete, context: { postId } })` and patches `workId`.
- `cancel({ sessionToken, postId })`: only `scheduled` → `pool.cancel(workId)`, status `canceled`, media back to `uploaded`.
- `reschedule({ sessionToken, postId, scheduledAt })`: cancel + re-enqueue (same post).
- `retry({ sessionToken, postId })`: `failed`/`partially_failed` → re-enqueue now (channels already `published` are skipped by idempotency).
- `list({ sessionToken, profileId, status? })` (query, `.take(100)`, newest `scheduledAt` first) and `get({ sessionToken, postId })` → summary with media preview URLs (`ctx.storage.getUrl`), never tokens.

### `convex/publish.ts` — `internal.publish.run` (internalAction, idempotent) + helpers
1. `internal.publish.begin` (internalMutation): post must be `scheduled|publishing|partially_failed`; set `publishing`; return post + `pageTokenFor(profileId, createdByConnectionId)` (from `convex/lib/session.ts`) + media `getUrl`s. No token → mark `failed` "Reconnect Facebook".
2. **Facebook** (if targeted and not already `published`): photo → `/{pageId}/photos` `{url, caption}`; multi_photo → each `/photos` `{url, published:false}` (store `photoIds` as they succeed) then `/feed` `{message, attached_media}`; video → `/videos` `{file_url, description}`; reel → `video_reels` start → `POST rupload.facebook.com/video-upload/{version}/{videoId}` with headers `Authorization: OAuth <token>`, `file_url` → finish `{upload_phase: "finish", video_state: "PUBLISHED", description}`. Record `postId`/`videoId` via `internal.publish.recordChannel`.
3. **Instagram** (if targeted and not `published`): check `GET /{igUserId}/content_publishing_limit?fields=quota_usage` (fail fast if ≥ 100); image → `POST /{igUserId}/media` `{image_url, caption, user_tags(JSON), collaborators(JSON), alt_text}`; reel → `{media_type:"REELS", video_url, caption, share_to_feed, cover_url|thumb_offset, user_tags, collaborators}`; carousel → children `{image_url|video_url, media_type?:"VIDEO", is_carousel_item:true}` (store `childCreationIds` progressively) then parent `{media_type:"CAROUSEL", children, caption, collaborators}`. Store `creationId`; poll `GET /{creationId}?fields=status_code,status` every 5 s up to 5 min (`FINISHED` → continue; `ERROR`/`EXPIRED` → fail channel with `status`); `POST /{igUserId}/media_publish {creation_id}` → `mediaId`.
4. Graph error 190 → mark that member `needs_reconnect` (`internal.publish.flagReconnect`) and fail.
5. Throw if any targeted channel failed (so workpool retries; already-published channels are skipped on retry).
- `internal.publish.onComplete` (`pool.defineOnComplete`): compute final status from channel sub-objects: all published → `published`; mix → `partially_failed`; none → `failed`; `canceled` → leave `canceled`. Sets `lastError`.
- Reuse `graphGet`/`graphPost`/`describeError` from `convex/meta/client.ts`; add `graphPostForm`/raw-fetch helper only for the `rupload` call (different host + headers).

### `convex/crons.ts` (new) — media cleanup
Every 6 h: delete storage + mark `deleted` for media attached to posts `published` > 7 days ago, and orphan `uploaded` media > 24 h old (`internal.media.cleanup`, batched `.take(50)`).

## Frontend (`src/`)

- **Navigation (interim)**: `App.tsx` holds `view: "dashboard"|"compose"|"queue"` + a minimal top bar (Dashboard · New post · Queue) using existing `Button`s; real shell comes in the UI session. Dashboard gets a "New post" button.
- **`src/lib/media.ts`**: `prepareImage(file)` — decode via `createImageBitmap`, re-encode to JPEG (quality 0.92) with `<canvas>` when not already JPEG, return `{ blob, width, height }`; `probeVideo(file)` → `{ width, height, durationMs }` via an off-DOM `<video>`; `upload(sessionToken, profileId, file)` → `generateUploadUrl` → `fetch(url, { method:"POST", headers:{"Content-Type"}, body })` → `register`. Progress is per-file (no streaming progress from fetch; show spinner per tile).
- **`src/views/Composer.tsx`** (shadcn: card, select/toggle-group, textarea, input, badge, alert, spinner; add via `npx shadcn add textarea toggle-group select label`):
  1. Page picker (from `connectionStatus.profiles`; auto-select if one).
  2. Channel toggles: Facebook / Instagram (IG disabled with hint when the Page has no `igUsername`).
  3. Media: `<input type="file" multiple accept="image/jpeg,image/png,video/mp4,video/quicktime">` + tile grid with reorder (up/down buttons), remove, and derived format badge ("Instagram: Reel", "Carousel 3/10"). Rules enforced live: 1 video alone ⇒ Reel; 2–10 ⇒ carousel; mixed video+images allowed in carousel.
  4. Caption textarea with IG counters (2200 chars, # and @ counts).
  5. Instagram options (shown when IG on): collaborators (≤3 usernames as chips), user tags (usernames; for images an x/y defaults 0.5/0.5 — precise placement is a UI-session item), `share_to_feed` switch for Reels, optional cover image pick (from uploaded images) / thumb offset, alt text. Facebook options: "Publish video as Reel" toggle when a single 9:16 video.
  6. Info Alert: "Trending audio can't be added via Meta's API — include music in the video file."
  7. Footer: **Post now** and **Schedule** (native `<input type="datetime-local">`, min = now+5 min, local time → epoch ms). Submit → `posts.create` → navigate to Queue; errors in a destructive Alert.
- **`src/views/Queue.tsx`**: reactive `posts.list` grouped Scheduled / Publishing / Published / Failed; each row shows media thumbnail, caption excerpt, channel icons (`FacebookIcon`/`InstagramIcon`) with per-channel status badges, scheduled time; actions Cancel (scheduled), Retry (failed), Reschedule (datetime input inline).
- `src-tauri/tauri.conf.json` CSP: `img-src`/`media-src` add `https://*.convex.cloud blob:`; `connect-src` already allows `https://*.convex.cloud` (upload URL host).

## Docs
- `plans/META.md`: new §"Composer capabilities (researched 2026-08-21)" answering the four questions (audio ✗, collaborators/tags ✓ IG only, cross-post = separate publishes, single-channel ✓); Pages photos/videos/reels parameters; FB Reels 30/24h limit; note FB Reels API also mentions collaborator invites + music (unverified — investigate later).
- `plans/PLAN.md`: Phase 3 ✅ with the pieces; repo layout adds `posts.ts`, `media.ts`, `publish.ts`, `crons.ts`, `lib/pool.ts`, `views/Composer.tsx`, `views/Queue.tsx`.
- `plans/UI.md`: Composer and Queue sections filled in as built; open items for the UI session (drag-drop from Finder via Tauri drag-drop + `plugin-fs`, tag placement on image, Stories, first comment, audio "post manually" reminder).
- `plans/CONVEX.md`: data model adds `media`/`posts`; workpool installed; cleanup cron.

## Tests (`convex/posts.test.ts`, vitest + convex-test)
- Register the workpool component in `convexTest` (`t.registerComponent("publishPool", workpoolSchema, workpoolModules)` per convex-test component docs).
- `create`: forbidden for a non-member session; rejects IG target without `igUserId`, PNG media for IG, 11 media, scheduledAt in the past; derives `igFormat` reel/carousel; marks media `attached`; `cancel` restores media and status; `list` is Page-scoped (other Page's session sees nothing).
- `publish.run` with `fetch` stubbed (`vi.stubGlobal`): image to both channels → records `postId` + `creationId` + `mediaId`; FB succeeds then IG fails → `partially_failed`, re-run skips FB and only calls IG endpoints (idempotency); poll loop handles `IN_PROGRESS` then `FINISHED`; error 190 flags the member `needs_reconnect`.

## Verification
1. `npm run lint && npm test && npm run build`; `npx convex dev --once` (new tables + component).
2. Real run (`npm run dev:app`): compose a JPEG post to Facebook only → Post now → Queue shows Published; verify on the Page. Same with Instagram only, then both. One Reel (mp4 with baked-in audio) to IG + FB-as-Reel. One 3-image carousel with a collaborator username (an app-role test account) → collaborator receives the invite in Instagram.
3. Schedule a post 6 min out, quit the Mac app fully, confirm it publishes on time (Convex dashboard logs + platform); relaunch → Queue shows Published.
4. Cancel a scheduled post → nothing publishes; Retry a failed one (e.g. temporarily break the token) → recovers without duplicate posts.
5. Commit on `claude/social-media-posting-app-89ctej`.

---

## Research answers (2026-08-21, Graph API v26.0)

1. **Trending audio on Instagram** — not available via the API. No music library, trending sounds, or drafts; `audio_name` only renames original audio on a Reel. Music must be embedded in the uploaded video. Workaround for audio-critical Reels: publish manually from the Instagram app (future: a "post manually" reminder notification at the scheduled time).
2. **Collaborators / tagging** — Instagram: `collaborators` (≤3 usernames, invitee accepts in-app; images, Reels, carousels — not Stories) and `user_tags` (images need x/y 0–1; Reels just usernames); captions allow ≤20 @mentions. Facebook Pages: no user tagging via API.
3. **Cross-posting IG ⇄ FB** — no API toggle (in-app / Business Suite only). The app publishes separately to each selected channel from the same asset + caption.
4. **Post to only Facebook or only Instagram** — yes; channels are a per-post selection.

Sources: Meta docs — IG User Media reference, Content Publishing guide, Pages API posts/photos, Video API Reels publishing, Messenger private replies.
