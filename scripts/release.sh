#!/usr/bin/env bash
#
# Builds the macOS bundle and publishes a tagged GitHub release.
# See plans/BUILD.md for the walkthrough and the manual equivalent.
#
# Usage: npm run release -- <patch|minor|major|X.Y.Z> [--universal] [--draft] [--dry-run]

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUMP=""
TARGET_FLAGS=()
BUNDLE_DIR="src-tauri/target/release/bundle/dmg"
ARCH_LABEL="Apple Silicon"
DRAFT=()
DRY_RUN=false

die() { printf '\n\033[31mrelease: %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major) BUMP="$1" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$1" ;;
    --universal)
      TARGET_FLAGS=(--target universal-apple-darwin)
      BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
      ARCH_LABEL="Universal"
      ;;
    --draft) DRAFT=(--draft) ;;
    --dry-run) DRY_RUN=true ;;
    *) die "unknown argument '$1' (expected patch|minor|major|X.Y.Z [--universal] [--draft] [--dry-run])" ;;
  esac
  shift
done

[[ -n "$BUMP" ]] || die "no version given. Usage: npm run release -- <patch|minor|major|X.Y.Z>"

# ---------------------------------------------------------------- preflight

step "Preflight"

command -v cargo >/dev/null || die "cargo not found. Install Rust: https://rustup.rs"
command -v gh >/dev/null || die "gh not found. Install the GitHub CLI: brew install gh"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || die "on branch '$BRANCH'; releases are cut from main."
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty. Commit or stash first."

git fetch --quiet origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "local main and origin/main differ. Pull or push first."

if [[ "${TARGET_FLAGS[*]:-}" == *universal* ]]; then
  rustup target list --installed | grep -q x86_64-apple-darwin \
    || die "a universal build needs the Intel target: rustup target add x86_64-apple-darwin"
fi

CURRENT="$(node -p "require('./package.json').version")"
echo "current version: $CURRENT"

# ------------------------------------------------------------------- verify

step "Lint, typecheck and tests"
npm run lint
npm run test

# ------------------------------------------------------------------ version

step "Bumping version"

# An EXIT trap, not ERR: die() exits outright, which an ERR trap never sees. Any
# path out of this script before the commit must leave the version files alone.
VERSION_BUMPED=false
restore_version() {
  [[ "$VERSION_BUMPED" == true ]] || return 0
  git checkout -- package.json package-lock.json src-tauri/tauri.conf.json \
    src-tauri/Cargo.toml src-tauri/Cargo.lock 2>/dev/null || true
}
trap 'restore_version' EXIT

npm version "$BUMP" --no-git-tag-version >/dev/null
VERSION_BUMPED=true
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
echo "$CURRENT -> $VERSION"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists."
gh release view "$TAG" >/dev/null 2>&1 && die "a GitHub release for $TAG already exists."

# The version lives in three files; they must not drift apart.
# Rewritten line-wise rather than via a JSON round-trip, which would reflow the
# rest of tauri.conf.json and bury the one-line change in noise.
node -e '
  const fs = require("fs");
  const version = process.argv[1];
  const edit = (file, re, replacement) => {
    const before = fs.readFileSync(file, "utf8");
    const after = before.replace(re, replacement);
    if (after === before) throw new Error(`could not find the version line in ${file}`);
    fs.writeFileSync(file, after);
  };
  edit("src-tauri/tauri.conf.json", /^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
  edit("src-tauri/Cargo.toml", /^version = "[^"]*"$/m, `version = "${version}"`);
  if (JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version !== version) {
    throw new Error("tauri.conf.json version did not take");
  }
' "$VERSION"

# -------------------------------------------------------------------- build

step "Building the macOS bundle ($ARCH_LABEL)"
# The overlay config swaps beforeBuildCommand for `npm run build:release`, whose
# `release` Vite mode blanks VITE_CONVEX_URL / VITE_CONVEX_SITE_URL. A published
# build must ship with no deployment baked in — the app asks on first launch.
# Expanded this way because macOS ships bash 3.2, where "${arr[@]}" on an
# empty array trips `set -u`.
npm run tauri build -- --config src-tauri/tauri.release.conf.json ${TARGET_FLAGS[@]+"${TARGET_FLAGS[@]}"}

step "Verifying no Convex deployment leaked into the bundle"
# `happy-otter-123` is the example URL in the convex client's own error message,
# not a deployment; everything else is a real backend the download would call.
FOUND="$(grep -rhoE 'https://[a-z0-9-]+\.convex\.(cloud|site)' dist/assets \
  | grep -v 'happy-otter-123' | sort -u || true)"
if [[ -n "$FOUND" ]]; then
  echo "$FOUND" >&2
  die "a Convex deployment URL is in the built assets. Do not ship this."
fi
echo "no deployment URL in the bundle: ok"

DMG="$(ls -t "$BUNDLE_DIR"/*.dmg 2>/dev/null | head -1 || true)"
[[ -n "$DMG" && -f "$DMG" ]] || die "no .dmg found in $BUNDLE_DIR"
APP="$(dirname "$BUNDLE_DIR")/macos/$(node -p "require('./src-tauri/tauri.conf.json').productName").app"
if [[ -d "$APP" ]]; then
  codesign --verify --strict "$APP" || die "the .app failed signature verification."
  echo "ad-hoc signature verified"
fi
echo "dmg: $DMG ($(du -h "$DMG" | cut -f1))"

# ------------------------------------------------------------------ release

NOTES_FILE="$(mktemp)"
{
  echo "## Changes"
  echo
  if git rev-parse -q --verify "refs/tags/v$CURRENT" >/dev/null; then
    git log --no-merges --pretty='- %s' "v$CURRENT..HEAD"
  else
    git log --no-merges --pretty='- %s' -20
  fi
  echo
  echo "## First run"
  echo
  echo "This build ships with no backend configured. On first launch the app asks"
  echo "for the Convex deployment it should use — deploy your own with"
  echo '`npx convex deploy` and paste the two URLs it prints. See the README for'
  echo "the full setup (Convex deployment + your own Meta developer app)."
  echo
  echo "## Install"
  echo
  echo "Download the .dmg, drag **LevelWell Social** to Applications, then clear the"
  echo "quarantine flag — the bundle is ad-hoc signed, not notarized, so macOS blocks"
  echo "the first launch:"
  echo
  echo '```bash'
  echo 'xattr -dr com.apple.quarantine "/Applications/LevelWell Social.app"'
  echo '```'
  echo
  echo "Or open **System Settings → Privacy & Security** and click **Open Anyway**."
} > "$NOTES_FILE"

if [[ "$DRY_RUN" == true ]]; then
  step "Dry run — stopping before commit, tag and publish"
  echo "would commit:  chore: release $TAG"
  echo "would tag:     $TAG"
  echo "would upload:  $DMG"
  echo
  cat "$NOTES_FILE"
  rm -f "$NOTES_FILE"
  echo
  echo "version files will be restored; nothing was pushed."
  exit 0
fi

step "Committing, tagging and pushing"
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release $TAG"
VERSION_BUMPED=false   # committed: the trap must not undo it
git tag -a "$TAG" -m "$TAG"
git push origin main
git push origin "$TAG"

step "Publishing the GitHub release"
gh release create "$TAG" \
  --title "$TAG" \
  --notes-file "$NOTES_FILE" \
  ${DRAFT[@]+"${DRAFT[@]}"} \
  "$DMG#LevelWell Social $VERSION ($ARCH_LABEL)"
rm -f "$NOTES_FILE"

step "Done"
gh release view "$TAG" --web >/dev/null 2>&1 || true
echo "released $TAG"
