# Preparation verification record

For the later live-cloud rehearsal, see [cloud validation](cloud-validation.md).

Prepared on 2026-09-27. This records evidence from the independent copy, not a
deployment or upgrade of the source author's installation.

## Checks completed

| Check | Result / scope |
| --- | --- |
| TypeScript | `npm run typecheck` passes |
| Worker suite | 136 tests across 15 files; emulated D1/R2, synthetic values, outbound HTTP blocked except explicit mocks |
| MCP client protocol | SDK client discovers seven tools, reads/updates SCHEMA.md, and receives `isError` on partial GitHub failure |
| GitHub configuration | Mocked writes/deletes and Siri Git commits target a different owner/repository and a non-main branch |
| Signed push webhook | Synthetic contract/page/index/log import, updates, rename/delete, and no GitHub write-back loop |
| Autosync | Disposable local Git repositories: edit → commit → push, clean checkout, unchanged second run |
| Template bootstrap | Dry-run discovers eight content/contract pages and excludes root agent pointers |
| Fresh D1 | All five migrations apply successfully to a new local database |
| Worker bundle | `wrangler deploy --dry-run --config wrangler.test.toml` succeeds; no upload/deployment |
| Siri unit tests | Six tests pass with Xcode 27 / Swift 6.4 |
| Siri app | Unsigned Debug build succeeds; built plist contains the explicitly supplied synthetic server origin and the distinct replica bundle ID |

GitHub Actions was not run: the preparation HTTPS credential lacks the `workflow`
scope, and no usable SSH/connector access was available for the new repository.
The validation jobs are supplied as inactive [CI templates](../ci/README.md) so
the source can be pushed without changing account authorizations. Local results
above remain reproducible with the documented commands.

The new-copy compatibility date was advanced to 2024-09-23 after the bundle check
exposed an inherited Node.js `path` dependency requirement. The source
configuration was not changed. The distribution check covers documentation links,
known credential patterns, operational references, and CI isolation; it is a
focused guard, not an exhaustive secret-detection guarantee.

## Existing-installation comparison

Before/after SHA-256 comparisons found no changes in the captured source and
configuration set:

- Worker: 66 files, including the pre-existing local modifications and config.
- Infrastructure/documentation checkout: 75 files/symlinks.
- Local private vault checkout: 86 files.
- Two local MCP/client configuration files.
- Server: 33 wiki skill/script/service/configuration files; autosync timer remains active.
- Git HEADs/remotes in the captured local repositories are unchanged.
- The read-only Cloudflare deployment listing is identical before and after.

No background vault differences appeared in this captured set during the checks.
This is evidence for the inspected files and deployment state, not a claim that
every filesystem byte or every cloud setting was independently audited. Detailed
hashes, paths, logs, and the imported local patch remain in a private preparation
record outside this repository.

The Siri app was built without installing, launching, or connecting it. No
production secret, client configuration, webhook, service, or deployment was
updated as part of preparing this copy.

## Acceptance still required

No fresh live Cloudflare deployment/private test vault or interactive LLM/Siri
OAuth session was created for this verification. The Git push and webhook halves
were tested separately in isolation; a real internet push delivery was not tested
end-to-end against a new cloud instance. Semantic retrieval used the inherited
mocks/fallbacks, not a live Workers AI/Vectorize quality evaluation.

Before calling a new installation fully accepted, complete the
[fresh-instance checklist](validation.md#fresh-instance-acceptance) with dedicated
resources and credentials.
