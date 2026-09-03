# Build & Release Runbook

How a new version of the LevelWell Social desktop app gets built, signed and
published to GitHub. `scripts/release.sh` automates all of it; the manual
equivalent is written out below for when something needs doing by hand.

## The short version

```bash
npm run release -- patch            # 0.0.1 -> 0.0.2, build, tag, publish
npm run release -- minor            # 0.0.1 -> 0.1.0
npm run release -- 1.2.3            # an exact version
npm run release -- patch --dry-run  # everything up to the commit, then stop
```

Useful flags:

| Flag | Effect |
|---|---|
| `--dry-run` | Runs checks, bumps versions, builds and verifies the bundle, prints the release notes — then restores the version files and exits without committing, tagging or publishing. |
| `--draft` | Publishes the GitHub release as a draft so you can edit the notes before it goes live. |
| `--universal` | Builds a universal (Apple Silicon + Intel) binary instead of arm64-only. Needs `rustup target add x86_64-apple-darwin` first. |

## What the script does, in order

1. **Preflight.** Requires `cargo`, an authenticated `gh`,
   the `main` branch, a clean working tree, and `main` in sync with
   `origin/main`. Any of these missing stops the release before anything
   changes.
2. **Lint, typecheck, tests** — `npm run lint && npm run test`.
3. **Version bump.** The version lives in **three** files and they must not
   drift: `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`. It also refuses to continue if the tag or the
   GitHub release already exists. On any failure from here to the commit, the
   version files are restored.
4. **Build** — `npm run tauri build -- --config src-tauri/tauri.release.conf.json`.
   That overlay swaps `beforeBuildCommand` for `npm run build:release`, i.e.
   `vite build --mode release`, whose `define` blanks `VITE_CONVEX_URL` and
   `VITE_CONVEX_SITE_URL`. **A published build carries no deployment**; the app
   asks for one on first launch. (The blanking has to happen in `vite.config.ts`
   because Vite loads `.env.local` in *every* mode, `release` included.) Output
   lands in `src-tauri/target/release/bundle/`.
5. **Bundle verification** — the guard rail that matters most:
   - **no** `https://<name>.convex.cloud|site` URL survives in `dist/assets`
     (`happy-otter-123` excepted — that is the example in the Convex client's own
     error message, not a deployment). A leaked URL would point every download at
     that backend;
   - the `.app` passes `codesign --verify`.
6. **Commit, tag, push** — `chore: release vX.Y.Z`, an annotated tag, both
   pushed to `origin`.
7. **Publish** — `gh release create` with the `.dmg` attached and notes built
   from the commits since the previous tag, plus the Gatekeeper instructions.

## Doing it by hand

```bash
# 1. checks
npm run lint && npm run test

# 2. bump all three files to the same version
#    package.json · src-tauri/tauri.conf.json · src-tauri/Cargo.toml

# 3. build with no deployment baked in
npm run tauri build -- --config src-tauri/tauri.release.conf.json

# 4. verify no deployment URL survived (must print nothing)
grep -rhoE 'https://[a-z0-9-]+\.convex\.(cloud|site)' dist/assets | grep -v happy-otter-123
codesign --verify --strict "src-tauri/target/release/bundle/macos/LevelWell Social.app"

# 5. commit and tag
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release v0.0.2"
git tag -a v0.0.2 -m v0.0.2
git push origin main && git push origin v0.0.2

# 6. publish
gh release create v0.0.2 --title v0.0.2 --generate-notes \
  "src-tauri/target/release/bundle/dmg/LevelWell Social_0.0.2_aarch64.dmg"
```

## Facts worth knowing

**The backend deploys separately.** Convex functions ship with
`npx convex deploy` and take effect immediately for every installed copy of the
app — a backend-only change never needs a new build. A rebuild is only required
when something in `src/` or `src-tauri/` changes. Tauri **capabilities**
(`src-tauri/capabilities/default.json`) are compiled into the binary, so
changes there — such as adding a host to the `opener:allow-open-url` allowlist —
always need a release.

**The bundle is ad-hoc signed, not notarized** (`bundle.macOS.signingIdentity:
"-"`). macOS blocks the first launch of a downloaded copy. Users either open
**System Settings → Privacy & Security → Open Anyway**, or run:

```bash
xattr -dr com.apple.quarantine "/Applications/LevelWell Social.app"
```

The release notes include this. Removing the step needs an Apple Developer
Program membership and `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` in the
build environment, which turns on Tauri's notarization step.

**Architecture.** A plain build produces an arm64-only `.dmg` named
`LevelWell Social_<version>_aarch64.dmg`; it will not run on an Intel Mac. Use
`--universal` if one needs to.

**Secrets.** `.env.production` holds `META_APP_SECRET` and is gitignored — keep
it that way. Vite only inlines `VITE_`-prefixed variables into the bundle, so
the Meta secret never reaches the shipped app; it lives in the Convex
deployment's environment variables. Since `release` mode blanks the two `VITE_`
vars as well, a published `.dmg` contains no deployment identifiers at all — a
plain `npm run build` / `npm run tauri build` still bakes in whatever `.env.*`
provides, so use those for local runs, not for anything you hand out.

**Prerequisites** (one-time): Node 26 (`.nvmrc`), Rust via rustup, Xcode Command
Line Tools, and `gh auth login`. See [`SETUP.md`](./SETUP.md).
