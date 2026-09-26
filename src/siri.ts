import { deleteFileCore, ensureFrontmatter, ingestCore } from "./ingest";
import { jsonResponse } from "./http";
import { retrieveCore, validateRetrieveRequest } from "./retrieve";
import { sha256Hex } from "./siri-sync";
import type { Env, RetrieveResult } from "./types";
import { wikiApiBase, wikiBranchRef, wikiRepository } from "./config";

const MAX_PAGE_BYTES = 1_000_000;
const SYNC_PAGE_SIZE = 10;
const CHANGE_PAGE_SIZE = 50;

type Actor = { login: string };
type GitHubFile = { content: string; sha: string };
type FileRecord = {
  file_key: string;
  r2_key: string;
  title: string | null;
  updated_at: string;
  deprecated: number;
  content_revision: string | null;
};
type ChangeRecord = {
  sequence: number;
  file_key: string;
  operation: "upsert" | "delete";
  content_revision: string | null;
  changed_at: string;
};

/** Dispatches the authenticated Siri API. It never records a user's question. */
export async function handleSiriRequest(
  request: Request,
  env: Env,
  actor: Actor,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/v1/siri/sync") {
    return doSync(env, url.searchParams.get("cursor"));
  }
  if (request.method === "POST" && path === "/v1/siri/search") {
    return doSearch(request, env);
  }
  if (request.method === "POST" && path === "/v1/siri/captures") {
    return doCapture(request, env, actor);
  }

  const archivePrefix = "/v1/siri/pages/";
  if (!path.startsWith(archivePrefix)) return notFound();

  const archiveSuffix = "/archive";
  if (request.method === "POST" && path.endsWith(archiveSuffix)) {
    const fileKey = decodeFileKey(
      path.slice(archivePrefix.length, -archiveSuffix.length),
    );
    if (!fileKey) return invalid("Invalid file_key");
    return doArchive(request, env, actor, fileKey);
  }
  if (request.method === "PATCH") {
    const fileKey = decodeFileKey(path.slice(archivePrefix.length));
    if (!fileKey) return invalid("Invalid file_key");
    return doPageMutation(request, env, actor, fileKey);
  }
  return notFound();
}

async function doSync(env: Env, cursor: string | null): Promise<Response> {
  const parsedCursor = await parseSyncCursor(env, cursor);
  if (!parsedCursor) return invalid("Invalid sync cursor");

  if (parsedCursor.kind === "snapshot") {
    const rows = await env.DB.prepare(
      `SELECT file_key, r2_key, title, updated_at, deprecated, content_revision
       FROM files ORDER BY file_key LIMIT ? OFFSET ?`,
    )
      .bind(SYNC_PAGE_SIZE, parsedCursor.offset)
      .all<FileRecord>();
    const pages = await Promise.all(rows.results.map((row) => pagePayload(env, row)));
    const nextOffset = parsedCursor.offset + rows.results.length;
    const nextCursor =
      rows.results.length === SYNC_PAGE_SIZE
        ? `snapshot:${nextOffset}:${parsedCursor.watermark}`
        : `changes:${parsedCursor.watermark}`;

    return jsonResponse({
      mode: "snapshot",
      changes: pages,
      next_cursor: nextCursor,
    });
  }

  const rows = await env.DB.prepare(
    `SELECT sequence, file_key, operation, content_revision, changed_at
     FROM siri_changes WHERE sequence > ? ORDER BY sequence LIMIT ?`,
  )
    .bind(parsedCursor.sequence, CHANGE_PAGE_SIZE)
    .all<ChangeRecord>();
  const changes = await Promise.all(
    rows.results.map(async (change) => {
      if (change.operation === "delete") {
        return {
          file_key: change.file_key,
          deleted: true,
          revision: change.content_revision,
          changed_at: change.changed_at,
          sequence: change.sequence,
        };
      }
      const file = await env.DB.prepare(
        `SELECT file_key, r2_key, title, updated_at, deprecated, content_revision
         FROM files WHERE file_key = ?`,
      )
        .bind(change.file_key)
        .first<FileRecord>();
      if (!file) {
        return {
          file_key: change.file_key,
          deleted: true,
          revision: null,
          changed_at: change.changed_at,
          sequence: change.sequence,
        };
      }
      return { ...(await pagePayload(env, file)), sequence: change.sequence };
    }),
  );
  const lastSequence = rows.results.at(-1)?.sequence ?? parsedCursor.sequence;

  return jsonResponse({
    mode: "changes",
    changes,
    next_cursor: `changes:${lastSequence}`,
  });
}

