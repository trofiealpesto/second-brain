import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { ensureSchema } from "./setup";
import {
  appendLogCore,
  bumpUpdated,
  editPageCore,
  insertLogEntry,
  replaceOnce,
} from "../src/wiki-edit";
import type { Env } from "../src/types";

const LOG = `---
title: Change Log
type: concept
updated: 2026-10-01
---

# Change Log

Append-only. Newest entries at the top.

## [2026-10-28] update | older
- something

- 2026-10-20 — [Agent] even older
`;

const PAGE = `---
title: Foo
type: entity
updated: 2026-09-01
---
# Foo

Status: draft

## Notes
- one
`;

/** A fake GitHub Contents API that keeps one file per path and enforces SHAs. */
function fakeGitHub(files: Record<string, string>, opts: { interleave?: (path: string) => void } = {}) {
  const state = new Map(Object.entries(files).map(([k, v]) => [k, { content: v, sha: "sha-0" }]));
  let version = 0;
  const writes: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ""));
    if (!init?.method || init.method === "GET") {
      const file = state.get(path);
      if (!file) return new Response("not found", { status: 404 });
      // A concurrent writer may land after this read: the caller still gets the old copy and SHA.
      opts.interleave?.(path);
      return Response.json({
        encoding: "base64",
        content: Buffer.from(file.content, "utf-8").toString("base64"),
        sha: file.sha,
      });
    }
    const body = JSON.parse(String(init.body)) as { content: string; sha: string };
    const current = state.get(path);
    if (!current || current.sha !== body.sha) return new Response("sha mismatch", { status: 409 });
    version += 1;
    const content = Buffer.from(body.content, "base64").toString("utf-8");
    state.set(path, { content, sha: `sha-${version}` });
    writes.push(path);
    return Response.json({ content: { sha: `sha-${version}` } });
  }) as typeof fetch;
  return { fetchFn, state, writes, bump: (path: string, content: string) => {
    version += 1;
    state.set(path, { content, sha: `sha-${version}` });
  } };
}

function testEnv(): Env {
  return { ...(env as unknown as Env), GITHUB_TOKEN: "test-token", AI: undefined, VECTORIZE: undefined } as Env;
}

describe("insertLogEntry", () => {
  it("puts the entry above the newest entry, after the intro", () => {
    const out = insertLogEntry(LOG, "- 2026-10-29 — [Agent] new");
    const lines = out.split("\n");
    const newAt = lines.indexOf("- 2026-10-29 — [Agent] new");
    expect(newAt).toBeGreaterThan(lines.indexOf("Append-only. Newest entries at the top."));
    expect(newAt).toBeLessThan(lines.indexOf("## [2026-10-28] update | older"));
    expect(out).toContain("- 2026-10-29 — [Agent] new\n\n## [2026-10-28]");
  });

  it("appends at the end when the log has no entries yet", () => {
    const out = insertLogEntry("---\ntitle: Log\n---\n# Log\n\nIntro.\n", "- 2026-10-29 — first");
    expect(out.endsWith("Intro.\n\n- 2026-10-29 — first\n\n")).toBe(true);
  });
});

describe("bumpUpdated", () => {
  it("rewrites the frontmatter date only", () => {
    const out = bumpUpdated(PAGE, "2026-10-29");
    expect(out).toContain("updated: 2026-10-29");
    expect(out).not.toContain("2026-09-01");
    expect(out.slice(out.indexOf("# Foo"))).toBe(PAGE.slice(PAGE.indexOf("# Foo")));
  });

  it("leaves pages without updated untouched", () => {
    expect(bumpUpdated("# no frontmatter", "2026-10-29")).toBe("# no frontmatter");
  });
});

