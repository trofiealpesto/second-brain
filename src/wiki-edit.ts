import { wikiApiBase, wikiBranchRef, wikiRepository } from "./config";
import { frontmatterValue, projectUpsert } from "./siri";
import type { Env } from "./types";

/**
 * Small, server-side edits to wiki pages, so agents never have to read a whole
 * page and send it back through `ingest` (which replaces the file). Every write
 * starts from the latest copy on GitHub and is pushed with that copy's SHA: if
 * someone else wrote in between, GitHub answers 409 and the edit is re-applied
 * to the newer copy instead of overwriting it.
 */

const LOG_FILE_KEY = "log.md";
const MAX_ATTEMPTS = 3;
const MAX_LOG_ENTRY_CHARS = 4000;

type FetchFunction = typeof fetch;

export type EditFailure = {
  ok: false;
  code: "NOT_FOUND" | "NO_MATCH" | "AMBIGUOUS" | "INVALID" | "CONFLICT" | "GITHUB_ERROR";
  message: string;
};

export type EditSuccess = {
  ok: true;
  file_key: string;
  /** GitHub has the change but the search index does not yet; the five-minute cron retries it. */
  index_pending: boolean;
};

/** Insert `entry` above the newest log entry, i.e. right after the page's intro. */
export function insertLogEntry(log: string, entry: string): string {
  const block = `${entry.trim()}\n\n`;
  const fmEnd = log.match(/^---\n[\s\S]*?\n---\n/)?.[0].length ?? 0;
  const body = log.slice(fmEnd);
  const firstEntry = body.search(/^(## \[\d{4}-\d{2}-\d{2}|- \d{4}-\d{2}-\d{2})/m);
  if (firstEntry === -1) {
    return `${log.replace(/\s*$/, "")}\n\n${block}`;
  }
  const at = fmEnd + firstEntry;
  return log.slice(0, at) + block + log.slice(at);
}

/** Set `updated:` in the frontmatter to `today`, when the page has one. */
export function bumpUpdated(content: string, today: string): string {
  const fm = content.match(/^---\n[\s\S]*?\n---/);
  if (!fm || !/^updated:/m.test(fm[0])) return content;
  const patched = fm[0].replace(/^updated:.*$/m, `updated: ${today}`);
  return patched + content.slice(fm[0].length);
}

/** Replace the single occurrence of `oldText`; refuse when it is missing or repeated. */
export function replaceOnce(
  content: string,
  oldText: string,
  newText: string,
): { ok: true; content: string } | EditFailure {
  if (!oldText) {
    return { ok: false, code: "INVALID", message: "old_text must not be empty" };
  }
  const first = content.indexOf(oldText);
  if (first === -1) {
    return {
      ok: false,
      code: "NO_MATCH",
      message: "old_text was not found in the current page: read or grep the page again and copy the text exactly",
    };
  }
  if (content.indexOf(oldText, first + oldText.length) !== -1) {
    const count = content.split(oldText).length - 1;
    return {
      ok: false,
      code: "AMBIGUOUS",
      message: `old_text appears ${count} times: include more surrounding text so it matches once`,
    };
  }
  return {
    ok: true,
    content: content.slice(0, first) + newText + content.slice(first + oldText.length),
  };
}

function githubHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "second-brain-worker",
  };
}

function contentsUrl(env: Env, fileKey: string): string {
  const encodedPath = fileKey.split("/").map(encodeURIComponent).join("/");
  return `${wikiApiBase(env)}/contents/${encodedPath}`;
}