async function parseSyncCursor(
  env: Env,
  cursor: string | null,
): Promise<
  | { kind: "snapshot"; offset: number; watermark: number }
  | { kind: "changes"; sequence: number }
  | null
> {
  if (!cursor) {
    const watermark = await env.DB.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM siri_changes",
    ).first<{ sequence: number }>();
    return { kind: "snapshot", offset: 0, watermark: watermark?.sequence ?? 0 };
  }
  const snapshot = /^snapshot:(\d+):(\d+)$/.exec(cursor);
  if (snapshot) {
    return {
      kind: "snapshot",
      offset: Number(snapshot[1]),
      watermark: Number(snapshot[2]),
    };
  }
  const changes = /^changes:(\d+)$/.exec(cursor);
  return changes ? { kind: "changes", sequence: Number(changes[1]) } : null;
}

async function pagePayload(env: Env, file: FileRecord) {
  const object = await env.RAW_BUCKET.get(file.r2_key);
  if (!object) {
    return {
      file_key: file.file_key,
      unavailable: true,
      revision: file.content_revision,
      archived: Boolean(file.deprecated),
      updated_at: file.updated_at,
    };
  }
  const content = await object.text();
  return {
    file_key: file.file_key,
    title: file.title,
    content,
    revision: file.content_revision ?? (await sha256Hex(content)),
    archived: Boolean(file.deprecated),
    updated_at: file.updated_at,
  };
}

async function doSearch(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("Invalid JSON body");
  }
  const parsed = validateRetrieveRequest(body);
  if (!parsed) return invalid("query (string) is required");

  const result = await retrieveCore(env, parsed, {
    persistMetrics: false,
    excludeDeprecated: true,
  });
  return jsonResponse({
    results: result.results.map(sourcePayload),
    total: result.results.length,
  });
}

function sourcePayload(result: RetrieveResult) {
  return {
    file_key: result.file_key,
    title: result.title,
    section: result.section,
    excerpt: result.content,
    score: result.score,
    wikilinks: result.wikilinks,
  };
}

async function doCapture(
  request: Request,
  env: Env,
  actor: Actor,
): Promise<Response> {
  const body = await jsonObject(request);
  if (!body) return invalid("Invalid JSON body");
  const content = asBoundedString(body.content, MAX_PAGE_BYTES);
  if (!content?.trim()) return invalid("content (string) is required");
  const title = asBoundedString(body.title, 200) ?? firstLine(content) ?? "Voice capture";
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const fileKey = `raw/voice/${day}/${slugify(title)}-${crypto.randomUUID()}.md`;
  const page = `---\ntitle: ${yamlString(title)}\ntype: raw\ntags: [voice-capture]\ncreated: ${day}\nupdated: ${day}\nsources: []\nlinks: []\n---\n\n# ${title}\n\n${content.trim()}\n`;

  const committed = await commitCanonicalChange(env, {
    action: "capture",
    actor,
    fileKey,
    nextContent: page,
  });
  if (committed instanceof Response) return committed;

  const projection = await projectUpsert(env, fileKey, page, title);
  return jsonResponse(
    {
      file_key: fileKey,
      revision: await sha256Hex(page),
      canonical_commit: committed,
      sync_pending: !projection,
    },
    projection ? 201 : 202,
  );
}

