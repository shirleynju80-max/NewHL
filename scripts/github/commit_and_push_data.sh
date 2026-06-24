#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <commit-message> <path> [path ...]" >&2
  exit 2
fi

message="$1"
shift
branch="${GITHUB_REF_NAME:-main}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -f "$@"

if git diff --staged --quiet; then
  echo "No data changes to commit"
  exit 0
fi

git commit -m "$message"

attempt=1
while [ "$attempt" -le 3 ]; do
  echo "Push attempt ${attempt}/3 to ${branch}"
  if git pull --rebase origin "$branch" && git push origin "HEAD:${branch}"; then
    exit 0
  fi

  rc=$?
  git rebase --abort 2>/dev/null || true

  if [ "$attempt" -eq 3 ]; then
    echo "Failed to push after ${attempt} attempts" >&2
    exit "$rc"
  fi

  sleep $((attempt * 10))
  attempt=$((attempt + 1))
done
