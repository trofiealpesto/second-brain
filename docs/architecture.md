# Architecture and the wiki method

## Compile knowledge, then retrieve it

A useful wiki is more than a pile of search results. The client LLM captures a
source in `raw/`, creates or updates focused pages, links related concepts, and
keeps `index.md` current. Later questions can reuse that synthesis and inspect its
sources. `SCHEMA.md` defines the contract; `log.md` records meaningful changes.

The Markdown files remain readable without this application. Git records their
history. MCP gives different AI clients a shared access path to the same content.
The backend indexes text; the client performs reasoning, summarization, and curation.

## Components and authority

| Component | Responsibility | Rebuildable? |
| --- | --- | --- |
| Private GitHub vault | Canonical Wiki Pages and their history | Preserve/back up the repository |
| R2 | Full text of Wiki Pages and externally ingested text | Wiki Pages from Git; external text needs its own backup |
| D1 | File metadata, chunks, FTS5, metrics, Siri change feed/retries | Search data from raw text; operational state needs separate consideration |
| Vectorize | Semantic vectors | From raw text using the same embedding model |
| Workers AI | Embeddings using `@cf/baai/bge-base-en-v1.5` (768 dimensions) | No generative curator is running here |
| KV | OAuth provider state | Loss may require reconnecting clients |
| Durable Object | MCP session | Clients can reconnect |

## Reading

The LLM calls `retrieve`, which combines Vectorize semantic candidates and D1
keyword candidates, with recency/deprecation ranking. It then calls `read` on the
few relevant file keys, following pagination when `truncated` is true. `grep`
provides focused matches within a known file. Neither a summary nor a retrieved
chunk should be used to overwrite an entire page: read the complete page first.

## Writing

**MCP:** `ingest` indexes the supplied text and, for Wiki Pages by default, writes
the page to GitHub. Updating a page, `index.md`, and `log.md` requires separate
calls. The client must check every result and recover partial operations.

**Git editing:** a signed push webhook fetches changed Markdown from the configured
repo/branch and updates the indexes. It does not write the fetched pages back to
GitHub. This is the path used by optional Obsidian and Hermes integrations.

**Siri:** its versioned API commits the page and log in one Git commit, using
revision checks, then projects the change into Cloudflare. A five-minute cron
retries failed projections. It uses OAuth/PKCE, not the automation bearer.

## What is guaranteed, and what is a convention

- Authentication and the explicit GitHub-login allowlist are enforced by the server.
- `SCHEMA.md` is included in bootstrap and webhook sync so remote-only clients can read it.
- Raw-source immutability, valid page types, graph reachability, and general
  index/log updates are **client conventions**, not globally enforced invariants.
  Siri separately enforces restrictions on its `raw/voice/` captures.
- MCP writes are not transactional across GitHub/R2/D1/Vectorize. A GitHub failure
  can leave an indexed page without a canonical commit. Such writes return
  `status: partial` and MCP `isError: true`; do not announce them as saved.
- A failed move destination preserves the original page, but may leave a partial
  destination in the index. A successful move does not rewrite inbound links.
- MCP edits do not yet have the optimistic concurrency protection used by Siri.
  Avoid concurrent writers editing the same page; see the reliability backlog.
- `ingest` accepts text. PDF parsing, OCR, URL fetching, automatic synthesis,
  and scheduled LLM maintenance are not included in the base service.

## Isolation boundary

Reusable source and personal runtime are independent. No original Git history,
personal vault, deployment config, credentials, or server installation is imported.
The optional Linux units are examples; no installer runs on clone or push.
The macOS replica uses a separate bundle/callback and per-server local storage.

An eventual upgrade of an existing installation is a separate task: record its
version/configuration, validate the integration contracts in a separate environment,
back up its state, plan rollback, and deploy only on the owner's explicit request.
