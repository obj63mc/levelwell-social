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

Other scripts: `npm run lint`, `npm run build` (frontend only), `npm run tauri build` (macOS .app/.dmg).

## Planning docs

- [`plans/PLAN.md`](plans/PLAN.md) — architecture and build phases
- [`plans/CONVEX.md`](plans/CONVEX.md) — Convex setup and platform facts
- [`plans/META.md`](plans/META.md) — Meta developer app setup
- [`plans/SETUP.md`](plans/SETUP.md) — macOS dev environment
