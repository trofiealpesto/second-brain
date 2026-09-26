#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/second-brain-sync.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
git init -q --bare -b main "$test_root/remote.git"
git clone -q "$test_root/remote.git" "$test_root/vault"
git -C "$test_root/vault" config user.name 'Example Author'
git -C "$test_root/vault" config user.email 'example@example.invalid'
cp -R "$project_root/templates/vault/." "$test_root/vault/"
git -C "$test_root/vault" add .
git -C "$test_root/vault" commit -qm 'Initialize test vault'
git -C "$test_root/vault" push -qu origin main
printf '\nA synthetic local agent edit.\n' >> "$test_root/vault/concepts/example-workflow.md"
WIKI_PATH="$test_root/vault" bash "$project_root/integrations/hermes/wiki-autosync.sh"
git --git-dir="$test_root/remote.git" show main:concepts/example-workflow.md | grep -q 'synthetic local agent edit'
test -z "$(git -C "$test_root/vault" status --porcelain)"
first_head="$(git -C "$test_root/vault" rev-parse HEAD)"
WIKI_PATH="$test_root/vault" bash "$project_root/integrations/hermes/wiki-autosync.sh"
test "$first_head" = "$(git -C "$test_root/vault" rev-parse HEAD)"
echo 'PASS: isolated local edit -> commit -> push, clean worktree, idempotent repeat.'
