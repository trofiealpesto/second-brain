import type { Env } from "./types";

export interface SiriChange {
  file_key: string;
  operation: "upsert" | "delete";
  content_revision: string | null;
  changed_at: string;
}

/** Stable content version shared by the Worker and the macOS cache. */
export async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Keep a compact append-only sync feed. A failed feed write must not make an
 * otherwise successful ingest unavailable, so callers deliberately treat it
 * as best-effort; a fresh client can always request a full snapshot.
 */
export async function recordSiriChange(
  env: Env,
  change: SiriChange,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO siri_changes
      (file_key, operation, content_revision, changed_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      change.file_key,
      change.operation,
      change.content_revision,
      change.changed_at,
    )
    .run();
}
