# LevelWell Social

macOS desktop app for posting and scheduling to Facebook Pages and Instagram, with first-comment automation and a real-time comments inbox.

**Stack:** Tauri v2 (Rust shell) · React 19 + Vite 8 · shadcn/ui (Tailwind v4) · Convex backend (database, scheduling, file storage, Meta Graph API calls).

## First run

The app ships with **no backend configured** — it is not wired to anyone's
deployment. On first launch it asks for the Convex deployment it should use, and
stores your answer locally on that Mac. To get those URLs you run your own copy of
the backend:

```bash
npx convex deploy          # prints https://<name>.convex.cloud
```

The HTTP-actions URL is the same deployment name on `.convex.site`; the setup
screen fills it in for you, and you can override it if yours differs.

You also need your own [Meta developer app](plans/META.md) — this is what posts to
your Pages. Set these on the Convex deployment (dashboard → Settings → Environment
Variables, or `npx convex env set`):

| Variable | What it is |
| --- | --- |
| `META_APP_ID` | Your Meta app's ID |
| `META_APP_SECRET` | Your Meta app's secret (never leaves the backend) |
| `META_LOGIN_CONFIG_ID` | Facebook Login for Business configuration ID |
| `META_WEBHOOK_VERIFY_TOKEN` | Any random string; the same value goes in the Meta webhook setup |
| `META_GRAPH_VERSION` | Graph API version, e.g. `v21.0` |

Then register `https://<name>.convex.site/oauth/callback` as a valid OAuth redirect
URI in your Meta app, and `https://<name>.convex.site/webhooks/meta` as the webhook
callback. [`plans/META.md`](plans/META.md) walks through it.

To point the app somewhere else later: avatar menu → **Change Convex deployment…**.

## Run locally

Requires Node 26 (`.nvmrc`), Rust (rustup), and Xcode Command Line Tools — see [`plans/SETUP.md`](plans/SETUP.md).

```bash
npm install
npm run dev:app     # convex dev (backend sync) + tauri dev (desktop app)
```

Or in two terminals: `npm run dev:convex` and `npm run tauri dev`.

Other scripts: `npm run lint`, `npm run build` (frontend only), `npm run tauri build` (macOS .app/.dmg), `npm run seed` / `npm run seed:clear` (dev-only demo posts).

## Releasing

```bash
npm run release -- patch     # bump, build, verify, tag, publish to GitHub
npm run release -- patch --dry-run
```

`scripts/release.sh` runs the checks, keeps the version in sync across
`package.json` / `tauri.conf.json` / `Cargo.toml`, builds the `.dmg`, verifies
the bundle points at prod Convex (and not dev), then tags and publishes a GitHub
release. Full runbook and the manual equivalent: [`plans/BUILD.md`](plans/BUILD.md).

The release build runs `vite build --mode release`, which blanks
`VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`, so **a published `.dmg` contains no
deployment URL** and every download starts at the setup screen. The script fails
the release if one leaks in. A plain `npm run build` / `npm run tauri build` still
reads `.env.local` / `.env.production` as a convenience for local runs — don't hand
those bundles out. Backend-only changes ship with `npx convex deploy` and need no
new build.

The bundle is ad-hoc signed (`bundle.macOS.signingIdentity: "-"`) but not
notarized. On a Mac that downloaded it, macOS blocks the first launch: open
**System Settings → Privacy & Security**, scroll to the blocked-app notice and
click **Open Anyway**. Or clear the quarantine flag directly:

```bash
xattr -dr com.apple.quarantine "/Applications/LevelWell Social.app"
```

Notarizing (an Apple Developer Program membership plus `APPLE_ID` /
`APPLE_PASSWORD` / `APPLE_TEAM_ID` in the build env) is what removes that step.

## Planning docs

- [`plans/PLAN.md`](plans/PLAN.md) — architecture and build phases
- [`plans/CONVEX.md`](plans/CONVEX.md) — Convex setup and platform facts
- [`plans/META.md`](plans/META.md) — Meta developer app setup
- [`plans/SETUP.md`](plans/SETUP.md) — macOS dev environment
- [`plans/BUILD.md`](plans/BUILD.md) — build & release runbook
