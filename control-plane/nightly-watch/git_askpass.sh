#!/usr/bin/env bash
# Git invokes this helper only when HTTPS authentication is required. The token
# remains in the UC1 process environment; it is never written to disk.
set -euo pipefail

case "${1:-}" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${UC1_GITHUB_TOKEN:?UC1_GITHUB_TOKEN is required}" ;;
  *) exit 1 ;;
esac
