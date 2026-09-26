# Connect an LLM client

Use your own Worker URL, ending in `/mcp`, with Streamable HTTP and GitHub OAuth.
The account you authorize must appear in `ALLOWED_GITHUB_LOGINS`. The vault-writing
PAT stays in the Worker; it is never a client credential.

The expected tools are `retrieve`, `read`, `grep`, `ingest`, `move`, `delete`, and
`reindex`. A read-only knowledge/search connector cannot maintain this wiki.
All allowed users share the same vault and server capabilities; restricting tools
in a client is not a server-side per-user authorization policy.

## Claude

Add a custom remote connector in Claude's connector settings with
`https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/mcp`, then complete GitHub OAuth.
Enable the connector for the conversation and review its write-tool permissions.
Organization owners may need to configure it first.

Remote connections originate from Anthropic's infrastructure. An internet-facing
HTTPS Worker works without a home server or VPN. Consult the current
[official custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
for plan availability and interface changes.

## ChatGPT

Use developer mode to connect a custom MCP server with read/write tools. Its
availability depends on account and workspace policy. Do not assume that a
read-only company-knowledge integration exposes `ingest`, `move`, or `delete`.

Follow the [official connection and test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt):
enable developer mode, create the MCP connection with your `/mcp` URL, authorize
with GitHub, review the discovered tools, and add the connection to a new chat.
After tool/schema changes, refresh the connection and start a fresh conversation.

You do not need to publish a plugin in a public directory to connect your own
private instance. Public plugin packaging is outside this project's initial scope.

## Codex

For Codex CLI, inspect `codex mcp add --help` and `codex mcp login --help`, then add
your own URL under a distinct name, for example:

```sh
codex mcp add my-second-brain --url https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/mcp
codex mcp login my-second-brain
```

Do not replace an existing connection belonging to another installation. Store
the [LLM instructions](llm-instructions.md) in the appropriate personal/project
instruction surface. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Other clients

Use their supported Streamable HTTP/OAuth connection flow. Config formats vary;
do not assume one JSON snippet works across all clients. A local proxy is only
needed when the client cannot connect to a remote HTTP server directly.

## First conversation

1. Copy the [LLM instructions](llm-instructions.md) into persistent instructions,
   or provide them explicitly at the beginning of the conversation.
2. Ask the client to read `SCHEMA.md` and `index.md` and describe the conventions.
3. Ask it to create a synthetic page, link it from the index, append to the log,
   and report whether **each** GitHub write succeeded.
4. Verify the commit in your private vault, then start a new conversation and
   retrieve the page. Use the full [acceptance checklist](validation.md#fresh-instance-acceptance).

The existence of `AGENTS.md` or `CLAUDE.md` in a remote vault does not automatically
load those files into a web chat. The persistent instructions explicitly tell the
client to read the remote contract.
