# Optional wiki review prompt

Read the wiki's SCHEMA.md, index.md, and recent log before checking anything.
Use WIKI_PATH when operating on a local clone; otherwise use the MCP read/retrieve tools.

Inspect missing frontmatter, broken links, duplicates, stale pages, and reachability
from the index. Apply the contract's exemptions. Parse YAML as YAML. Links from
the changelog do not establish navigational reachability, and example syntax in
schema/pointer files is not a broken-link finding. Raw sources remain immutable.

Report proposed repairs with exact pages and rationale. Make only user-authorized,
unambiguous edits; preserve unrelated content and update dates/log. Ask before
merging, deleting, moving ambiguously, or changing the schema. Never administer the
host, change cron configuration, or operate on other projects during wiki review.

If a scheduled review is configured, stay quiet when there are no actionable
findings. Report meaningful changes/errors once. Delivery destination and authority
must be configured by the operator; this prompt supplies neither.
