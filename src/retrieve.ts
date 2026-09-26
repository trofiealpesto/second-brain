import { jsonResponse } from "./http";
import type {
  Env,
  RetrieveFilter,
  RetrieveRequest,
  RetrieveResult,
  RetrieveMetrics,
  RetrieveResponse,
} from "./types";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_CONTENT_LENGTH = 2000;
const DEFAULT_LIMIT = 10;
const TOP_K = 20;
const SEMANTIC_WEIGHT = 0.5;
const KEYWORD_WEIGHT = 0.5;

// Recency boost constants (rahilp improvement #2).
// Adds up to RECENCY_BOOST_MAX to a result's combined_score for a page edited
// today, decaying with a half-life of RECENCY_HALF_LIFE_DAYS (ln2 / half-life decay).
// Fresh edits surface slightly higher without drowning out relevance signals.
const RECENCY_HALF_LIFE_DAYS = 90;
const RECENCY_BOOST_MAX = 0.15;

// Score penalty applied to pages with `status: deprecated` or `deprecated: true`
// in their frontmatter (rahilp improvement #4). Enough to sink them below active
// pages while still keeping them in results if nothing else matches.
const DEPRECATED_PENALTY = 0.3;

/**
 * Parse a relative time window from a natural-language query (rahilp improvement #3).
 * Returns an ISO 8601 date string (YYYY-MM-DD) representing the earliest allowed
 * `updated_at` value, or null if no temporal phrase is found.
 *
 * Recognised patterns (case-insensitive, evaluated relative to "now"):
 *   "last N days"    "last N weeks"   "last N months"
 *   "yesterday"      "this week"      "this month"
 *   "last week"      "last month"     "past N days/weeks/months"
 *
 * Best-effort: no match → null (no filter applied, same as before).
 */
export function parseTemporalWindow(query: string): string | null {
  const q = query.toLowerCase();
  const now = new Date();

  // "last N days/weeks/months" or "past N days/weeks/months"
  const nMatch = q.match(/(?:last|past)\s+(\d+)\s+(day|week|month)s?/);
  if (nMatch) {
    const n = parseInt(nMatch[1], 10);
    const unit = nMatch[2];
    const cutoff = new Date(now);
    if (unit === "day") cutoff.setDate(cutoff.getDate() - n);
    else if (unit === "week") cutoff.setDate(cutoff.getDate() - n * 7);
    else if (unit === "month") cutoff.setMonth(cutoff.getMonth() - n);
    return cutoff.toISOString().slice(0, 10);
  }
  // "yesterday"
  if (/\byesterday\b/.test(q)) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 1);
    return cutoff.toISOString().slice(0, 10);
  }
  // "this week"
  if (/\bthis\s+week\b/.test(q)) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 7);
    return cutoff.toISOString().slice(0, 10);
  }
  // "last week"
  if (/\blast\s+week\b/.test(q)) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 14);
    return cutoff.toISOString().slice(0, 10);
  }
  // "this month"
  if (/\bthis\s+month\b/.test(q)) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 1);
    return cutoff.toISOString().slice(0, 10);
  }
  // "last month"
  if (/\blast\s+month\b/.test(q)) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 2);
    return cutoff.toISOString().slice(0, 10);
  }
  return null;
}

interface SemanticHit {
  file_key: string;
  chunk_index: number;
  score: number;
}

interface KeywordHit {
  id: number;
  file_key: string;
  chunk_index: number;
  score: number;
}

interface MergedHit {
  file_key: string;
  chunk_index: number;
  semantic_score: number;
  keyword_score: number;
  combined_score: number;
  search_type: "semantic" | "keyword" | "hybrid";
}

