import { chunkMarkdown, type Chunk } from "./chunker";
import { jsonResponse } from "./http";
import type {
  Env,
  IngestRequest,
  IngestResult,
  DeleteFileResult,
  MoveFileResult,
} from "./types";
import { recordSiriChange, sha256Hex } from "./siri-sync";
import { wikiApiBase, wikiRepository } from "./config";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Vectorize rejects a deleteByIds payload with more than 100 ids
 * (error 40007). Pages with many chunks exceed this, which made them
 * impossible to re-ingest, reindex or delete.
 */
const VECTORIZE_DELETE_BATCH_SIZE = 100;

type FetchFunction = typeof fetch;

/** Delete vector ids in batches that stay within Vectorize's payload limit. */
export async function deleteVectorsInBatches(
  vectorize: NonNullable<Env["VECTORIZE"]>,
  vectorIds: string[],
): Promise<void> {
  for (let i = 0; i < vectorIds.length; i += VECTORIZE_DELETE_BATCH_SIZE) {
    await vectorize.deleteByIds(
      vectorIds.slice(i, i + VECTORIZE_DELETE_BATCH_SIZE),
    );
  }
}

/**
 * Extract the `updated:` date from YAML frontmatter.
 * Returns an ISO date string (YYYY-MM-DD or full ISO-8601) if present and valid,
 * otherwise null. Used to store the page's own edit timestamp rather than the
 * ingest timestamp, so recency-based ranking reflects actual edits (rahilp improvement #1).
 */
export function extractFrontmatterDate(content: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const dateMatch = fmMatch[1].match(/^updated:\s*(.+)$/m);
  if (!dateMatch) return null;
  const raw = dateMatch[1].replace(/['"]/g, "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw : null;
}

/**
 * Returns 1 if the page's frontmatter marks it as deprecated, 0 otherwise.
 * Matches `status: deprecated` or `deprecated: true` (case-insensitive).
 * Used to apply a score penalty in retrieve so deprecated pages sink without
 * being removed (rahilp improvement #4).
 */
export function extractDeprecatedFlag(content: string): number {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return 0;
  const fm = fmMatch[1];
  if (/^status:\s*deprecated\s*$/im.test(fm)) return 1;
  if (/^deprecated:\s*true\s*$/im.test(fm)) return 1;
  return 0;
}

export function ensureFrontmatter(content: string, fileKey: string): string {
  const fmMatch = content.match(/^---\n(.*?)\n---/s);
  const now = new Date().toISOString().slice(0, 10);
  const defaultTitle =
    fileKey.split("/").pop()?.replace(/\.md$/i, "") ?? "Untitled";

  if (!fmMatch) {
    return `---\ntitle: "${defaultTitle}"\ntype: wiki\ncreated: ${now}\nupdated: ${now}\n---\n${content}`;
  }

  const fm = fmMatch[1];
  const patches: Record<string, string> = {};
  if (!/^\s*title:/m.test(fm)) patches["title"] = `"${defaultTitle}"`;
  if (!/^\s*type:/m.test(fm)) patches["type"] = "wiki";
  if (!/^\s*created:/m.test(fm)) patches["created"] = now;
  if (!/^\s*updated:/m.test(fm)) patches["updated"] = now;

  if (Object.keys(patches).length === 0) return content;

  const lines = fm.split("\n");
  for (const [key, value] of Object.entries(patches)) {
    lines.push(`${key}: ${value}`);
  }
  const newFm = lines.join("\n");
  return content.replace(/^---\n.*?\n---/s, `---\n${newFm}\n---`);
}

async function pushToGitHub(
  env: Env,
  fileKey: string,
  content: string,
  fetchFn: FetchFunction = fetch,
): Promise<{ pushed: boolean; error?: string }> {
  if (!env.GITHUB_TOKEN) {
    return { pushed: false, error: "GITHUB_TOKEN not configured" };
  }

  const safeContent = ensureFrontmatter(content, fileKey);

  const encodedPath = fileKey.split("/").map(encodeURIComponent).join("/");
  const apiUrl = `${wikiApiBase(env)}/contents/${encodedPath}`;
  const branch = wikiRepository(env).branch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "second-brain-worker",
  };

  let sha: string | undefined;
  try {
    const existing = await fetchFn(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    if (existing.ok) {
      const data = (await existing.json()) as { sha?: string };
      sha = data.sha;
    }
  } catch {
    // File doesn't exist yet, proceed without SHA
  }

  const body = {
    message: `chore: ingest ${fileKey} via Second Brain Worker [skip ci]`,
    content: Buffer.from(safeContent, "utf-8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };

  const response = await fetchFn(apiUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errMessage = `GitHub API ${response.status}`;
    try {
      const errText = await response.text();
      errMessage += `: ${errText.slice(0, 200)}`;
    } catch {
      // ignore
    }
    return { pushed: false, error: errMessage };
  }

  return { pushed: true };
}

async function deleteFromGitHub(
  env: Env,
  fileKey: string,
  fetchFn: FetchFunction = fetch,
): Promise<{ deleted: boolean; error?: string }> {
  if (!env.GITHUB_TOKEN) {
    return { deleted: false, error: "GITHUB_TOKEN not configured" };
  }

  const encodedPath = fileKey.split("/").map(encodeURIComponent).join("/");
  const apiUrl = `${wikiApiBase(env)}/contents/${encodedPath}`;
  const branch = wikiRepository(env).branch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "second-brain-worker",
  };

  let sha: string | undefined;
  try {
    const existing = await fetchFn(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    if (existing.ok) {
      const data = (await existing.json()) as { sha?: string };
      sha = data.sha;
    } else if (existing.status === 404) {
      // Already gone from GitHub — nothing to delete.
      return { deleted: true };
    }
  } catch (err) {
    return {
      deleted: false,
      error: err instanceof Error ? err.message : "Unknown error fetching SHA",
    };
  }

  if (!sha) {
    return { deleted: false, error: "Could not resolve file SHA on GitHub" };
  }

  const response = await fetchFn(apiUrl, {
    method: "DELETE",
    headers,
    body: JSON.stringify({
      message: `chore: remove ${fileKey} via Second Brain Worker [skip ci]`,
      sha,
      branch,
    }),
  });

  if (!response.ok) {
    let errMessage = `GitHub API ${response.status}`;
    try {
      const errText = await response.text();
      errMessage += `: ${errText.slice(0, 200)}`;
    } catch {
      // ignore
    }
    return { deleted: false, error: errMessage };
  }

  return { deleted: true };
}

export function validateIngestRequest(body: unknown): IngestRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.file_key !== "string" || b.file_key.length === 0) return null;
  if (typeof b.content !== "string" || b.content.length === 0) return null;
  if (b.file_type !== "wiki_page" && b.file_type !== "ingested") return null;
  return {
    file_key: b.file_key.replace(/^wiki\//, ""),
    content: b.content,
    file_type: b.file_type,
    title: typeof b.title === "string" ? b.title : undefined,
    source: typeof b.source === "string" ? b.source : undefined,
    push_to_github:
      typeof b.push_to_github === "boolean" ? b.push_to_github : undefined,
  };
}

export async function doIngest(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      400,
    );
  }

  const parsed = validateIngestRequest(body);
  if (!parsed) {
    return jsonResponse(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Missing or invalid fields: file_key (string), content (string), file_type ('wiki_page' | 'ingested')",
        },
      },
      400,
    );
  }

  const result = await ingestCore(env, parsed);
  if (result instanceof Response) return result;

  return jsonResponse(result);
}

