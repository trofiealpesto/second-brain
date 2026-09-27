# Upgrade an existing installation deliberately

An upgrade needs its owner's explicit request. Publishing or updating this
repository never deploys an existing installation. Keep instance configuration,
secrets, operational inventories, and backup contents outside the public checkout.

## Preserve the integration boundary

For a code-only migration, retain the Worker name/origin, R2/D1/Vectorize bindings,
OAuth KV namespace and secrets, Durable Object class/binding, schedules, vault
repository/branch, and webhook secret. Existing MCP clients and Siri can then
continue using the same endpoints. Keep local Hermes/Obsidian clones, autosync
units, prompts, and client settings in place.

Set the new variables explicitly in a **private instance config**:
`WIKI_REPO_OWNER`, `WIKI_REPO_NAME`, `WIKI_BRANCH`, `ALLOWED_GITHUB_LOGINS`.
If reminders were enabled, also preserve their existing destination with
`ALERT_REPO_OWNER` and `ALERT_REPO_NAME`. Missing allowlist now denies access.

The optional Siri replica is a separate application identity. Updating the Worker
does not require replacing an already installed Siri app, changing its callback,
or moving its local data.

## Before deployment

1. Record the current deployment/version, remote bindings, schedules, secret names,
   Git revisions, uncommitted source changes, and relevant server/client hashes.
2. Back up the canonical vault and raw content. Capture a D1 Time Travel bookmark
   and an appropriate data backup. Standard D1 export rejects databases containing
   FTS5 virtual tables; do not remove those tables to make export work. Preserve
   source rows/schema and rebuild derived FTS data only as part of a tested restore.
3. Compare the current installation with the target revision. Check dependency,
   database, OAuth, MCP, webhook, and Siri API compatibility. Apply no schema
   migrations when none are required.
4. Rehearse against distinct cloud resources and a synthetic private vault.
   Test real Git push delivery, MCP writes/reads/moves/deletes, partial GitHub
   failures, and Siri scope/revision enforcement. Distinguish fixture grants from
   an interactive OAuth login in the user's client.
5. Prepare the exact rollback command using the recorded version ID. A Worker
   rollback restores code/configuration, not changes already made to stored data.

## Deploy and verify

Use an explicit private config and inspect a dry run. `wrangler versions upload`
prepares a version without changing production traffic; `wrangler versions deploy`
activates it. Preserve dashboard variables with `--keep-vars` when uploading.
Secrets remain in the existing Worker; do not copy them into the public repo.
Version deployment preserves the existing separately managed schedules.

Check the deployed version and bindings, read existing pages, exercise the existing
clients, and observe webhook/autosync operation. If writing a synthetic production
probe, use a unique disposable path and clean it up through the same synchronization
path. Do not bootstrap the example vault over existing knowledge.

If a regression appears, roll back to the recorded Worker version, then verify the
same interfaces again. Do not automatically restore the whole data store: that
could discard legitimate concurrent edits.

See Cloudflare's [version deployment](https://developers.cloudflare.com/workers/versions-and-deployments/)
and [rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
