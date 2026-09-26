# Set up an independent cloud instance

This guide starts from a new vault and new Cloudflare resources. Use your own
accounts. No home server is required. Node.js 22+, npm, Git, and a Cloudflare
account with Workers, D1, R2, Vectorize, and Workers AI enabled are prerequisites.
Service activation and free allowances vary; check [costs](operations.md#costs).

## 1. Get the application and create your private vault

Clone this project's repository and run `npm ci`. In GitHub create an **empty,
private** repository for your knowledge, with a default branch named `main`.
This is distinct from the application repository.

From the application checkout:

```sh
cp -R templates/vault ../my-second-brain-vault
git -C ../my-second-brain-vault init -b main
git -C ../my-second-brain-vault add .
git -C ../my-second-brain-vault commit -m "Initialize private knowledge vault"
git -C ../my-second-brain-vault remote add origin https://github.com/YOUR_LOGIN/YOUR_PRIVATE_VAULT.git
git -C ../my-second-brain-vault push -u origin main
```

Set a Git name/email locally if Git requests them. Review the synthetic example
pages; retain or remove them together with their references in `index.md`.

## 2. Create new Cloudflare resources

Choose a unique prefix, used consistently throughout the following commands and
configuration. The example is `second-brain-example`; do not reuse an existing
installation's names or IDs.

```sh
npx wrangler login
npx wrangler r2 bucket create second-brain-example-raw
npx wrangler d1 create second-brain-example
npx wrangler kv namespace create SECOND_BRAIN_EXAMPLE_OAUTH
npx wrangler vectorize create second-brain-example-embeddings --dimensions 768 --metric cosine
cp wrangler.toml.example wrangler.toml
```

Edit the ignored `wrangler.toml`: Worker name, bucket/database/index names, D1 ID,
KV ID, `WIKI_REPO_OWNER`, `WIKI_REPO_NAME`, `WIKI_BRANCH`, and
`ALLOWED_GITHUB_LOGINS`. The latter is a comma-separated explicit list of accounts
allowed to use this single personal vault. Missing allowlist means access denied.

These logins share the same vault; this is not a multi-tenant service.
Leave alert-repo variables unset unless you want token-expiry issues.

```sh
npm run db:migrate:remote
```

This applies **all five** included D1 migrations, including the Siri change feed
and retry tables. The binding name `DB` resolves your configured database.
Keep the Durable Object migration and both cron expressions in the example.

## 3. Configure identity and secrets

Create your own [GitHub OAuth App](https://github.com/settings/developers).
Use your intended Worker origin for its Homepage URL and
`https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/callback` for its callback.
This authenticates users; it does not provide the vault's server-side write token.

Separately create a fine-grained GitHub PAT restricted to your **private vault**,
with **Contents: read and write** and an explicit expiry. If you enable token
reminders, also grant **Issues: read and write** on the selected alert repository.
Organization-owned repositories may require owner approval of the token.

Set secrets using Wrangler's interactive prompts, never by committing them or
pasting them into an AI conversation:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put AUTOMATION_API_TOKEN
```

Use independently generated random values (at least 32 random bytes) for the
cookie key, webhook secret, and automation token. Store them in your password
manager. Only the OAuth client ID is public metadata; handling it as a secret is
consistent with the existing Worker interface.

Optional: configure both `ALERT_REPO_OWNER` and `ALERT_REPO_NAME`, then set
`GITHUB_TOKEN_EXPIRY` with `wrangler secret put` to the PAT expiry in ISO format.
Reminders are best-effort and use that same PAT: an already expired token cannot
create its own reminder, so keep a separate credential-expiry reminder as well.

## 4. Deploy deliberately

Review the resource names and vault settings one more time:

```sh
npx wrangler deploy --dry-run
npm run deploy
```

Use the actual returned HTTPS origin for subsequent steps. Update your GitHub
OAuth App callback if that origin differs from the one you initially entered.
No GitHub Actions workflow in this repository deploys the Worker for you.

## 5. Index the template

The vault root maps directly to file keys. Do not add a `wiki/` prefix.

```sh
npm run setup:dry -- --wiki-dir ../my-second-brain-vault
```

The list includes `SCHEMA.md`, index/log, and the content pages. It excludes hidden
directories and root `README.md`, `AGENTS.md`, and `CLAUDE.md` pointer files.

In a temporary **Bash** session, enter your automation secret without shell-history
exposure (the variable name is specific to this application):

```bash
read -rsp 'Automation token: ' SECOND_BRAIN_AUTOMATION_TOKEN
echo
export SECOND_BRAIN_AUTOMATION_TOKEN
npm run setup -- --wiki-dir ../my-second-brain-vault --url https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
unset SECOND_BRAIN_AUTOMATION_TOKEN
```

Bootstrap writes Wiki Pages back to your configured vault as well as indexing
them. Every item must succeed. HTTP 200 with a failed GitHub write counts as a
failure. Fix permissions/configuration and rerun; repeated ingestion replaces the
page's indexed chunks rather than duplicating the page.

## 6. Configure the vault webhook

In **your private vault repository**, Settings → Webhooks → Add webhook:

- Payload URL: `https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/webhook/github`
- Content type: `application/json`
- Secret: the same independently generated `WEBHOOK_SECRET`
- Events: push events only; keep SSL verification enabled.

The handler processes the configured branch. A GitHub ping is not a push test:
make an actual synthetic Markdown edit and inspect its push delivery. Then read
the updated file through MCP. Check the response body for `status: partial`, not
only the delivery's HTTP status.

## 7. Connect and use your LLM

Follow [the client guide](clients.md), copy [the LLM instructions](llm-instructions.md),
and run [the acceptance scenario](validation.md#fresh-instance-acceptance).
Once this succeeds, daily editing and recall do not require a local clone.
Keep GitHub access for independent verification and recovery.