export async function ingestCore(
  env: Env,
  parsed: IngestRequest,
): Promise<IngestResult | Response> {
  const { file_key, content, file_type, title, source } = parsed;
  const r2Key = file_type === "wiki_page" ? file_key : `files/${file_key}`;

  try {
    // 1. R2 PUT raw content
    await env.RAW_BUCKET.put(r2Key, content);

    // 2. Chunk the content
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) {
      return jsonResponse(
        {
          error: {
            code: "EMPTY_CONTENT",
            message: "No chunks produced from content",
          },
        },
        400,
      );
    }

    // 3. Re-ingestion: delete old chunks for this file_key
    const existingChunks = await env.DB.prepare(
      "SELECT vector_id FROM chunks WHERE file_key = ? AND vector_id IS NOT NULL",
    )
      .bind(file_key)
      .all<{ vector_id: string }>();
    const existingVectorIds = existingChunks.results.map(
      (chunk) => chunk.vector_id,
    );
    if (env.VECTORIZE && existingVectorIds.length > 0) {
      await deleteVectorsInBatches(env.VECTORIZE, existingVectorIds);
    }
    await env.DB.prepare("DELETE FROM chunks WHERE file_key = ?")
      .bind(file_key)
      .run();

    // 4. Generate embeddings via Workers AI (if available)
    const embeddings = env.AI ? await generateEmbeddings(env.AI, chunks) : null;

    // 5. Upsert vectors into Vectorize (if available)
    let vectorIds: string[] = [];
    if (embeddings && env.VECTORIZE) {
      const vectors = chunks.map((chunk, i) => ({
        id: `${file_key}:${chunk.chunk_index}`,
        values: embeddings[i],
        metadata: {
          file_key,
          chunk_index: chunk.chunk_index,
          section: chunk.section,
        },
      }));
      await env.VECTORIZE.upsert(vectors);
      vectorIds = vectors.map((v) => v.id);
    }

    // 6. D1: insert file metadata + chunks in a single batch
    const now = new Date().toISOString();
    const contentRevision = await sha256Hex(content);
    // Prefer the page's own `updated:` frontmatter date so recency ranking reflects
    // real edits rather than ingestion time (rahilp improvement #1).
    const updatedAt = extractFrontmatterDate(content) ?? now;
    // 0 = active, 1 = deprecated (rahilp improvement #4).
    const deprecated = extractDeprecatedFlag(content);
    const dbStatements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO files (file_key, file_type, r2_key, title, source, created_at, updated_at, chunk_count, deprecated, content_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_key) DO UPDATE SET
           file_type = excluded.file_type,
           r2_key = excluded.r2_key,
           title = excluded.title,
           source = excluded.source,
           updated_at = excluded.updated_at,
           chunk_count = excluded.chunk_count,
           deprecated = excluded.deprecated,
           content_revision = excluded.content_revision`,
      ).bind(
        file_key,
        file_type,
        r2Key,
        title ?? null,
        source ?? null,
        now,        // created_at: always ingest time (first-seen timestamp)
        updatedAt,  // updated_at: from frontmatter if present, else ingest time
        chunks.length,
        deprecated,
        contentRevision,
      ),
    ];

    for (const chunk of chunks) {
      const vectorId = vectorIds[chunk.chunk_index] ?? null;
      dbStatements.push(
        env.DB.prepare(
          `INSERT INTO chunks (file_key, chunk_index, content, section, wikilinks, vector_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          file_key,
          chunk.chunk_index,
          chunk.content,
          chunk.section,
          JSON.stringify(chunk.wikilinks),
          vectorId,
        ),
      );
    }

    await env.DB.batch(dbStatements);
    try {
      await recordSiriChange(env, {
        file_key,
        operation: "upsert",
        content_revision: contentRevision,
        changed_at: now,
      });
    } catch {
      // A complete sync can recover from a temporarily unavailable change feed.
    }

    let githubPushed: boolean | undefined;
    let githubError: string | undefined;

    if (file_type === "wiki_page" && parsed.push_to_github !== false) {
      try {
        const ghResult = await pushToGitHub(env, file_key, content);
        githubPushed = ghResult.pushed;
        if (!ghResult.pushed) {
          githubError = ghResult.error;
        }
      } catch (err) {
        githubPushed = false;
        githubError =
          err instanceof Error ? err.message : "Unknown GitHub push error";
      }
    }

    return {
      file_key,
      chunk_count: chunks.length,
      status: githubPushed === false ? "partial" : "ok",
      ...(githubPushed !== undefined ? { github_pushed: githubPushed } : {}),
      ...(githubError ? { github_error: githubError } : {}),
    };
  } catch (err) {
    return jsonResponse(
      {
        error: {
          code: "INGESTION_FAILED",
          message:
            err instanceof Error
              ? err.message
              : "Unknown error during ingestion",
        },
      },
      500,
    );
  }
}

