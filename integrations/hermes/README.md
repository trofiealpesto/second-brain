# Optional Hermes / Linux integration

The cloud-only setup does not require this module. These are examples for an
operator who explicitly wants an agent to edit a local clone and push it to GitHub.
They are not an installer or a migration for an existing server.

## Local clone and permissions

Use a dedicated unprivileged user and a private vault clone that this user owns.
Configure Git authentication locally with access only to that vault, and set its
Git author identity. Set `WIKI_PATH` for Hermes to that clone. Install/configure
Hermes according to its upstream instructions; this project does not bundle it.

Adapt the [LLM instructions](../../docs/llm-instructions.md) for local file editing:
read the same `SCHEMA.md`, preserve raw sources, keep index/log current, and use
the clone's canonical root-relative page paths. A push then triggers the Worker's
existing GitHub webhook. Hermes can alternatively use remote MCP directly.

## Optional autosync

Review `wiki-autosync.sh`, `wiki-autosync.service`, and `wiki-autosync.timer` before
installing them on **your** Linux machine. The examples assume a dedicated user
named `second-brain`, an environment file at `/etc/second-brain/autosync.env`, and
the script installed at `/usr/local/lib/second-brain/wiki-autosync.sh`.
The environment file contains only a path, for example:

```ini
WIKI_PATH=/var/lib/second-brain/vault
```

Choose your own locations/user and update the unit accordingly. Enable the timer
only after manually running the script as that user against the intended clone.
No command in the main setup guide enables these units.

The script acquires a local lock, commits direct edits, pulls with rebase/autostash,
and pushes the configured upstream. It never force-pushes. A conflict stops the
run and requires a human resolution. If the process was killed without cleanup,
verify no sync process is running before removing its stale lock directory.

**Every tracked edit may be pushed at the next timer tick.** Keep drafts requiring
review outside this clone. Configure `.gitignore` deliberately; do not rely on a
file's name to keep it private. A private remote is still a remote data transfer.

## Optional maintenance

- `wiki-health.sh` is a lightweight inventory/recent-change/marker report, not a
  complete semantic or graph linter. Invoke it with `WIKI_PATH` set.
- `wiki-janitor.md` is a conservative agent prompt for on-demand review.
- `weekly-review.md` guides a user-directed weekly capture/curation session.

Scheduling and notification delivery are optional, account-specific setup. These
examples contain no Discord channel, issue-repo destination, Proxmox operation,
or connection to the source author's server.
