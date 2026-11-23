#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TAG_ARG=""
if [[ "${1:-}" != "" ]]; then
  TAG_ARG="$1"
fi

echo "==> [1/7] Version sync & changelog check"
if [[ -n "$TAG_ARG" ]]; then
  node scripts/check-version-sync.mjs --require-changelog --tag "$TAG_ARG"
else
  node scripts/check-version-sync.mjs --require-changelog
fi

echo "==> [2/7] TypeScript type-check (app + node scripts)"
npm run typecheck

echo "==> [3/7] ESLint (VMK Studio modules)"
npm run lint:vmk

echo "==> [4/7] Frontend unit & safety tests (Vitest)"
npm test

echo "==> [5/7] Production frontend build"
npm run build

echo "==> [6/7] Production preview smoke test"
node scripts/smoke-preview.mjs

echo "==> [7/7] Rust formatting, strict Clippy, and unit tests"
(
  cd src-tauri
  cargo fmt --all --check
  cargo clippy --all-targets --all-features -- -D warnings
  cargo test --all-targets --all-features
)

echo ""
echo "All pre-release verification gates passed."