async function doPageMutation(
  request: Request,
  env: Env,
  actor: Actor,
  fileKey: string,
): Promise<Response> {
  if (isVoiceCapture(fileKey)) return immutableCapture();
  const expectedRevision = request.headers.get("If-Match");
  if (!expectedRevision) return invalid("If-Match revision is required");
  const body = await jsonObject(request);
  if (!body) return invalid("Invalid JSON body");
  const operation = body.operation;
  if (!isMutation(operation)) return invalid("Unsupported page operation");

  const current = await getCanonicalFile(env, fileKey);
  if (current instanceof Response) return current;
  if (!(await revisionMatches(expectedRevision, current.content))) return conflict();

  let nextContent = current.content;
  let targetKey = fileKey;
  if (operation === "append") {
    const addition = asBoundedString(body.content, MAX_PAGE_BYTES);
    if (!addition?.trim()) return invalid("content (string) is required for append");
    if (current.content.length + addition.length > MAX_PAGE_BYTES) {
      return invalid("Resulting page exceeds the maximum size");
    }
    nextContent = `${current.content.trimEnd()}\n\n${addition.trim()}\n`;
  } else if (operation === "replace") {
    const replacement = asBoundedString(body.content, MAX_PAGE_BYTES);
    if (!replacement?.trim()) return invalid("content (string) is required for replace");
    nextContent = replacement;
  } else if (operation === "rename") {
    const title = asBoundedString(body.title, 200);
    if (!title?.trim()) return invalid("title (string) is required for rename");
    nextContent = setFrontmatterField(current.content, "title", yamlString(title));
  } else {
    const destination = typeof body.destination === "string" ? decodeFileKey(body.destination) : null;
    if (!destination || isVoiceCapture(destination)) return invalid("Invalid destination");
    targetKey = destination;
  }
  nextContent = touchUpdated(ensureFrontmatter(nextContent, targetKey));

  const committed = await commitCanonicalChange(env, {
    action: operation,
    actor,
    fileKey,
    nextContent,
    targetKey,
    expectedRevision,
  });
  if (committed instanceof Response) return committed;

  const title = frontmatterValue(nextContent, "title") ?? null;
  const projection = await projectUpsert(env, targetKey, nextContent, title);
  const deletionProjection =
    targetKey === fileKey ? true : await projectDelete(env, fileKey);
  const revision = await sha256Hex(nextContent);
  return jsonResponse(
    {
      file_key: targetKey,
      previous_file_key: targetKey === fileKey ? undefined : fileKey,
      revision,
      canonical_commit: committed,
      sync_pending: !projection || !deletionProjection,
    },
    projection && deletionProjection ? 200 : 202,
  );
}

async function doArchive(
  request: Request,
  env: Env,
  actor: Actor,
  fileKey: string,
): Promise<Response> {
  if (isVoiceCapture(fileKey)) return immutableCapture();
  const expectedRevision = request.headers.get("If-Match");
  if (!expectedRevision) return invalid("If-Match revision is required");
  const current = await getCanonicalFile(env, fileKey);
  if (current instanceof Response) return current;
  if (!(await revisionMatches(expectedRevision, current.content))) return conflict();

  const nextContent = touchUpdated(
    setFrontmatterField(ensureFrontmatter(current.content, fileKey), "status", "deprecated"),
  );
  const committed = await commitCanonicalChange(env, {
    action: "archive",
    actor,
    fileKey,
    nextContent,
    expectedRevision,
  });
  if (committed instanceof Response) return committed;
  const projected = await projectUpsert(
    env,
    fileKey,
    nextContent,
    frontmatterValue(nextContent, "title") ?? null,
  );
  return jsonResponse(
    {
      file_key: fileKey,
      revision: await sha256Hex(nextContent),
      archived: true,
      canonical_commit: committed,
      sync_pending: !projected,
    },
    projected ? 200 : 202,
  );
}

async function projectUpsert(
  env: Env,
  fileKey: string,
  content: string,
  title: string | null,
  enqueueRetry = true,
): Promise<boolean> {
  try {
    const result = await ingestCore(env, {
      file_key: fileKey,
      content,
      file_type: "wiki_page",
      title: title ?? undefined,
      push_to_github: false,
    });
    const projected = !(result instanceof Response);
    if (projected) await clearProjectionRetry(env, fileKey);
    else if (enqueueRetry) await enqueueProjectionRetry(env, fileKey, "upsert");
    return projected;
  } catch {
    if (enqueueRetry) await enqueueProjectionRetry(env, fileKey, "upsert");
    return false;
  }
}

async function projectDelete(
  env: Env,
  fileKey: string,
  enqueueRetry = true,
): Promise<boolean> {
  try {
    const result = await deleteFileCore(env, fileKey, { push_to_github: false });
    const projected = !(result instanceof Response);
    if (projected) await clearProjectionRetry(env, fileKey);
    else if (enqueueRetry) await enqueueProjectionRetry(env, fileKey, "delete");
    return projected;
  } catch {
    if (enqueueRetry) await enqueueProjectionRetry(env, fileKey, "delete");
    return false;
  }
}

