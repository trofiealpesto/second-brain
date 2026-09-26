# Optional Obsidian editing

Clone **your private vault repository**, not the application repository, and open
that directory as an Obsidian vault. Markdown and wikilinks remain ordinary files.
Configure your chosen Git sync mechanism with credentials for your own vault.

Pull before editing; commit and push after changes. Configure automatic sync only
after checking the remote, branch, and `.gitignore`. The signed GitHub webhook
projects those commits into the Worker, so MCP clients see the same pages.

Obsidian is optional; the cloud-only LLM workflow works without it. Mobile Git
support depends on the platform and sync tool; test your chosen tool rather than
assuming that desktop configuration transfers unchanged.

Obsidian edits do not automatically update frontmatter, navigation, or the log.
Follow SCHEMA.md. Avoid simultaneous edits to the same page from Obsidian and MCP,
and resolve Git conflicts manually rather than using force-push.
