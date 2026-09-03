# LevelWell Social

macOS desktop app for posting and scheduling to Facebook Pages and Instagram, with first-comment automation and a real-time comments inbox.

**Stack:** Tauri v2 (Rust shell) · React 19 + Vite 8 · shadcn/ui (Tailwind v4) · Convex backend (database, scheduling, file storage, Meta Graph API calls).

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

`npm run tauri build` reads `.env.production`, so the bundle points at the prod
Convex deployment (`npm run dev` keeps using `.env.local`). Backend-only changes
ship with `npx convex deploy` and need no new build.

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