export function validateRetrieveRequest(body: unknown): RetrieveRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.query !== "string" || b.query.trim().length === 0) return null;

  let filter: RetrieveFilter | undefined;
  if (b.filter !== undefined && b.filter !== null) {
    if (typeof b.filter !== "object") return null;
    const f = b.filter as Record<string, unknown>;
    filter = {};
    if (f.file_type !== undefined) {
      if (f.file_type !== "wiki_page" && f.file_type !== "ingested")
        return null;
      filter.file_type = f.file_type;
    }
    if (f.section_prefix !== undefined) {
      if (typeof f.section_prefix !== "string") return null;
      filter.section_prefix = f.section_prefix;
    }
    if (f.file_key_prefix !== undefined) {
      if (typeof f.file_key_prefix !== "string") return null;
      filter.file_key_prefix = f.file_key_prefix;
    }
  }

  let limit = DEFAULT_LIMIT;
  if (b.limit !== undefined) {
    if (typeof b.limit !== "number" || b.limit < 1 || !Number.isFinite(b.limit))
      return null;
    limit = Math.floor(b.limit);
  }

  return { query: b.query, limit, filter };
}

export async function doRetrieve(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      400,
    );
  }

  const parsed = validateRetrieveRequest(body);
  if (!parsed) {
    return jsonResponse(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Missing or invalid fields: query (non-empty string), limit? (positive integer), filter? (object)",
        },
      },
      400,
    );
  }

  try {
    const results = await retrieveCore(env, parsed);
    return jsonResponse(results);
  } catch (err) {
    return jsonResponse(
      {
        error: {
          code: "RETRIEVE_FAILED",
          message:
            err instanceof Error
              ? err.message
              : "Unknown error during retrieval",
        },
      },
      500,
    );
  }
}

export async function retrieveCore(
  env: Env,
  parsed: RetrieveRequest,
  options: { persistMetrics?: boolean; excludeDeprecated?: boolean } = {},
): Promise<RetrieveResponse> {
  const { query, limit, filter } = parsed;
  const startTime = Date.now();

  // Temporal filter (rahilp improvement #3): extract date cutoff from query phrasing.
  const cutoff = parseTemporalWindow(query);

  const [semanticHits, keywordHits] = await Promise.all([
    semanticSearch(env, query, filter),
    keywordSearch(env, query, filter, cutoff),
  ]);

  const merged = mergeHits(semanticHits, keywordHits);
  merged.sort((a, b) => b.combined_score - a.combined_score);
  const limited = merged.slice(0, limit);

  let results = await enrichWithMetadata(env, limited, cutoff);
  if (options.excludeDeprecated) {
    results = results.filter((result) => !result.deprecated);
  }
  const latency_ms = Date.now() - startTime;

  const scores = results.map((r) => r.score);
  const search_type_counts = {
    semantic: results.filter((r) => r.search_type === "semantic").length,
    keyword: results.filter((r) => r.search_type === "keyword").length,
    hybrid: results.filter((r) => r.search_type === "hybrid").length,
  };

  const metrics: RetrieveMetrics = {
    latency_ms,
    result_count: results.length,
    total_candidates: merged.length,
    zero_results: results.length === 0,
    score_min: scores.length > 0 ? Math.min(...scores) : null,
    score_max: scores.length > 0 ? Math.max(...scores) : null,
    score_mean:
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null,
    search_type_counts,
    semantic_hits: semanticHits.length,
    keyword_hits: keywordHits.length,
  };

  if (options.persistMetrics !== false) {
    try {
      await persistRetrieveMetrics(env, query, metrics);
    } catch {
      // Metrics persistence is best-effort; don't fail the retrieve.
    }
  }

  return { query, results, total: merged.length, metrics };
}

async function semanticSearch(
  env: Env,
  query: string,
  filter?: RetrieveFilter,
): Promise<SemanticHit[]> {
  if (!env.AI || !env.VECTORIZE) return [];

  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, {
      text: [query],
    } as never)) as { data?: number[][] };
    const queryVector = result.data?.[0];
    if (!queryVector) return [];

    const vectorResults = await env.VECTORIZE.query(queryVector, {
      topK: TOP_K,
      returnMetadata: true,
    });

    let hits: SemanticHit[] = (vectorResults.matches ?? []).map((m) => ({
      file_key: m.metadata?.file_key as string,
      chunk_index: m.metadata?.chunk_index as number,
      score: m.score,
    }));

    if (filter) {
      hits = applySemanticFilters(hits, filter);
    }

    return hits;
  } catch {
    return [];
  }
}