/** Replays only GitHub-canonical changes that could not be indexed previously. */
export async function retrySiriProjections(env: Env): Promise<void> {
  const tasks = await env.DB.prepare(
    "SELECT file_key, operation FROM siri_projection_retries ORDER BY queued_at LIMIT 20",
  ).all<{ file_key: string; operation: "upsert" | "delete" }>();

  for (const task of tasks.results) {
    if (task.operation === "delete") {
      await projectDelete(env, task.file_key, false);
      continue;
    }
    const page = await getCanonicalFile(env, task.file_key);
    if (page instanceof Response) {
      if (page.status === 404) await projectDelete(env, task.file_key, false);
      continue;
    }
    await projectUpsert(
      env,
      task.file_key,
      page.content,
      frontmatterValue(page.content, "title"),
      false,
    );
  }
}

async function enqueueProjectionRetry(
  env: Env,
  fileKey: string,
  operation: "upsert" | "delete",
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO siri_projection_retries (file_key, operation, queued_at)
       VALUES (?, ?, ?)
       ON CONFLICT(file_key) DO UPDATE SET operation = excluded.operation, queued_at = excluded.queued_at`,
    ).bind(fileKey, operation, new Date().toISOString()).run();
  } catch {
    // The webhook remains an independent reconciliation path during migration.
  }
}

async function clearProjectionRetry(env: Env, fileKey: string): Promise<void> {
  try {
    await env.DB.prepare("DELETE FROM siri_projection_retries WHERE file_key = ?")
      .bind(fileKey)
      .run();
  } catch {
    // A stale queue row is harmless; the next retry simply verifies the projection.
  }
}

type CanonicalChange = {
  action: string;
  actor: Actor;
  fileKey: string;
  targetKey?: string;
  nextContent: string;
  expectedRevision?: string;
};

/**
 * Writes the page and log.md in one Git commit. Projection into Cloudflare
 * happens only after the branch reference has advanced successfully.
 */
async function commitCanonicalChange(
  env: Env,
  change: CanonicalChange,
): Promise<string | Response> {
  if (!env.GITHUB_TOKEN) return serviceUnavailable("GitHub writer is not configured");
  const head = await getBranchHead(env);
  if (head instanceof Response) return head;
  const source = await getCanonicalFile(env, change.fileKey, head.sha);
  if (source instanceof Response && change.action !== "capture") return source;
  if (
    !(source instanceof Response) &&
    change.expectedRevision &&
    !(await revisionMatches(change.expectedRevision, source.content))
  ) {
    return conflict();
  }
  const log = await getCanonicalFile(env, "log.md", head.sha);
  if (log instanceof Response && log.status !== 404) return log;

  const targetKey = change.targetKey ?? change.fileKey;
  const nextLog = appendLog(
    log instanceof Response ? "# Second Brain log\n" : log.content,
    change.action,
    targetKey,
    change.actor.login,
  );

  try {
    const [pageBlob, logBlob] = await Promise.all([
      createBlob(env, change.nextContent),
      createBlob(env, nextLog),
    ]);
    const entries: Array<Record<string, unknown>> = [
      { path: targetKey, mode: "100644", type: "blob", sha: pageBlob },
      { path: "log.md", mode: "100644", type: "blob", sha: logBlob },
    ];
    if (targetKey !== change.fileKey) {
      entries.push({ path: change.fileKey, mode: "100644", type: "blob", sha: null });
    }
    const tree = await githubJson<{ sha: string }>(env, "/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: head.tree, tree: entries }),
    });
    const commit = await githubJson<{ sha: string }>(env, "/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: `siri: ${change.action} ${targetKey} [skip ci]`,
        tree: tree.sha,
        parents: [head.sha],
      }),
    });
    const updated = await githubResponse(env, `/git/refs/heads/${wikiBranchRef(env)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (!updated.ok) {
      return conflict("The page changed before it could be committed");
    }
    return commit.sha;
  } catch {
    return serviceUnavailable("Could not commit the canonical GitHub change");
  }
}

