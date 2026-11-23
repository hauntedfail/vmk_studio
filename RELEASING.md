# Releasing VMK Studio

VMK Studio uses a gated, draft-first release flow so untested artefacts are never published automatically.

## Version Policy

- VMK Studio starts at `0.4.0` (following upstream ZMK Studio's `v0.3.1` tag history to avoid tag collisions).
- Three files must always declare the exact same SemVer version:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
- `scripts/generate-release-data.js` derives its fallback version automatically from `package.json`.
- `CHANGELOG.md` must contain a matching `## [X.Y.Z]` section before tagging.

## Pre-Release Checklist

1. Ensure `main` is clean and all intended changes are merged with green CI (`.github/workflows/ci.yml`).
2. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`, and add the `## [X.Y.Z]` entry to `CHANGELOG.md`.
3. Run the full local verification suite:

   ```sh
   npm run check:release -- vX.Y.Z
   ```

   This runs:
   - Version sync & changelog verification (`scripts/check-version-sync.mjs`)
   - TypeScript type-check (`tsc --noEmit` for both app and Node scripts)
   - Strict ESLint on VMK Studio modules (`npm run lint:vmk`)
   - Vitest unit and safety tests (`npm test`)
   - Production Vite build (`npm run build`)
   - Preview bundle HTTP smoke test (`scripts/smoke-preview.mjs`)
   - Rust formatting (`cargo fmt --all --check`), strict Clippy (`-D warnings`), and unit tests (`cargo test --all-targets --all-features`)

4. Optional dry-run bundle build in GitHub Actions (recommended before the first release or workflow changes):

   ```sh
   gh workflow run release.yml -f dry_run=true -f expected_version=X.Y.Z
   ```

   Inspect the uploaded `vmk-studio-*` workflow artefacts and checksums once green.

## Cutting a Release

1. Create a signed annotated tag on the verified `main` commit and push it:

   ```sh
   git tag -s vX.Y.Z -m "VMK Studio vX.Y.Z"
   git push origin vX.Y.Z
   ```

2. `.github/workflows/release.yml` automatically:
   - Re-runs the full frontend and Rust quality gates (blocking bundle builds if anything fails).
   - Verifies that the tag matches `package.json`, `Cargo.toml`, `tauri.conf.json`, and `CHANGELOG.md`.
   - Builds Tauri bundles for macOS (universal `.dmg` + `.app.tar.gz`), Linux (`.deb`), and Windows (`.exe` / `.msi`).
   - Generates a unified `SHA256SUMS.txt`.
   - Creates a **Draft GitHub Release** with extracted changelog notes and checksums attached.

3. Review the Draft GitHub Release on GitHub, spot-check the downloaded installer on macOS, and click **Publish release** when ready.

## Code Signing Notes

- macOS builds default to ad-hoc signing (`"signingIdentity": "-"` in `src-tauri/tauri.conf.json`) so releases work out of the box without paid Apple certificates.
- If you later configure `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` repository secrets, the release workflow passes them through automatically for Developer ID signing and notarisation.
