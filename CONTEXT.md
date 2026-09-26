# Second Brain

The reusable project consists of a Cloudflare Worker, a synthetic vault template,
English operating guides, and optional local-editing and macOS integrations.
An existing personal installation is explicitly outside this checkout's scope.

## Vocabulary

- **Second Brain**: the knowledge system used by the human and their AI clients.
- **Wiki Page**: a Markdown page in the user's private GitHub vault. Its `file_key`
  is relative to the vault root, such as `concepts/example.md`, without `wiki/`.
- **Ingested File**: text stored only in Cloudflare using `file_type: ingested`.
- **Chunk**: an indexed portion of a page with source metadata.
- **Retrieve**: hybrid semantic/keyword lookup, followed by focused `read` calls.
- **Reindex**: rebuild the indexes from R2; does not fetch newer GitHub content.
- **GitHub Sync**: signed push webhook projects changed Markdown into the indexes.

Read docs/architecture.md for the data model and consistency limitations,
docs/api.md for interfaces, and docs/provenance.md for imported revisions.