describe("replaceOnce", () => {
  it("replaces a unique match", () => {
    const out = replaceOnce(PAGE, "Status: draft", "Status: done");
    expect(out.ok && out.content).toContain("Status: done");
  });

  it("refuses a missing or repeated match", () => {
    expect(replaceOnce(PAGE, "Status: final", "x")).toMatchObject({ ok: false, code: "NO_MATCH" });
    expect(replaceOnce("a b a", "a", "c")).toMatchObject({ ok: false, code: "AMBIGUOUS" });
    expect(replaceOnce(PAGE, "", "x")).toMatchObject({ ok: false, code: "INVALID" });
  });
});

describe("editPageCore", () => {
  it("edits the latest GitHub copy, bumps updated and indexes the result", async () => {
    await ensureSchema();
    const gh = fakeGitHub({ "entities/foo.md": PAGE });
    const result = await editPageCore(
      testEnv(),
      { file_key: "entities/foo.md", old_text: "- one\n", new_text: "- one\n- two\n" },
      gh.fetchFn,
    );
    expect(result).toMatchObject({ ok: true, file_key: "entities/foo.md", index_pending: false });
    const saved = gh.state.get("entities/foo.md")!.content;
    expect(saved).toContain("- one\n- two\n");
    expect(saved).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m);
    const stored = await (env as unknown as Env).RAW_BUCKET.get("entities/foo.md");
    expect(await stored?.text()).toBe(saved);
  });

  it("re-applies the edit when someone else wrote in between", async () => {
    await ensureSchema();
    let interleaved = false;
    const gh = fakeGitHub({ "entities/foo.md": PAGE }, {
      interleave: (path) => {
        if (interleaved) return;
        interleaved = true;
        // Another writer lands between our read and our write.
        gh.bump(path, PAGE.replace("# Foo", "# Foo\n\nAdded by someone else."));
      },
    });
    const result = await editPageCore(
      testEnv(),
      { file_key: "entities/foo.md", old_text: "Status: draft", new_text: "Status: done" },
      gh.fetchFn,
    );
    expect(result.ok).toBe(true);
    const saved = gh.state.get("entities/foo.md")!.content;
    expect(saved).toContain("Added by someone else.");
    expect(saved).toContain("Status: done");
  });

  it("refuses log.md, wiki/ prefixes and missing pages", async () => {
    const gh = fakeGitHub({});
    expect(await editPageCore(testEnv(), { file_key: "log.md", old_text: "a", new_text: "b" }, gh.fetchFn))
      .toMatchObject({ ok: false, code: "INVALID" });
    expect(await editPageCore(testEnv(), { file_key: "wiki/foo.md", old_text: "a", new_text: "b" }, gh.fetchFn))
      .toMatchObject({ ok: false, code: "INVALID" });
    expect(await editPageCore(testEnv(), { file_key: "entities/none.md", old_text: "a", new_text: "b" }, gh.fetchFn))
      .toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(gh.writes).toEqual([]);
  });
});

describe("appendLogCore", () => {
  it("adds the entry at the top of log.md without touching older entries", async () => {
    await ensureSchema();
    const gh = fakeGitHub({ "log.md": LOG });
    const result = await appendLogCore(testEnv(), "- 2026-10-29 — [Agent] new page ([[entities/foo]])", gh.fetchFn);
    expect(result).toMatchObject({ ok: true, file_key: "log.md" });
    const saved = gh.state.get("log.md")!.content;
    expect(saved).toContain("- 2026-10-29 — [Agent] new page ([[entities/foo]])\n\n## [2026-10-28] update | older");
    expect(saved).toContain("- 2026-10-20 — [Agent] even older");
  });

  it("rejects empty, oversized and frontmatter-breaking entries", async () => {
    const gh = fakeGitHub({ "log.md": LOG });
    expect(await appendLogCore(testEnv(), "  ", gh.fetchFn)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await appendLogCore(testEnv(), "x".repeat(4001), gh.fetchFn)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await appendLogCore(testEnv(), "a\n---\nb", gh.fetchFn)).toMatchObject({ ok: false, code: "INVALID" });
    expect(gh.writes).toEqual([]);
  });
});
