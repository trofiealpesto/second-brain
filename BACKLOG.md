# Backlog

These are proposals, not features promised by the current release. None is deployed
to any existing personal installation. Effort is relative: S = focused change,
M = several coordinated changes, L = architectural work and migration/testing.

## P1 — Reliability and operational clarity

### SB-001 — Canonical writes and conflict handling (L)
- Evidence: MCP indexes before GitHub write-back; multi-page curation is several
  calls. Siri already has canonical commits and revision checks.
- Benefit: consistent page/index/log writes, explicit conflicts, fewer split states.
- Acceptance: failures cannot masquerade as persistence; stale writers cannot
  overwrite newer revisions; canonical changes can be replayed into all indexes;
  tests cover interrupted writes, moves, deletes, and concurrent clients.
- Dependencies: preserve existing tool contracts or version any breaking change.

### SB-002 — Deterministic wiki validation (M)
- Evidence: the contract is mostly instructions; existing shell health scripts
  use heuristics and do not implement full YAML/link-graph validation. Automatic
  frontmatter defaults can use `type: wiki`, outside the curated contract.
- Benefit: reproducible diagnostics instead of differing LLM lint interpretations.
- Acceptance: YAML-aware frontmatter, broken links, index reachability, staleness,
  aliases/anchors, and immutable-source exemptions have fixtures. Links in the
  log cannot hide orphans. Documentation syntax examples are not defects.
- Dependencies: settle contract defaults first; expose a read-only report before auto-fix.

### SB-003 — Cloud diagnostics and reconciliation (M)
- Evidence: webhook can return per-file partial errors; general ingestion has no
  resumable reconciliation job. Siri projection retry covers only its write path.
- Benefit: detect and repair GitHub/R2/D1/Vectorize drift without a home server.
- Acceptance: inventory differences, bounded retry, idempotent recovery, no
  GitHub write loops, and an observable failure state on exhausted retries.
- Dependencies: SB-001 write semantics; preserve Cloudflare-only ingested content.

### SB-004 — Retrieval metrics privacy and retention (S–M)
- Evidence: normal retrieval persists the first 500 query characters; no retention
  purge is configured. Siri search omits query metrics.
- Benefit: useful operational metrics with an explicit data-minimization policy.
- Acceptance: configurable query-text collection, a documented safe default,
  retention cleanup, and tests proving disabled collection stores no query text.
- Dependencies: define compatibility for existing metrics and dashboards.

## P2 — Knowledge quality and acquisition

### SB-005 — Italian/English retrieval evaluation (M)
- Evidence: current embedding model and FTS stemming are English-oriented;
  personal knowledge and questions can be multilingual.
- Benefit: choose ranking/model changes from measured retrieval quality.
- Acceptance: synthetic bilingual question/source dataset; recall/ranking/latency
  baseline; comparison of multilingual embeddings and ranking; migration plan
  for vector dimensions/model versions before any production switch.
- Dependencies: dataset first; no model replacement based on anecdotes.

### SB-006 — URL/document import (L)
- Evidence: ingestion accepts text only despite historical documentation mentioning PDFs.
- Benefit: reliable capture with source provenance and less manual preprocessing.
- Acceptance: supported formats explicitly listed; extraction/OCR failures visible;
  source identity, capture time, deduplication, limits, and extraction quality tested.
- Dependencies: raw-source contract, storage/backup policy, cost limits.

### SB-007 — Inbox and reviewed curation (M–L)
- Evidence: the base workflow depends on the client to synthesize sources, update
  links/log, and handle contradictions; captures and curated pages are separate conventions.
- Benefit: sources can wait in an inbox until a reviewable synthesis is ready.
- Acceptance: original capture preserved; proposed page/index/log changes have
  readable diffs; conflicts and ambiguous merges require user decisions.
- Dependencies: SB-001 and SB-002; ingestion must not execute source instructions.

### SB-008 — Maintenance without Hermes (M)
- Evidence: optional maintenance currently assumes a local agent/scheduler.
- Benefit: health reports and periodic review for cloud-only users.
- Acceptance: deterministic checks run without an LLM; model-driven tasks require
  explicit configuration, budgets, and a selected provider; unchanged healthy
  state stays quiet; no automatic destructive edits.
- Dependencies: SB-002/SB-003; inference costs separate from the MCP client's subscription.

## P3 — Installation and recovery

### SB-009 — Repeatable provisioning and complete export/restore (L)
- Evidence: installation uses a guided manual sequence; Git cannot restore
  Cloudflare-only ingested text or all operational state.
- Benefit: easier independent installations and a tested escape/recovery path.
- Acceptance: idempotent previewable provisioning; explicit resource ownership;
  export manifest covering Git, R2, and necessary D1 state; restore into fresh
  resources; no implicit migration or overwrite of an existing installation.
- Dependencies: documented secret handling, SB-003 reconciliation, recovery fixtures.

Recommended sequence: SB-001 → SB-002 → SB-003, with SB-004 in parallel when
scheduled; evaluate retrieval before adding acquisition and autonomous curation.
