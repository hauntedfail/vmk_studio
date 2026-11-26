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
   - Verifies the assets with `scripts/verify-release-assets.mjs` on a macOS runner (see below). The draft is not created unless this passes.
   - Creates a **Draft GitHub Release** with extracted changelog notes and checksums attached, then downloads the draft and verifies it again, so a name or checksum that changed during upload fails the run.

3. Repeat the verification on your own Mac against the draft, then click **Publish release** on GitHub:

   ```sh
   npm run verify:release -- vX.Y.Z --launch
   ```

## Asset Verification

`scripts/verify-release-assets.mjs <vX.Y.Z> [--dir <assets-dir>] [--ref <git-ref>] [--launch]` downloads the release assets with `gh` (or reads them from `--dir`) and checks:

- **Asset set**: exactly one `.dmg`, `.app.tar.gz`, `.deb`, `.exe`, and `.msi` for the version, plus `SHA256SUMS.txt`, with names GitHub does not rewrite on upload.
- **Checksums**: every file is listed in `SHA256SUMS.txt` under its real name, with LF line endings, and its hash matches.
- **Windows and Linux**: installer container signatures, and the `Version` and `Architecture` fields of the Debian package. These installers are not launched.
- **macOS** (on a Mac): bundle version and identifier, universal architectures, `codesign --verify --deep --strict`, the bundled icon against `src-tauri/icons/icon.icns` at the tag, and that the `.dmg` and the tarball hold the same executable.
- **Launch** (`--launch`, on a Mac): the app starts, shows a window, and is still running five seconds later.

| Exit code | Meaning |
| --- | --- |
| `0` | Pass |
| `1` | Static violation (asset set, checksum, version, identity, signature, icon) |
| `2` | Launch violation (the app exited early or never showed a window) |
| `3` | The assets could not be downloaded |
| `5` | Tool or I/O error |

The launch check proves that the app starts, not that every screen works.

## Code Signing Notes

- macOS builds default to ad-hoc signing (`"signingIdentity": "-"` in `src-tauri/tauri.conf.json`) so releases work out of the box without paid Apple certificates.
- If you later configure `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` repository secrets, the release workflow passes them through automatically for Developer ID signing and notarisation.
