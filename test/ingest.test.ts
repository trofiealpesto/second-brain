import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { ensureSchema } from "./setup";
import { apiFetch } from "./api";

const SAMPLE_MARKDOWN = `---
title: Test Page
tags: [test]
---
## Introduction
This is a test page about [[Tool Attention]] and related concepts.

## Details
The system uses markdown chunking with overlap to preserve context.
It should not split [[Wikilinks]] across chunk boundaries.`;

describe("POST /api/ingest — validation", () => {
  it("rejects missing file_key", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test", file_type: "wiki_page" }),
    });
    expect(response.status).toBe(400);
    const data = await response.json<{ error: { code: string } }>();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing content", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "wiki/test.md",
        file_type: "wiki_page",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json<{ error: { code: string } }>();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid file_type", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "wiki/test.md",
        content: "test",
        file_type: "invalid",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json<{ error: { code: string } }>();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty body", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
  });
});

describe("POST /api/ingest — successful ingestion", () => {
  it("ingests a markdown file and returns chunk count", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "concepts/Test.md",
        content: SAMPLE_MARKDOWN,
        file_type: "wiki_page",
        title: "Test Page",
        source: "concepts/Test.md",
        push_to_github: false,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{
      file_key: string;
      chunk_count: number;
      status: string;
    }>();
    expect(data.file_key).toBe("concepts/Test.md");
    expect(data.chunk_count).toBeGreaterThan(0);
    expect(data.status).toBe("ok");
  });

  it("stores raw content in R2", async () => {
    await ensureSchema();
    await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "r2-test.md",
        content: "## Hello\nWorld",
        file_type: "wiki_page",
        push_to_github: false,
      }),
    });

    const { env } = await import("cloudflare:test");
    const r2 = (env as unknown as { RAW_BUCKET: R2Bucket }).RAW_BUCKET;
    const obj = await r2.get("r2-test.md");
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(text).toBe("## Hello\nWorld");
  });

  it("persists file metadata in D1", async () => {
    await ensureSchema();
    await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "d1-test.md",
        content: "## Section\nContent here",
        file_type: "wiki_page",
        title: "D1 Test",
        source: "d1-test.md",
        push_to_github: false,
      }),
    });

    const { env } = await import("cloudflare:test");
    const db = (env as unknown as { DB: D1Database }).DB;
    const file = await db
      .prepare("SELECT * FROM files WHERE file_key = ?")
      .bind("d1-test.md")
      .first<{ file_key: string; file_type: string; title: string }>();
    expect(file).not.toBeNull();
    expect(file!.file_type).toBe("wiki_page");
    expect(file!.title).toBe("D1 Test");
  });

  it("persists chunks in D1", async () => {
    await ensureSchema();
    await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "chunks-test.md",
        content: SAMPLE_MARKDOWN,
        file_type: "wiki_page",
        push_to_github: false,
      }),
    });

    const { env } = await import("cloudflare:test");
    const db = (env as unknown as { DB: D1Database }).DB;
    const chunks = await db
      .prepare("SELECT * FROM chunks WHERE file_key = ? ORDER BY chunk_index")
      .bind("chunks-test.md")
      .all<{ chunk_index: number; content: string; section: string }>();
    expect(chunks.results.length).toBeGreaterThan(0);
    expect(chunks.results[0].content).toContain("Introduction");
  });
});

describe("POST /api/ingest — re-ingestion idempotency", () => {
  it("re-ingesting same file_key overwrites without duplicates", async () => {
    await ensureSchema();
    const body = {
      file_key: "reingest-test.md",
      content: "## Original\nFirst content",
      file_type: "wiki_page",
      push_to_github: false,
    };

    // First ingest
    await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const { env } = await import("cloudflare:test");
    const db = (env as unknown as { DB: D1Database }).DB;
    const first = await db
      .prepare("SELECT COUNT(*) as count FROM chunks WHERE file_key = ?")
      .bind("reingest-test.md")
      .first<{ count: number }>();

    // Re-ingest with different content
    await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        content: "## Updated\nDifferent content with more text",
      }),
    });

    const second = await db
      .prepare("SELECT COUNT(*) as count FROM chunks WHERE file_key = ?")
      .bind("reingest-test.md")
      .first<{ count: number }>();

    // Should have chunks from the second ingest only, no duplicates
    const file = await db
      .prepare("SELECT chunk_count FROM files WHERE file_key = ?")
      .bind("reingest-test.md")
      .first<{ chunk_count: number }>();

    expect(second!.count).toBe(file!.chunk_count);
    expect(second!.count).not.toBe(first!.count + second!.count);
  });
});