function applySemanticFilters(
  hits: SemanticHit[],
  filter: RetrieveFilter,
): SemanticHit[] {
  return hits.filter((h) => {
    if (
      filter.file_key_prefix &&
      !h.file_key.startsWith(filter.file_key_prefix)
    ) {
      return false;
    }
    return true;
  });
}

function buildFtsQuery(query: string): string {
  const terms = query
    .replace(/["*+\-:()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return "";
  return terms.join(" OR ");
}

async function keywordSearch(
  env: Env,
  query: string,
  filter?: RetrieveFilter,
  cutoff?: string | null,
): Promise<KeywordHit[]> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  let sql =
    "SELECT c.id, c.file_key, c.chunk_index, chunks_fts.rank as rank " +
    "FROM chunks_fts " +
    "JOIN chunks c ON c.id = chunks_fts.rowid " +
    "JOIN files f ON f.file_key = c.file_key " +
    "WHERE chunks_fts MATCH ?";

  const params: (string | number)[] = [ftsQuery];

  if (filter?.file_type) {
    sql += " AND f.file_type = ?";
    params.push(filter.file_type);
  }
  if (filter?.section_prefix) {
    sql += " AND c.section LIKE ? || '%'";
    params.push(filter.section_prefix);
  }
  if (filter?.file_key_prefix) {
    sql += " AND c.file_key LIKE ? || '%'";
    params.push(filter.file_key_prefix);
  }
  // Temporal filter: only return chunks from files updated on or after cutoff.
  if (cutoff) {
    sql += " AND f.updated_at >= ?";
    params.push(cutoff);
  }

  sql += " ORDER BY chunks_fts.rank LIMIT ?";
  params.push(TOP_K);

  try {
    const result = await env.DB.prepare(sql)
      .bind(...params)
      .all<{
        id: number;
        file_key: string;
        chunk_index: number;
        rank: number;
      }>();

    if (!result.results || result.results.length === 0) return [];

    const ranks = result.results.map((r) => r.rank);
    const minRank = Math.min(...ranks);
    const maxRank = Math.max(...ranks);

    return result.results.map((r) => ({
      id: r.id,
      file_key: r.file_key,
      chunk_index: r.chunk_index,
      score:
        maxRank === minRank ? 1.0 : (maxRank - r.rank) / (maxRank - minRank),
    }));
  } catch {
    return [];
  }
}

function mergeHits(
  semantic: SemanticHit[],
  keyword: KeywordHit[],
): MergedHit[] {
  const map = new Map<string, MergedHit>();

  for (const s of semantic) {
    const key = `${s.file_key}:${s.chunk_index}`;
    map.set(key, {
      file_key: s.file_key,
      chunk_index: s.chunk_index,
      semantic_score: s.score,
      keyword_score: 0,
      combined_score: SEMANTIC_WEIGHT * s.score,
      search_type: "semantic",
    });
  }

  for (const k of keyword) {
    const key = `${k.file_key}:${k.chunk_index}`;
    const existing = map.get(key);
    if (existing) {
      existing.keyword_score = k.score;
      existing.combined_score =
        SEMANTIC_WEIGHT * existing.semantic_score + KEYWORD_WEIGHT * k.score;
      existing.search_type = "hybrid";
    } else {
      map.set(key, {
        file_key: k.file_key,
        chunk_index: k.chunk_index,
        semantic_score: 0,
        keyword_score: k.score,
        combined_score: KEYWORD_WEIGHT * k.score,
        search_type: "keyword",
      });
    }
  }

  return [...map.values()];
}

async function enrichWithMetadata(
  env: Env,
  hits: MergedHit[],
  cutoff?: string | null,
): Promise<RetrieveResult[]> {
  if (hits.length === 0) return [];

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  for (const h of hits) {
    conditions.push("(c.file_key = ? AND c.chunk_index = ?)");
    params.push(h.file_key, h.chunk_index);
  }

  const sql =
    // Include f.updated_at (recency boost, rahilp #2) and f.deprecated (rahilp #4).
    "SELECT c.file_key, c.chunk_index, c.content, c.section, c.wikilinks, f.title, f.updated_at, f.deprecated " +
    "FROM chunks c " +
    "JOIN files f ON f.file_key = c.file_key " +
    "WHERE " +
    conditions.join(" OR ");

  const result = await env.DB.prepare(sql)
    .bind(...params)
    .all<{
      file_key: string;
      chunk_index: number;
      content: string;
      section: string | null;
      wikilinks: string | null;
      title: string | null;
      updated_at: string | null;
      deprecated: number;
    }>();

  const metaMap = new Map<
    string,
    {
      content: string;
      section: string | null;
      wikilinks: string | null;
      title: string | null;
      updated_at: string | null;
      deprecated: number;
    }
  >();

  for (const row of result.results) {
    metaMap.set(`${row.file_key}:${row.chunk_index}`, {
      content: row.content,
      section: row.section,
      wikilinks: row.wikilinks,
      title: row.title,
      updated_at: row.updated_at,
      deprecated: row.deprecated ?? 0,
    });
  }

  const nowMs = Date.now();
  const enriched: RetrieveResult[] = [];
  for (const h of hits) {
    const meta = metaMap.get(`${h.file_key}:${h.chunk_index}`);
    if (!meta) continue;

    // Temporal filter (rahilp #3): for semantic hits the cutoff wasn't applied in SQL,
    // so post-filter here using the updated_at we already fetched.
    if (cutoff && h.search_type !== "keyword") {
      if (!meta.updated_at || meta.updated_at.slice(0, 10) < cutoff) continue;
    }

    let wikilinks: string[] = [];
    if (meta.wikilinks) {
      try {
        wikilinks = JSON.parse(meta.wikilinks);
      } catch {
        wikilinks = [];
      }
    }

    // Recency boost: add up to RECENCY_BOOST_MAX for a page edited today,
    // decaying with half-life RECENCY_HALF_LIFE_DAYS. This surfaces freshly
    // edited pages without completely overriding semantic/keyword relevance.
    let score = h.combined_score;
    if (meta.updated_at) {
      const ageDays = (nowMs - new Date(meta.updated_at).getTime()) / 86400000;
      const decayFactor = Math.exp((-ageDays * Math.LN2) / RECENCY_HALF_LIFE_DAYS);
      score += RECENCY_BOOST_MAX * decayFactor;
    }

    // Deprecated penalty (rahilp #4): subtract a fixed amount so deprecated pages
    // sink to the bottom without being excluded entirely.
    if (meta.deprecated) {
      score -= DEPRECATED_PENALTY;
    }

    enriched.push({
      file_key: h.file_key,
      title: meta.title,
      chunk_index: h.chunk_index,
      section: meta.section,
      content: meta.content.slice(0, MAX_CONTENT_LENGTH),
      wikilinks,
      score,
      search_type: h.search_type,
      deprecated: Boolean(meta.deprecated),
    });
  }

  return enriched;
}

async function persistRetrieveMetrics(
  env: Env,
  query: string,
  metrics: RetrieveMetrics,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO retrieve_metrics
      (query, latency_ms, result_count, total_candidates, zero_results,
       score_min, score_max, score_mean, semantic_hits, keyword_hits,
       semantic_returned, keyword_returned, hybrid_returned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      query.slice(0, 500),
      metrics.latency_ms,
      metrics.result_count,
      metrics.total_candidates,
      metrics.zero_results ? 1 : 0,
      metrics.score_min,
      metrics.score_max,
      metrics.score_mean,
      metrics.semantic_hits,
      metrics.keyword_hits,
      metrics.search_type_counts.semantic,
      metrics.search_type_counts.keyword,
      metrics.search_type_counts.hybrid,
    )
    .run();
}
