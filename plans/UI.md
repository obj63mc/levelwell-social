# UI — Page Inventory

What each screen of the desktop app contains. Built with shadcn/ui (base-nova style) on Tailwind v4; follows the macOS appearance (light/dark); every list is a reactive Convex query, so screens update live without refresh. Calendar, Composer, Inbox and the app shell get their detailed design in a dedicated UI session — entries marked **to define** are placeholders.

| Page | Status |
|---|---|
| Connect (first launch) | built |
| Dashboard (landing) | shell built; calendar **to define** |
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
- Header: "Dashboard", "Connected as {Facebook name}", **Disconnect**.
- Connected-profile cards: Page picture, Page name, category, `@instagram` badge (or "No Instagram linked"), status badges (needs reconnect / webhook not subscribed).
- **Calendar — to define** (placeholder card today). Agreed requirements:
  - Month grid of the **current month** (with previous/next navigation).
  - Each day shows one icon per scheduled post: **Facebook icon** for a Facebook Page post, **Instagram icon** for an Instagram post (a post targeting both shows both).
  - Each icon links to that post's **in-app Post detail page** — never to the live post on facebook.com/instagram.com.
  - Open questions for the UI session: day-cell overflow ("+3"), status colouring (scheduled / published / failed), click on an empty day → Composer pre-filled with that date, week view.

## Post detail — to define
Target of the calendar icons. Expected: caption(s), media, per-platform status and platform post ids, schedule time, first comment, publish log/errors, actions (edit, reschedule, cancel, retry).

## Composer — to define
Profile picker (Page and/or linked IG), caption with per-platform override, media upload (drag-drop / native picker → Convex storage), first-comment field, publish now vs. schedule (date-time), IG quota indicator.

## Queue — to define
Chronological list of scheduled/publishing/failed posts with live status; bulk cancel/retry. Likely the same data as the calendar in list form.

## Inbox — to define
Email-client layout: thread list (unread bold, platform icon, post thumbnail) + conversation pane with reply box; mark read/unread; new comments appear live from webhooks/polling.

## Profiles — to define
Each connected Page/IG with token health, webhook subscription state, last reconnect; **Reconnect** runs the Connect flow again.

## Settings — to define
Appearance (system/light/dark), notifications, launch at login / menu-bar mode, retention of published media, Convex deployment info.
