---
title: "Wiki contract"
type: concept
tags: ["meta", "schema"]
created: 2026-09-27
updated: 2026-09-27
sources: []
links: ["[[index]]"]
---

# Wiki contract

## Structure

Use one atomic subject per curated page. File keys are relative to this vault's
root, without a `wiki/` prefix. Standard folders:

- `entities/`: concrete people, projects, tools, organizations, and things.
- `concepts/`: ideas, definitions, and methods.
- `comparisons/`: decisions and trade-offs.
- `queries/`: reusable question/answer pages.
- `raw/`: immutable source captures, including `articles/`, `papers/`,
  `transcripts/`, `assets/`, `documents/`, and Siri's reserved `voice/` area.

Root meta pages are SCHEMA.md, index.md, log.md, purpose.md, and overview.md.
AGENTS.md and CLAUDE.md point to this contract; they do not duplicate it.

## Frontmatter

Curated pages require `title`, `type`, `tags`, `created`, `updated`, `sources`,
and `links`. Allowed types: `entity`, `concept`, `comparison`, `query`, `raw`.
Dates use YYYY-MM-DD. Bump `updated` whenever a page changes. Use lowercase tags
and reuse existing tags where appropriate. Sources may contain URLs and wikilinks.
Use full root-relative paths in wikilinks when filenames could be ambiguous.

## Capture and curate

1. Save the source text under a new raw path with provenance. Never overwrite a capture.
2. Create/update curated pages that cite the capture and separate evidence from inference.
3. Make every curated page reachable from index.md, directly or through other curated pages.
4. Append a dated entry to log.md. Preserve previous entries.
5. Confirm that each write was saved to GitHub. Multi-page MCP edits are separate operations.

Use `ingest` with `file_type: wiki_page` and GitHub write-back enabled for vault pages.
Read a complete page (including pagination) before replacing it. Search snippets
are not sufficient for safe updates. Discuss ambiguous merges/deletions with the user.

## Queries

Read the index, use retrieve for focused lookup, then read relevant pages. Cite the
paths and sources. Save recurring answers in queries/ when the user wants them retained.
Do not copy the entire vault into each conversation.

## Validation conventions

Check required frontmatter, broken links, index reachability, stale dates, and
unresolved TODO/FIXME/CONTRADICTION markers. These are conventions, not a complete
server-enforced validator.

- Links from log.md do not make a page reachable for navigation.
- SCHEMA.md, AGENTS.md, and CLAUDE.md are exempt from broken-link and marker checks
  because they can contain syntax examples such as [[other-page]].
- raw/ is exempt from orphan, stale, and strict frontmatter checks: source text is immutable.
- raw/voice/ is the exception: Siri captures require standard raw frontmatter, the
  `voice-capture` tag, and sources/links fields. Do not edit, move, or archive them through Siri.
- Parse frontmatter arrays as YAML, not as a single body-text wikilink.

## Persistence and privacy

A partial write is not a successful save. Report failed GitHub writes and incomplete
index/log updates. Keep credentials and recovery codes out of the wiki. The LLM
provider receives the excerpts you ask it to read. Git history may retain earlier content.