describe("POST /api/ingest — error handling", () => {
  it("returns 404 for wrong method on /api/ingest", async () => {
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "GET",
    });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/ingest — push_to_github", () => {
  it("accepts push_to_github and returns github_pushed field", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "github-push-test.md",
        content: "## Test\nContent for GitHub push",
        file_type: "wiki_page",
        push_to_github: true,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{
      file_key: string;
      chunk_count: number;
      status: string;
      github_pushed?: boolean;
      github_error?: string;
    }>();
    expect(data.file_key).toBe("github-push-test.md");
    expect(data.chunk_count).toBeGreaterThan(0);
    expect(data.github_pushed).toBeDefined();
    // With test GITHUB_TOKEN, the push will fail
    expect(data.github_pushed).toBe(false);
    expect(data.github_error).toBeDefined();
  });

  it("defaults to pushing wiki_page to GitHub when push_to_github not specified", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "default-push-test.md",
        content: "## Test\nDefault push",
        file_type: "wiki_page",
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{
      github_pushed?: boolean;
    }>();
    expect(data.github_pushed).toBeDefined();
  });

  it("does not push to GitHub when push_to_github is explicitly false", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "no-push-explicit.md",
        content: "## Test\nExplicit no push",
        file_type: "wiki_page",
        push_to_github: false,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{
      github_pushed?: boolean;
    }>();
    expect(data.github_pushed).toBeUndefined();
  });

  it("does not push to GitHub for ingested file type even with push_to_github", async () => {
    await ensureSchema();
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "external-file:abc123",
        content: "## External\nExternal content",
        file_type: "ingested",
        push_to_github: true,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{
      github_pushed?: boolean;
    }>();
    expect(data.github_pushed).toBeUndefined();
  });
});

describe("ensureFrontmatter", () => {
  it("adds frontmatter when missing entirely", async () => {
    const { ensureFrontmatter } = await import("../src/ingest");
    const result = ensureFrontmatter("## Hello\nWorld", "wiki/test.md");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('title: "test"');
    expect(result).toContain("type: wiki");
    expect(result).toContain("created:");
    expect(result).toContain("updated:");
    expect(result).toContain("## Hello\nWorld");
  });

  it("patches missing fields in existing frontmatter", async () => {
    const { ensureFrontmatter } = await import("../src/ingest");
    const content = "---\ntitle: Existing\n---\n## Body\nText";
    const result = ensureFrontmatter(content, "wiki/existing.md");
    expect(result).toContain("title: Existing");
    expect(result).toContain("type: wiki");
    expect(result).toContain("created:");
    expect(result).toContain("updated:");
    expect(result).toContain("## Body\nText");
  });

  it("returns content unchanged when all fields present", async () => {
    const { ensureFrontmatter } = await import("../src/ingest");
    const content =
      "---\ntitle: Complete\ntype: concept\ncreated: 2026-01-01\nupdated: 2026-01-02\n---\n## Body";
    const result = ensureFrontmatter(content, "wiki/complete.md");
    expect(result).toBe(content);
  });

  it("derives title from filename when missing", async () => {
    const { ensureFrontmatter } = await import("../src/ingest");
    const result = ensureFrontmatter("## Body", "wiki/concepts/My Page.md");
    expect(result).toContain('title: "My Page"');
  });
});

describe("validateIngestRequest — wiki/ prefix normalization", () => {
  it("strips leading wiki/ from file_key", async () => {
    const { validateIngestRequest } = await import("../src/ingest");
    const result = validateIngestRequest({
      file_key: "wiki/entities/hermes-agent.md",
      content: "# Test",
      file_type: "wiki_page",
    });
    expect(result).not.toBeNull();
    expect(result!.file_key).toBe("entities/hermes-agent.md");
  });

  it("leaves non-wiki/ file_key unchanged", async () => {
    const { validateIngestRequest } = await import("../src/ingest");
    const result = validateIngestRequest({
      file_key: "entities/hermes-agent.md",
      content: "# Test",
      file_type: "wiki_page",
    });
    expect(result).not.toBeNull();
    expect(result!.file_key).toBe("entities/hermes-agent.md");
  });

  it("strips only a single leading wiki/ segment", async () => {
    const { validateIngestRequest } = await import("../src/ingest");
    const result = validateIngestRequest({
      file_key: "wiki/wiki/deep.md",
      content: "# Test",
      file_type: "wiki_page",
    });
    expect(result).not.toBeNull();
    expect(result!.file_key).toBe("wiki/deep.md");
  });
});

describe("UTF-8 base64 encoding — Buffer fix", () => {
  it("Buffer encodes and decodes UTF-8 content correctly", () => {
    const utf8Content = "em-dash — arrow → euro € times × check ✅";
    const encoded = Buffer.from(utf8Content, "utf-8").toString("base64");
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    expect(decoded).toBe(utf8Content);
  });

  it("btoa throws on the same UTF-8 content (confirms the bug that was fixed)", () => {
    const utf8Content = "em-dash — arrow → euro € times × check ✅";
    expect(() => btoa(utf8Content)).toThrow();
  });
});

describe("POST /api/ingest — UTF-8 content in GitHub push", () => {
  it("ingests page with UTF-8 content without btoa encoding error", async () => {
    await ensureSchema();
    const utf8Content =
      "## UTF-8 Page\n\nContains em-dash — and arrow → and euro € and check ✅";
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "test/utf8-roundtrip.md",
        content: utf8Content,
        file_type: "wiki_page",
        push_to_github: true,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{
      status: string;
      github_pushed: boolean;
      github_error?: string;
    }>();
    expect(data.status).toBe("partial");
    // Push fails because test GITHUB_TOKEN is fake, but NOT due to btoa() encoding error
    expect(data.github_pushed).toBe(false);
    expect(data.github_error).toBeDefined();
    expect(data.github_error).not.toContain("btoa()");
    expect(data.github_error).not.toContain("Latin1");
  });
});
