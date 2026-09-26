#!/usr/bin/env bash
set -euo pipefail
: "${WIKI_PATH:?Set WIKI_PATH to your own private vault clone}"
cd "$WIKI_PATH"
echo "# Wiki health — $(date -u +%Y-%m-%d)"
echo
echo "Tracked Markdown pages: $(git ls-files '*.md' | wc -l | tr -d ' ')"
echo
echo '## Recent commits'
git log --since='7 days ago' --max-count=15 --format='- %ad %s' --date=short
echo
echo '## Markers (inspect findings; this is not a structural linter)'
git grep -n -E 'TODO|FIXME|CONTRADICTION' -- '*.md' ':!SCHEMA.md' ':!AGENTS.md' ':!CLAUDE.md' ':!raw/**' || test "$?" = 1