async function readFromGitHub(
  env: Env,
  fileKey: string,
  fetchFn: FetchFunction,
): Promise<{ content: string; sha: string } | EditFailure> {
  const response = await fetchFn(
    `${contentsUrl(env, fileKey)}?ref=${wikiBranchRef(env)}`,
    { headers: githubHeaders(env) },
  );
  if (response.status === 404) {
    return { ok: false, code: "NOT_FOUND", message: `${fileKey} does not exist in the wiki` };
  }
  if (!response.ok) {
    return { ok: false, code: "GITHUB_ERROR", message: `GitHub read ${response.status}` };
  }
  const data = (await response.json()) as { content?: string; encoding?: string; sha?: string };
  if (data.encoding !== "base64" || data.content === undefined || !data.sha) {
    return { ok: false, code: "GITHUB_ERROR", message: `${fileKey} is too large to edit through the API` };
  }
  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

async function writeToGitHub(
  env: Env,
  fileKey: string,
  content: string,
  sha: string,
  message: string,
  fetchFn: FetchFunction,
): Promise<"ok" | "conflict" | EditFailure> {
  const response = await fetchFn(contentsUrl(env, fileKey), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch: wikiRepository(env).branch,
      sha,
    }),
  });
  if (response.ok) return "ok";
  // 409: the branch moved since we read the file. 422 is what GitHub sends when the SHA no longer matches.
  if (response.status === 409 || response.status === 422) return "conflict";
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 200);
  } catch {
    // ignore
  }
  return { ok: false, code: "GITHUB_ERROR", message: `GitHub write ${response.status} ${detail}`.trim() };
}

/**
 * Read the latest copy, apply `transform`, push it with the copy's SHA, and retry on a
 * concurrent write. Then refresh the search index from the exact text that was pushed.
 */
async function updateWikiFile(
  env: Env,
  fileKey: string,
  transform: (content: string) => { ok: true; content: string } | EditFailure,
  commitMessage: string,
  fetchFn: FetchFunction,
): Promise<EditSuccess | EditFailure> {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, code: "GITHUB_ERROR", message: "GITHUB_TOKEN not configured" };
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await readFromGitHub(env, fileKey, fetchFn);
    if ("ok" in current) return current;
    const next = transform(current.content);
    if (!next.ok) return next;
    const written = await writeToGitHub(env, fileKey, next.content, current.sha, commitMessage, fetchFn);
    if (written === "conflict") continue;
    if (written !== "ok") return written;

    // The push webhook skips Worker commits, so index here; a failure is queued for the cron replay.
    const projected = await projectUpsert(
      env,
      fileKey,
      next.content,
      frontmatterValue(next.content, "title"),
    );
    return { ok: true, file_key: fileKey, index_pending: !projected };
  }
  return {
    ok: false,
    code: "CONFLICT",
    message: `${fileKey} kept changing while it was being written; try again`,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function appendLogCore(
  env: Env,
  entry: string,
  fetchFn: FetchFunction = fetch,
): Promise<EditSuccess | EditFailure> {
  const text = entry.trim();
  if (!text) return { ok: false, code: "INVALID", message: "entry must not be empty" };
  if (text.length > MAX_LOG_ENTRY_CHARS) {
    return { ok: false, code: "INVALID", message: `entry is longer than ${MAX_LOG_ENTRY_CHARS} characters` };
  }
  if (/^---$/m.test(text)) {
    return { ok: false, code: "INVALID", message: "entry must not contain a --- line" };
  }
  return updateWikiFile(
    env,
    LOG_FILE_KEY,
    (log) => ({ ok: true, content: bumpUpdated(insertLogEntry(log, text), today()) }),
    "chore: append log.md entry via Second Brain Worker [skip ci]",
    fetchFn,
  );
}

export async function editPageCore(
  env: Env,
  input: { file_key: string; old_text: string; new_text: string },
  fetchFn: FetchFunction = fetch,
): Promise<EditSuccess | EditFailure> {
  const fileKey = input.file_key.trim();
  if (!fileKey.endsWith(".md") || fileKey.startsWith("wiki/") || fileKey.startsWith("/") || fileKey.includes("..")) {
    return {
      ok: false,
      code: "INVALID",
      message: "file_key must be a repo-relative .md path without a wiki/ prefix, e.g. entities/foo.md",
    };
  }
  if (fileKey === LOG_FILE_KEY) {
    return { ok: false, code: "INVALID", message: "use append_log to add to log.md" };
  }
  return updateWikiFile(
    env,
    fileKey,
    (content) => {
      const replaced = replaceOnce(content, input.old_text, input.new_text);
      return replaced.ok ? { ok: true, content: bumpUpdated(replaced.content, today()) } : replaced;
    },
    `chore: edit ${fileKey} via Second Brain Worker [skip ci]`,
    fetchFn,
  );
}
