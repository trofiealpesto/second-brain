import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { handleSiriRequest } from "../src/siri";
import type { Env } from "../src/types";
import { ensureSchema } from "./setup";

const testEnv = env as unknown as Env;

describe("Siri sync API core", () => {
  it("returns a full Markdown snapshot with a revision", async () => {
    await ensureSchema();
    const content = "---\ntitle: Siri page\ntype: concept\ntags: [test]\ncreated: 2026-09-10\nupdated: 2026-09-10\nsources: []\nlinks: []\n---\n\n# Siri page\n\nFull page text.";
    await testEnv.RAW_BUCKET.put("wiki/siri-page.md", content);
    await testEnv.DB.prepare(
      `INSERT OR REPLACE INTO files
       (file_key, file_type, r2_key, title, source, created_at, updated_at, chunk_count, deprecated, content_revision)
       VALUES (?, 'wiki_page', ?, 'Siri page', NULL, ?, ?, 0, 0, 'revision-1')`,
    ).bind("concepts/siri-page.md", "wiki/siri-page.md", "2026-09-10", "2026-09-10").run();

    const response = await handleSiriRequest(
      new Request("http://localhost/v1/siri/sync"),
      testEnv,
      { login: "example-user" },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      mode: string;
      changes: Array<{ file_key: string; content: string; revision: string }>;
    }>();
    expect(body.mode).toBe("snapshot");
    expect(body.changes).toContainEqual(expect.objectContaining({
      file_key: "concepts/siri-page.md",
      content,
      revision: "revision-1",
    }));
  });

  it("rejects write-like operations on immutable voice captures before any GitHub call", async () => {
    const response = await handleSiriRequest(
      new Request("http://localhost/v1/siri/pages/raw%2Fvoice%2F2026-09-10%2Fnote-uuid.md", {
        method: "PATCH",
        headers: { "If-Match": "revision" },
        body: JSON.stringify({ operation: "append", content: "no" }),
      }),
      testEnv,
      { login: "example-user" },
    );
    expect(response.status).toBe(422);
  });

  it("returns tombstones from the incremental change feed", async () => {
    await ensureSchema();
    await testEnv.DB.prepare(
      `INSERT INTO siri_changes (file_key, operation, content_revision, changed_at)
       VALUES ('concepts/deleted.md', 'delete', NULL, '2026-09-11T00:00:00Z')`,
    ).run();

    const response = await handleSiriRequest(
      new Request("http://localhost/v1/siri/sync?cursor=changes:0"),
      testEnv,
      { login: "example-user" },
    );
    const body = await response.json<{
      mode: string;
      changes: Array<{ file_key: string; deleted?: boolean }>;
    }>();

    expect(body.mode).toBe("changes");
    expect(body.changes).toContainEqual(expect.objectContaining({
      file_key: "concepts/deleted.md",
      deleted: true,
    }));
  });
});