async function getBranchHead(
  env: Env,
): Promise<{ sha: string; tree: string } | Response> {
  try {
    const ref = await githubJson<{ object: { sha: string } }>(
      env,
      `/git/ref/heads/${wikiBranchRef(env)}`,
    );
    const commit = await githubJson<{ tree: { sha: string } }>(
      env,
      `/git/commits/${ref.object.sha}`,
    );
    return { sha: ref.object.sha, tree: commit.tree.sha };
  } catch {
    return serviceUnavailable("Could not read the canonical GitHub branch");
  }
}

async function getCanonicalFile(
  env: Env,
  fileKey: string,
  ref = wikiRepository(env).branch,
): Promise<GitHubFile | Response> {
  const encodedPath = fileKey.split("/").map(encodeURIComponent).join("/");
  const response = await githubResponse(
    env,
    `/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  );
  if (response.status === 404) return notFound("Canonical page not found");
  if (!response.ok) return serviceUnavailable("Could not read the canonical GitHub page");
  const data = (await response.json()) as { content?: string; sha?: string; encoding?: string };
  if (!data.content || !data.sha || data.encoding !== "base64") {
    return serviceUnavailable("Canonical GitHub content was invalid");
  }
  return {
    content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8"),
    sha: data.sha,
  };
}

async function createBlob(env: Env, content: string): Promise<string> {
  const blob = await githubJson<{ sha: string }>(env, "/git/blobs", {
    method: "POST",
    body: JSON.stringify({
      content: Buffer.from(content, "utf-8").toString("base64"),
      encoding: "base64",
    }),
  });
  return blob.sha;
}

function githubResponse(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${wikiApiBase(env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "second-brain-worker",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function githubJson<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await githubResponse(env, path, init);
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return (await response.json()) as T;
}

function appendLog(log: string, action: string, fileKey: string, actor: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `${log.trimEnd()}\n- ${day} — Siri ${action} by ${actor}: [[${fileKey}]]\n`;
}

function decodeFileKey(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/^\/+/, "");
  if (
    !normalized.endsWith(".md") ||
    normalized.length > 500 ||
    normalized.includes("\\") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

function isVoiceCapture(fileKey: string) {
  return fileKey.startsWith("raw/voice/");
}

function isMutation(value: unknown): value is "append" | "replace" | "rename" | "move" {
  return value === "append" || value === "replace" || value === "rename" || value === "move";
}

function asBoundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

async function jsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function setFrontmatterField(content: string, field: string, value: string): string {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    return setFrontmatterField(ensureFrontmatter(content, "untitled.md"), field, value);
  }
  const expression = new RegExp(`^${field}:.*$`, "m");
  const next = expression.test(frontmatter[1])
    ? frontmatter[1].replace(expression, `${field}: ${value}`)
    : `${frontmatter[1]}\n${field}: ${value}`;
  return content.replace(frontmatter[0], `---\n${next}\n---`);
}

function touchUpdated(content: string) {
  return setFrontmatterField(content, "updated", new Date().toISOString().slice(0, 10));
}

function frontmatterValue(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^${field}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function yamlString(value: string) {
  return JSON.stringify(value.replace(/[\r\n]+/g, " ").trim());
}

function firstLine(value: string) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? null;
}

function slugify(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "voice-capture";
}

async function revisionMatches(header: string, content: string) {
  const expected = header.replace(/^W\//, "").replace(/^"|"$/g, "");
  return expected === (await sha256Hex(content));
}

function invalid(message: string) {
  return jsonResponse({ error: { code: "VALIDATION_ERROR", message } }, 400);
}

function conflict(message = "The page revision no longer matches") {
  return jsonResponse({ error: { code: "REVISION_CONFLICT", message } }, 409);
}

function immutableCapture() {
  return jsonResponse(
    { error: { code: "IMMUTABLE_CAPTURE", message: "Voice captures cannot be edited, moved, or archived" } },
    422,
  );
}

function notFound(message = "Route not found") {
  return jsonResponse({ error: { code: "NOT_FOUND", message } }, 404);
}

function serviceUnavailable(message: string) {
  return jsonResponse({ error: { code: "CANONICAL_WRITE_UNAVAILABLE", message } }, 503);
}
