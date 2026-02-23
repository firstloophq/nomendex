#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Missing GITHUB_TOKEN. Put it in ${ROOT_DIR}/.env or export it in your shell."
  exit 1
fi

echo "Installing private dependencies in bun-sidecar..."
(
  cd "${ROOT_DIR}/bun-sidecar"
  bun install
)

echo "Installing private dependencies in team-backend..."
(
  cd "${ROOT_DIR}/team-backend"
  bun install
)

echo "Done."