const EMBEDDING_BATCH_SIZE = 5;

async function generateEmbeddings(
  ai: Ai,
  chunks: Chunk[],
): Promise<number[][] | null> {
  try {
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const texts = batch.map((c) => c.content);
      let result = (await ai.run(EMBEDDING_MODEL, {
        text: texts,
      } as never)) as { data?: number[][] };

      if (!result.data) {
        for (const c of batch) {
          try {
            const single = (await ai.run(EMBEDDING_MODEL, {
              text: [c.content],
            } as never)) as { data?: number[][] };
            allEmbeddings.push(single.data?.[0] ?? new Array(768).fill(0));
          } catch {
            allEmbeddings.push(new Array(768).fill(0));
          }
        }
      } else {
        allEmbeddings.push(...result.data);
      }
    }
    return allEmbeddings;
  } catch {
    return null;
  }
}

export async function deleteFileCore(
  env: Env,
  fileKey: string,
  opts: { push_to_github?: boolean } = {},
): Promise<DeleteFileResult | Response> {
  try {
    const file = await env.DB.prepare(
      "SELECT file_key, r2_key, file_type FROM files WHERE file_key = ?",
    )
      .bind(fileKey)
      .first<{ file_key: string; r2_key: string; file_type: string }>();

    if (!file)
      return { file_key: fileKey, deleted: false, status: "not_found" };

    const chunks = await env.DB.prepare(
      "SELECT vector_id FROM chunks WHERE file_key = ? AND vector_id IS NOT NULL",
    )
      .bind(fileKey)
      .all<{ vector_id: string }>();

    const vectorIds = chunks.results.map((chunk) => chunk.vector_id);
    if (env.VECTORIZE && vectorIds.length > 0) {
      await deleteVectorsInBatches(env.VECTORIZE, vectorIds);
    }

    const deletedAt = new Date().toISOString();
    await env.RAW_BUCKET.delete(file.r2_key);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chunks WHERE file_key = ?").bind(fileKey),
      env.DB.prepare("DELETE FROM files WHERE file_key = ?").bind(fileKey),
    ]);
    try {
      await recordSiriChange(env, {
        file_key: fileKey,
        operation: "delete",
        content_revision: null,
        changed_at: deletedAt,
      });
    } catch {
      // A complete sync can recover from a temporarily unavailable change feed.
    }

    let githubDeleted: boolean | undefined;
    let githubError: string | undefined;

    if (file.file_type === "wiki_page" && opts.push_to_github !== false) {
      try {
        const ghResult = await deleteFromGitHub(env, fileKey);
        githubDeleted = ghResult.deleted;
        if (!ghResult.deleted) githubError = ghResult.error;
      } catch (err) {
        githubDeleted = false;
        githubError =
          err instanceof Error ? err.message : "Unknown GitHub delete error";
      }
    }

    return {
      file_key: fileKey,
      deleted: true,
      status: githubDeleted === false ? "partial" : "ok",
      ...(githubDeleted !== undefined ? { github_deleted: githubDeleted } : {}),
      ...(githubError ? { github_error: githubError } : {}),
    };
  } catch (err) {
    return jsonResponse(
      {
        error: {
          code: "DELETE_FAILED",
          message:
            err instanceof Error
              ? err.message
              : "Unknown error during deletion",
        },
      },
      500,
    );
  }
}

