# Component provenance

Prepared on 2026-09-27 as an independent, reusable project. Original Git histories
and operational secrets were not imported. Personal source repositories and the
existing deployment remain unchanged.

## Sources

| Component | Source | Snapshot / treatment |
| --- | --- | --- |
| Original Worker | [50R1Paps/second-brain-worker](https://github.com/50R1Paps/second-brain-worker) | Upstream architecture/code attribution; a specific upstream revision was not recorded in the adapted history |
| Adapted Worker | `trofiealpesto/second-brain-worker` | `87ea800bda789987789ae54907b5fe661e542804`, plus the local changes listed below |
| Siri companion | `trofiealpesto/second-brain-siri` | `7cbea187f5bb772a4c07e3ee264277a442aa26b8` |
| Autosync/maintenance examples | `trofiealpesto/infra-docs` | `2b85e60bf1384139fd49aca7e7976bc0bc1ae554`; only wiki-related behavior adapted |
| Wiki contract and agent practices | Personal vault contract and installed Hermes wiki skills | Reviewed selectively; fresh generic examples replace personal pages/session records |

The adapted Worker's initial commit `1062dee3c57dfd1b7a23f0590f947ae74761a4cb`
explicitly records derivation from the upstream Worker. The standalone repository
layout here does not imply that all its code was authored from scratch.

## Included local Worker changes

The source checkout had uncommitted changes when copied. They were preserved in
this independent copy, and the original checkout was not committed or reset:

- Keep a meaningful body-text budget when frontmatter is unusually large.
- Delete Vectorize IDs in batches of 100 for re-ingestion/deletion.
- Associated oversized-frontmatter and vector-batching regression tests.

A private preparation record retains the source fingerprints and original patch.
It is deliberately outside this distribution because it includes local paths and
operational inventory. No personal content is used as a test fixture.

## Adaptations in this distribution

See [API differences](api.md#intentional-differences-from-the-imported-personal-version)
for runtime changes. New English guides, synthetic templates, isolated integration
examples, compatibility tests, and the feature backlog were prepared for this copy.
Legacy deployment notes and stale Gitea/local-MCP instructions were not imported.

## Credits

The original Worker was created by [50R1Paps](https://github.com/50R1Paps).
Keep this attribution and the prominent README credit when sharing the project.
The source snapshots and adaptations above document how this version was assembled.
