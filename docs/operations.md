# Operations, limits, and recovery

## Credentials and authentication

- OAuth App client ID/secret authenticate GitHub users. They are separate from
  the PAT used by the Worker to access your private repository.
- Keep the vault PAT restricted to Contents read/write on your vault. Configure
  Issues permissions only if you enable reminders on an alert repository.
- Rotate `GITHUB_TOKEN` and update optional `GITHUB_TOKEN_EXPIRY` together.
- Changing `COOKIE_ENCRYPTION_KEY` can invalidate sessions. Reconnect clients
  when OAuth is revoked/expired or metadata has changed.
- The automation token grants access to the `/api/*` surface. Keep it out of
  client prompts, vault pages, committed files, and the Siri app.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| OAuth login denied | Verify explicit `ALLOWED_GITHUB_LOGINS`, OAuth callback origin, and client registration |
| Client reports expired authorization | Reconnect that MCP connection; do not rotate unrelated credentials |
| Only some tools appear | Refresh connector metadata and begin a new conversation |
| `github_pushed: false` / `status: partial` | Check PAT scope/expiry, configured owner/repo/branch, branch protections; indexed text is not proof of a canonical commit |
| Git edit missing from search | Inspect signed push delivery and response body; verify branch and file path, then redeliver after fixing the error |
| `SCHEMA.md` unreadable | Bootstrap the current contract and verify subsequent webhook updates |
| Semantic results absent | Check AI/Vectorize bindings, dimensions, quotas, and indexing errors; keyword fallback can mask a semantic outage |
| Large reindex fails | Reindex individual files with bounded pacing; bulk resumable jobs are backlog work |
| Siri projection pending | Check five-minute cron and retry table; canonical GitHub content remains authoritative for Siri changes |
| Autosync conflict | Stop and resolve Git conflicts deliberately; do not force-push or automatically discard local changes |

The code is text-first. A PDF must be extracted to text outside this service before
`ingest`. A raw PDF binary or a URL string is not parsed or fetched automatically.

## Privacy and retention

GitHub holds your Wiki Pages, including raw Markdown captures committed there.
Cloudflare R2 holds indexed full text. D1/Vectorize hold derived content and
metadata. Your LLM provider receives the content returned by tools you invoke.

Current non-Siri retrieval metrics store up to **500 characters of the query** in
D1. There is no configured retention purge or query-text opt-out yet. Siri search
deliberately avoids storing query metrics. This limitation is tracked in the
backlog; do not assume all searches are metadata-only.

Siri may copy active pages into local SwiftData and Spotlight after user consent.
Its disconnect flow clears its own cache and credentials. Git history, independent
backups, and provider-side logs are separate; deleting a page does not erase every
historical copy.

## Backup and restore

For Wiki Pages, preserve a private Git mirror/export independently of the deployed
Worker. Periodically restore into a **new test vault**, inspect its history, and
bootstrap a distinct Worker. Never test restore against a live vault.

`file_type: ingested` content exists only in R2 and needs an independent R2 backup.
Back up D1 too if you need its metrics, Siri operational state, and the file-to-R2
mapping. Reindex does not discover arbitrary R2 objects: it uses D1 file records.

Recovering Wiki Page search from Git:

1. Restore/clone the authoritative private vault.
2. Provision fresh resources and apply all migrations.
3. Bootstrap the restored Markdown into the fresh instance.
4. Verify representative full-text reads and retrieval results.
5. Reconnect clients only after checking the restored instance.

For Cloudflare-only text, restore raw objects and their metadata consistently,
then reindex. A supported one-command complete export/restore is backlog work;
Git alone is not a complete backup for that storage mode.

## Costs

Small personal workloads may fit included allowances, but there is no unconditional
zero-cost promise. Index size, embeddings, reindex frequency, requests, and storage
affect usage. AI-client subscriptions and optional Hermes inference are separate.

Check current official pricing before enabling resources:
[Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/),
[Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/),
[R2](https://developers.cloudflare.com/r2/pricing/).
Pricing links and configuration were reviewed during preparation on 2026-09-27;
verify current terms for your account. Monitor the Cloudflare usage dashboards.

## Existing personal deployment

All procedures above target the operator's deliberately selected instance. This
repository does not modify an existing private installation. An upgrade is a
separate change with its own backup, integration tests, approval, and rollback.
