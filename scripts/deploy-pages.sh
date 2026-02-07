#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env.deploy ]]; then
  # shellcheck disable=SC1091
  set -a
  . ./.env.deploy
  set +a
fi

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-advui}"
DEPLOY_BRANCH="${CLOUDFLARE_PAGES_BRANCH:-main}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --branch)
      DEPLOY_BRANCH="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

HAS_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
HAS_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-}"

if [[ -n "$HAS_TOKEN" || -n "$HAS_ACCOUNT" ]]; then
  if [[ -z "$HAS_TOKEN" || -z "$HAS_ACCOUNT" ]]; then
    echo "If using API token auth, set both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID." >&2
    exit 1
  fi
  echo "Using Cloudflare API token + account ID from environment."
else
  echo "Using local Wrangler authentication (wrangler login/token)."
fi

if [[ ! -d dist ]]; then
  echo "dist/ not found. Run npm run build first." >&2
  exit 1
fi

echo "Deploying dist/ to Cloudflare Pages project '$PROJECT_NAME' (branch: $DEPLOY_BRANCH)"
npx --yes wrangler@4 pages deploy dist --project-name "$PROJECT_NAME" --branch "$DEPLOY_BRANCH"
