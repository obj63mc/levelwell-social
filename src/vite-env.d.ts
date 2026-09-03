/// <reference types="vite/client" />

// Only a default for local dev and maintainer builds; a release build blanks both
// (see the `release` mode `define` in vite.config.ts), hence optional.
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_CONVEX_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
