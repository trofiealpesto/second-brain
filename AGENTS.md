# Working on this repository

- Read README.md, CONTEXT.md, and the relevant docs before editing.
- Keep changes small and explain behavioral differences. Keep documentation in English.
- This checkout is an independent, reusable distribution. Existing installations
  may be upgraded only as a separate, explicitly requested task, following
  docs/upgrading.md. Never migrate an installation automatically on clone/push.
- Use synthetic fixtures and isolated resources. Never copy a production
  wrangler.toml, .dev.vars, token, webhook, or personal wiki page here.
- CI validates only. Do not add automatic deploy, signing, release, or installation jobs.
- Runtime API/tool compatibility is documented in docs/api.md. New features go
  in BACKLOG.md until separately requested.
- Preserve the upstream credit in README.md and the component history in docs/provenance.md.
