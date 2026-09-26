#!/usr/bin/env bash
set -euo pipefail
: "${WIKI_PATH:?Set WIKI_PATH to your own private vault clone}"
cd "$WIKI_PATH"
git rev-parse --is-inside-work-tree >/dev/null
lock_dir="$(git rev-parse --git-dir)/second-brain-autosync.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo 'Autosync already running or a stale lock exists; inspect before retrying.' >&2
  exit 1
fi
trap 'rmdir "$lock_dir"' EXIT
git add -A
if ! git diff --cached --quiet; then
  git commit -m 'chore: sync wiki edits'
fi
git pull --rebase --autostash
git push
