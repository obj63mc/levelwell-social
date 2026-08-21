# macOS Development Environment Setup

What to install on your Mac to build LevelWell Social (Tauri v2 + React + Convex). Assumes you already have **Homebrew**, **Node.js**, and **Python** — Python isn't used by this stack, and Homebrew and Node cover part of the list below.

## 1. Xcode Command Line Tools (required)

Tauri compiles Rust against the macOS SDK and links native frameworks (WebKit, AppKit), so you need Apple's toolchain — the Command Line Tools are enough, the full Xcode app is **not** required for desktop-only development:

```bash
xcode-select --install
```

Verify: `xcode-select -p` should print a path (e.g. `/Library/Developer/CommandLineTools`). If you ever add iOS targets later, that's when full Xcode becomes necessary.

## 2. Rust (required)

Install via **rustup** (the official installer — do *not* install Rust via Homebrew; rustup manages toolchain updates and targets properly):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- Accept the default (stable toolchain). Restart your shell or `source "$HOME/.cargo/env"`.
- Verify: `rustc --version` and `cargo --version`.
- Keep it updated with `rustup update`.
- On Apple Silicon the default `aarch64-apple-darwin` target is all you need for development. If you later want universal binaries for distribution: `rustup target add x86_64-apple-darwin`.

That's the entire Tauri v2 macOS prerequisite list: CLT + Rust. There is **no webview to install** — Tauri uses the system WKWebView, which ships with macOS.

## 3. Node.js version check (already installed — verify version)

The frontend uses Vite + React and the Convex CLI. Check:

```bash
node --version   # want v20.19+ or v22.12+ (LTS); older versions break current Vite
npm --version
```

If it's older, `brew upgrade node` or use a version manager (`brew install fnm`, then `fnm install --lts`).

## 4. Project-level CLIs (installed per-project via npm — nothing global)

These come in as `devDependencies` when the project is scaffolded; listed so you know what runs where:

| Tool | How it's invoked | Purpose |
|---|---|---|
| Tauri CLI | `npm run tauri dev` / `npx tauri …` (`@tauri-apps/cli` devDependency) | Build/run the desktop app |
| Vite | `npm run dev` (wired into `tauri dev`) | Frontend dev server/bundler |
| Convex CLI | `npx convex dev`, `npx convex deploy`, `npx convex env set …` | Backend dev loop + deploys (see [`CONVEX.md`](./CONVEX.md)) |

No global installs needed; `cargo install tauri-cli` is optional and unnecessary when using the npm CLI.

## 5. Editor tooling (recommended)

- **VS Code** (or your editor of choice) with:
  - **rust-analyzer** — Rust language support
  - **Tauri** extension — config/schema help
  - Standard TS/React tooling (ESLint, Prettier)
- `rustup component add clippy rustfmt` (usually included with stable) — the lint/format tools CI and the plan's verification steps use.

## 6. Optional / later

- **ffmpeg** (`brew install ffmpeg`) — only if/when we add the video-transcode sidecar (phase 6+ concern; not needed to start).
- **Apple Developer Program** ($99/yr) — only needed when you want to distribute the app outside your own machine: Developer ID Application certificate for code signing + notarization (`xcrun notarytool`). For local development, unsigned dev builds run fine on your own Mac.
- **fnm/nvm** — Node version manager, if you juggle multiple Node versions.

## 7. First-run verification

After scaffolding lands (build phase 1), this sequence proves the environment end-to-end:

```bash
git clone https://github.com/obj63mc/levelwell-social && cd levelwell-social
npm install            # frontend deps + Tauri & Convex CLIs
npx convex dev         # first run: logs in, provisions your dev deployment
npm run tauri dev      # compiles the Rust shell (first build takes a few minutes) and opens the app
```

Success looks like: a native window opens rendering the Vite dev server, with hot reload on frontend edits and `convex dev` live-syncing backend functions. Expect the first `tauri dev` Rust compile to take several minutes; incremental rebuilds after that are fast.

## Quick checklist

- [x] `xcode-select --install` completed (`xcode-select -p` prints a path)
- [x] Rust via rustup (`rustc --version` works)
- [x] Node v20.19+/v22.12+ (`node --version`)
- [x] Editor + rust-analyzer set up
- [x] Convex account ready (see [`CONVEX.md`](./CONVEX.md))
- [ ] Meta developer app ready (see [`META.md`](./META.md))
