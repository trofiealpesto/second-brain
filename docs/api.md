# Interfaces and compatibility

The public-copy preparation preserves the Worker routes and seven MCP tool names.
The private vault root is the file-key root: `concepts/example.md`, `index.md`,
`SCHEMA.md`. The inherited ingestion guard also strips a leading `wiki/` prefix;
new clients should always use the canonical root-relative form.

## MCP: `/mcp`

GitHub OAuth, explicit login allowlist, Streamable HTTP.

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `retrieve` | `query`, optional `limit` (1–50), `file_type`, `section_prefix`, `file_key_prefix` | Hybrid results with source file keys |
| `read` | `file_key`, optional `offset`, `max_chars` (up to 10000) | Full-text slice, total length and truncation flag |
| `grep` | `file_key`, `pattern`, optional `max_matches`, `context` | JavaScript regex matches within a file |
| `ingest` | `file_key`, `content`, `file_type`, optional `title`, `source`, `push_to_github` | Replace/index text; Wiki Pages write back by default |
| `move` | `from_file_key`, `to_file_key`, optional `content` | Create destination, then remove source; update links separately |
| `delete` | `file_key`, optional `push_to_github` | Remove indexed file and, by default, its canonical Wiki Page |
| `reindex` | optional `file_key` | Rebuild one/all indexed files from R2 |

`file_type` is `wiki_page` or `ingested`. MCP returns model-readable text; callers
must honor `isError`. A failed write-back returns an explicit partial result.

## Automation REST: `/api/*`

Every route requires `Authorization: Bearer <AUTOMATION_API_TOKEN>`. This is a
server/bootstrap credential, not the token used by your OAuth MCP client.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Index counts and service health |
| GET | `/api/metrics` | Aggregate retrieval metrics |
| POST | `/api/ingest` | Ingest text using the same fields as the MCP tool |
| POST | `/api/retrieve` | Query with optional nested `filter` object |
| POST | `/api/read` | Read raw text with offset/length |
| POST | `/api/grep` | Regex search within a known file |
| POST | `/api/reindex` | Reindex one/all files from R2 |

REST `retrieve` uses `{ "query": "...", "filter": { "file_key_prefix": "concepts/" } }`;
the MCP tool exposes those filter fields at the top level. Do not interchange them.
There are no new REST move/delete endpoints in this preparation.

## GitHub webhook: `/webhook/github`

POST a GitHub push payload, authenticated by `X-Hub-Signature-256` using
`WEBHOOK_SECRET`. Only the configured branch is processed. Changed `.md` files
are fetched from the configured vault; deleted paths are removed from the index.
Root `README.md`, `AGENTS.md`, and `CLAUDE.md` are excluded; `SCHEMA.md` is included.
Use a unique secret for this vault and do not share it across repositories.
HTTP 200 can contain `status: partial` with per-file errors.

## Siri API: `/v1/siri/*`

OAuth Authorization Code + PKCE S256, scopes `brain.read`/`brain.write`; the
automation bearer is not accepted. Reads/search, immutable voice captures,
revision-checked page changes, and reversible archive routes are preserved.
Mutations use `If-Match`. See [the Siri guide](../apps/siri/README.md).

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/siri/sync` | Snapshot or incremental changes via `cursor` |
| POST | `/v1/siri/search` | Retrieval without recording the question in metrics |
| POST | `/v1/siri/captures` | Create an immutable voice page from `content` and optional `title` |
| PATCH | `/v1/siri/pages/{encoded-file-key}` | Append, replace, rename, or move with `If-Match` |
| POST | `/v1/siri/pages/{encoded-file-key}/archive` | Reversible archive with `If-Match` |

Captures return `canonical_commit`, `revision`, and `sync_pending`: HTTP 201 when
projected, HTTP 202 when GitHub is committed but indexing needs retry. Encode the
entire file key as one URL component; keep the existing API's field names.

## Intentional differences from the imported personal version

- The example/test compatibility date is `2024-09-23`, enabling the Node.js
  compatibility needed by the inherited dependency bundle (`path` in mime-types).
  See [Cloudflare's Node.js compatibility requirements](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

- Vault owner/name/branch and alert destination are configuration, not constants.
- No implicit allowed GitHub login; missing allowlist denies access.
- MCP mutations report partial GitHub failure via `isError`; REST ingestion keeps
  its result fields and uses `status: partial` with HTTP 200 for partial outcomes.
- Bootstrap treats those partial outcomes as failures and exits unsuccessfully.
- A move does not delete its source if destination GitHub write-back fails.
- Webhook and reindex paths do not write content back to GitHub.
- The contract page stays synchronized and accessible to remote-only clients.
- Siri's replica callback is `secondbrain-replica://oauth/callback`; its API
  routes are unchanged. Bundle, credentials, and local caches are isolated.

No existing deployment receives these differences automatically. No database
schema migrations beyond the five imported migrations were added.
