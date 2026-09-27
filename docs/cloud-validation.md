# Cloud migration rehearsal

On 2026-09-27 the public source was deployed to a separate Cloudflare Worker with
its own D1, R2, Vectorize, OAuth KV, secrets, and a private synthetic GitHub vault.
No personal vault content was used in that environment.

The rehearsal verified real Git push/webhook delivery, MCP over Streamable HTTP,
contract reads, canonical GitHub creates/updates, index/log updates, renames and
deletes, and live Workers AI/Vectorize retrieval returning hybrid results.
With the isolated GitHub token deliberately invalidated, MCP reports partial
writes as errors and a failed move preserves its source.

Siri API tests verified capture/sync, stale-revision rejection, confirmed editing,
archive, read-only scope enforcement, and rejection of an unlisted login. OAuth
fixtures were generated with the provider SDK into **only the isolated KV**;
these tests do not claim an interactive GitHub login or a spoken Siri interaction.

The rehearsal exposed an inherited Vectorize limit failure: voice-capture file
paths could produce vector IDs longer than 64 bytes. Long IDs now use SHA-256;
short existing IDs, page paths, and metadata remain compatible. The cloud Siri
tests pass with the fix. The local Worker suite passes 139 tests.

This supplements the historical [preparation record](verification.md). For a real
installation use [the explicit upgrade procedure](upgrading.md), preserve private
configuration, and separately verify the owner's actual authenticated clients.
