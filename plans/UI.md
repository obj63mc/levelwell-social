# UI — Page Inventory

What each screen of the desktop app contains. Built with shadcn/ui (base-nova style) on Tailwind v4; follows the macOS appearance (light/dark); every list is a reactive Convex query, so screens update live without refresh. Calendar, Composer, Inbox and the app shell get their detailed design in a dedicated UI session — entries marked **to define** are placeholders.

| Page | Status |
|---|---|
| Connect (first launch) | built |
| Dashboard (landing) | built (calendar, quick post, queue) |
| Post detail | to define |
| Composer | to define |
| Queue | to define |
| Inbox | to define |
| Profiles | to define |
| Settings | to define |

## App shell — to define
- Navigation between pages (sidebar vs. top tabs), global "New post" action, connection-health indicator, unread-inbox badge (mirrors the tray badge).
- Routing library decision (currently none: `App.tsx` switches between Connect and Dashboard).

## Connect (first launch) — `src/views/ConnectMeta.tsx`
Shown whenever no Meta connection exists for the owner (`api.profiles.connectionStatus`).
- Title + one-line explanation (tokens live on the server, never on the Mac).
- "Before you start" checklist: IG Professional account linked to an admin'd Page; Facebook account holds a role on the Meta app.
- Three numbered steps (open browser → approve Pages + Instagram → come back).
- Primary button **Continue with Facebook** → `api.meta.oauth.start` → system browser. While waiting: spinner "Waiting for Facebook…", **Open again**, **Cancel**. On failure: destructive alert with Meta's message + **Try again**.
- On success nothing to click: the app flips to the Dashboard the moment the Convex callback commits.

## Dashboard (landing) — `src/views/Dashboard.tsx`
- Top-right **avatar button** (Page picture) → dropdown: each Page (picture, name, category, `@instagram` badge or "No Instagram linked", needs-reconnect / webhook badges), "Connected as {Facebook name}", and **Disconnect** (removes this Meta user's grant and ends the session; Pages and content stay for other managers). No page title.
- **Quick post**: two large buttons with brand icons — **Post to Facebook** / **Post to Instagram** — open the Composer inline with that channel preselected.
- **Queue** (below the calendar): a collapsible card listing only what still needs action — scheduled/publishing posts plus failures (`api.posts.listActive`), oldest first. Published history lives on the calendar, not here. The header carries an "N upcoming" badge and a destructive "N need attention" badge when anything failed; it starts expanded whenever there are failures, collapsed otherwise, and the user's click wins from then on. Rows: thumbnail, status, per-channel badges, time; Reschedule / Cancel (scheduled), Retry (failed).
- **Calendar** — `src/views/Calendar.tsx`, built. Month grid (6 fixed weeks, Sunday-first, local time), ‹ / › month navigation + **Today**; each day carries one chip per post (Facebook and/or Instagram icon + time, tinted by status), two chips per day then "+N more" expands the cell.
  - Clicking a chip opens an **in-app detail panel** below the grid: thumbnail, caption (plus per-channel caption when it differs), first comment, full date, overall + per-channel status, errors.
  - **Supersedes the earlier "never link to the live post" rule**: the detail panel offers **Open on Facebook / Open on Instagram** for channels that published, from the `permalink` now recorded at publish time (`recordPermalink` in `convex/publish.ts`, stored on the post's channel sub-object). Posts published before permalinks existed show "No link recorded".
  - Data comes from `api.posts.listRange({ profileId, start, end })` over the visible grid, so the panel stays live-reactive.
  - Still open: click an empty day → Composer pre-filled with that date, week view, a full Post detail page.

## Dev seed data
`npm run seed` fills the dev deployment with ~12 posts across last month and this month (published with permalinks, scheduled, failed, partly failed) plus three placeholder thumbnails, so the calendar and queue can be worked on without publishing to a real Page. Rows carry `demo: true`, are never enqueued on the publish workpool (`posts.enqueue` refuses them), and `npm run seed:clear` removes exactly those rows and their files.

## Post detail — to define
Target of the calendar icons. Expected: caption(s), media, per-platform status and platform post ids, schedule time, first comment, publish log/errors, actions (edit, reschedule, cancel, retry).

## Composer — `src/views/Composer.tsx` (functional; polish in the UI session)
Page picker (if several) · channel toggles (Facebook / Instagram, IG disabled without a linked account) · media tiles via file picker (JPEG/PNG→JPEG, MP4/MOV; reorder, remove; format badges: Photo / Reel / Carousel n/10, Photo set) · caption with IG counters (2200 / 30 # / 20 @) · Instagram options (collaborators ≤3, tag people, alt text, share Reel to feed, audio notice) · "Publish as Facebook Reel" for a single vertical video · footer: **Post now** | **Schedule** + datetime picker. Open for the UI session: drag-drop from Finder, tag placement on the image, Stories, first comment, "post manually" reminder for trending audio.
Profile picker (Page and/or linked IG), caption with per-platform override, media upload (drag-drop / native picker → Convex storage), first-comment field, publish now vs. schedule (date-time), IG quota indicator.

## Queue — `src/views/Queue.tsx` (lives on the Dashboard for now)
Chronological list of scheduled/publishing/failed posts with live status. Still open: bulk cancel/retry.

## Inbox — to define
Email-client layout: thread list (unread bold, platform icon, post thumbnail) + conversation pane with reply box; mark read/unread; new comments appear live from webhooks/polling. Per comment: **Reply publicly** and **Send private reply** (DM; disabled after 7 days or once used — see META.md §7). The inbox is per Page, shared by all its managers.

## Profiles — to define
Each connected Page/IG with token health, webhook subscription state, last reconnect; **Reconnect** runs the Connect flow again.

## Settings — to define
Appearance (system/light/dark), notifications, launch at login / menu-bar mode, retention of published media, Convex deployment info.
