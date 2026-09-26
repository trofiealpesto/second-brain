# Validation and release checks

## Automated, isolated checks

```sh
npm ci
npm run typecheck
npm test
npm run check:distribution
npm run test:autosync
npm run setup:dry -- --wiki-dir templates/vault
```

Worker tests use emulated D1/R2 and synthetic credentials; outbound HTTP is
disabled unless a test supplies an explicit mock. They do not run against a live
vault or production Worker. The autosync check creates disposable local Git
repositories, performs a real commit/push, checks the result, and cleans up only
those temporary directories. The signed-webhook tests exercise the projection
half separately with a mocked GitHub content service.

Run the [Siri tests and unsigned build](../apps/siri/README.md) with Xcode 27.
The [CI templates](../ci/README.md) are inactive until installed. The optional Siri
workflow is manual and uses only a hosted runner; it fails clearly if that image
has no Xcode 27. There is no fallback to a personal runner.

## Fresh-instance acceptance

Use a **new private test vault, distinct cloud resources, and new test secrets**.
Never point this scenario at an existing personal installation.

1. Follow setup.md from an empty account/resource set; bootstrap all template pages.
2. Connect a real MCP client through GitHub OAuth with an allowed test login.
   Confirm the seven tools. Confirm an unlisted login cannot use them.
3. Ask the client to read SCHEMA.md/index.md and explain the conventions.
4. Create a synthetic concept, link it from index.md, and append to log.md.
   Verify every write result and the canonical GitHub commits.
5. In a new session or another client, retrieve and read the saved page.
6. Update it, rename it, repair its links, then delete the synthetic test page.
   Confirm both canonical state and the projected index after each operation.
7. Edit a Markdown page through Git, commit/push, inspect the signed webhook
   delivery, and read the changed page from MCP. Repeat for SCHEMA.md.
8. On the isolated instance only, simulate a GitHub permission failure. Check that
   no client announces a partial write as saved and a failed move keeps its source.
9. For Siri, perform login, local-copy consent, search, capture, confirmed update,
   archive, and disconnect; confirm only that replica's local state is cleared.

An SDK/protocol test or unsigned build is not evidence of completing an interactive
OAuth flow in Claude/ChatGPT/Siri. Record live acceptance separately.

## Distribution review

- Preserve the original author's credit in README.md and the component provenance.
- Inspect tracked files/history for secrets and personal data, not just `.gitignore`.
- Confirm no deploy/release/signing workflow, installed service, or external webhook
  connects this checkout to an existing installation.
- Confirm example owner/repo/resource values belong to nobody until configured.
- Compare source/configuration fingerprints captured before and after preparation.
  Treat normal background vault edits separately from deployment/config changes.

## Preparation results

See [the verification record](verification.md) for the checks actually completed,
their limitations, and the untouched-installation comparison. Do not infer a live
cloud acceptance result from the presence of this checklist.