/**
 * Move/rename a wiki page: re-ingest its content under a new file_key (creating
 * it in GitHub + the index) then remove the old file_key (from GitHub + the
 * index). Pass `content` to also fix up the body (e.g. rewritten internal links)
 * as part of the move; otherwise the existing raw content is carried over as-is.
 */
export async function moveFileCore(
  env: Env,
  fromKey: string,
  toKey: string,
  content?: string,
): Promise<MoveFileResult | Response> {
  if (fromKey === toKey) {
    return jsonResponse(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "from_file_key and to_file_key must differ",
        },
      },
      400,
    );
  }

  const file = await env.DB.prepare(
    "SELECT file_key, r2_key, file_type, title, source FROM files WHERE file_key = ?",
  )
    .bind(fromKey)
    .first<{
      file_key: string;
      r2_key: string;
      file_type: string;
      title: string | null;
      source: string | null;
    }>();

  if (!file) {
    return jsonResponse(
      { error: { code: "NOT_FOUND", message: `File ${fromKey} not found` } },
      404,
    );
  }

  let body = content;
  if (body === undefined) {
    const r2Obj = await env.RAW_BUCKET.get(file.r2_key);
    if (!r2Obj) {
      return jsonResponse(
        {
          error: {
            code: "RAW_NOT_FOUND",
            message: `Raw content for ${fromKey} not found in R2`,
          },
        },
        404,
      );
    }
    body = await r2Obj.text();
  }

  const ingestResult = await ingestCore(env, {
    file_key: toKey,
    content: body,
    file_type: file.file_type as "wiki_page" | "ingested",
    title: file.title ?? undefined,
    source: file.source ?? undefined,
  });

  if (ingestResult instanceof Response) {
    const errBody = (await ingestResult.json()) as {
      error?: { message?: string };
    };
    return {
      from_file_key: fromKey,
      to_file_key: toKey,
      status: "ingest_failed",
      github_error: errBody.error?.message,
    };
  }

  // Never remove the canonical source if the destination was not saved there.
  if (ingestResult.github_pushed === false) {
    return {
      from_file_key: fromKey,
      to_file_key: toKey,
      status: "partial",
      chunk_count: ingestResult.chunk_count,
      github_pushed: false,
      github_error: ingestResult.github_error,
    };
  }

  const deleteResult = await deleteFileCore(env, fromKey);
  if (deleteResult instanceof Response) {
    const errBody = (await deleteResult.json()) as {
      error?: { message?: string };
    };
    return {
      from_file_key: fromKey,
      to_file_key: toKey,
      status: "moved_but_old_delete_failed",
      chunk_count: ingestResult.chunk_count,
      github_pushed: ingestResult.github_pushed,
      github_error: ingestResult.github_error ?? errBody.error?.message,
    };
  }

  return {
    from_file_key: fromKey,
    to_file_key: toKey,
    status: deleteResult.github_deleted === false ? "partial" : "ok",
    chunk_count: ingestResult.chunk_count,
    github_pushed: ingestResult.github_pushed,
    github_error: ingestResult.github_error,
    github_deleted: deleteResult.github_deleted,
    github_delete_error: deleteResult.github_error,
  };
}
