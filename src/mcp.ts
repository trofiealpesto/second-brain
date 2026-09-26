import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, IngestRequest, RetrieveRequest } from "./types";
import { retrieveCore } from "./retrieve";
import {
  ingestCore,
  validateIngestRequest,
  deleteFileCore,
  moveFileCore,
} from "./ingest";
import { readCore } from "./read";
import { grepCore } from "./grep";
import type { Props } from "./oauth-utils";
import { isAllowedGitHubLogin } from "./auth";

export class SecondBrainMCP extends McpAgent<
  Env,
  Record<string, never>,
  Props
> {
  server = new McpServer({
    name: "Second Brain",
    version: "1.0.0",
  });

  async init() {
    if (!this.props || !isAllowedGitHubLogin(this.props.login, this.env)) {
      return;
    }

    this.server.tool(
      "retrieve",
      "Search the Second Brain knowledge base using hybrid retrieval (semantic + keyword). Returns relevant chunks from indexed wiki pages and files.",
      {
        query: z
          .string()
          .describe("The search query — natural language or keywords."),
        limit: z
          .number()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of results to return."),
        file_type: z
          .enum(["wiki_page", "ingested"])
          .optional()
          .describe("Filter results by file type."),
        section_prefix: z
          .string()
          .optional()
          .describe("Filter results to sections starting with this prefix."),
        file_key_prefix: z
          .string()
          .optional()
          .describe("Filter results to file keys starting with this prefix."),
      },
      async (params) => {
        const retrieveReq: RetrieveRequest = {
          query: params.query,
          limit: params.limit,
          filter: {
            file_type: params.file_type,
            section_prefix: params.section_prefix,
            file_key_prefix: params.file_key_prefix,
          },
        };

        const result = await retrieveCore(this.env, retrieveReq);

        const formatted = result.results
          .map((r, i) => {
            const lines = [
              `## Result ${i + 1} (score: ${r.score.toFixed(3)}, type: ${r.search_type})`,
              `**File:** ${r.file_key}`,
              r.title ? `**Title:** ${r.title}` : "",
              r.section ? `**Section:** ${r.section}` : "",
              "",
              r.content,
            ].filter(Boolean);
            return lines.join("\n");
          })
          .join("\n\n---\n\n");

        return {
          content: [
            {
              type: "text",
              text:
                formatted ||
                `No results found for query "${params.query}". Total matches: ${result.total}`,
            },
          ],
        };
      },
    );

    this.server.tool(
      "ingest",
      "Ingest a file into the Second Brain knowledge base. The file content is chunked, embedded, and stored in R2, D1, and Vectorize.",
      {
        file_key: z
          .string()
          .describe(
            "Unique identifier for the file. For wiki pages: repo-root-relative path (e.g. 'concepts/foo.md', 'entities/bar.md', 'index.md'). For external files: 'filename:uuid'.",
          ),
        content: z
          .string()
          .describe("The full text content of the file to ingest."),
        file_type: z
          .enum(["wiki_page", "ingested"])
          .describe("The type of file being ingested."),
        title: z.string().optional().describe("Optional title for the file."),
        source: z
          .string()
          .optional()
          .describe("Optional source URL or path for the file."),
        push_to_github: z
          .boolean()
          .default(true)
          .describe(
            "If true (default) and file_type is 'wiki_page', also creates/updates the file in the GitHub wiki repository. Set to false to skip GitHub write-back.",
          ),
      },
      async (params) => {
        const ingestReq: IngestRequest = {
          file_key: params.file_key,
          content: params.content,
          file_type: params.file_type,
          title: params.title,
          source: params.source,
          push_to_github: params.push_to_github,
        };

        const validated = validateIngestRequest(ingestReq);
        if (!validated) {
          return {
            content: [
              {
                type: "text",
                text: "Validation error: file_key, content, and file_type are required.",
              },
            ],
            isError: true,
          };
        }

        const result = await ingestCore(this.env, validated);

        if (result instanceof Response) {
          const body = await result.json();
          return {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: true,
          };
        }

        return {
          isError: result.status !== "ok",
          content: [
            {
              type: "text",
              text: `Ingest ${result.file_key}: ${result.chunk_count} chunks, status: ${result.status}${result.github_pushed !== undefined ? `, github_pushed: ${result.github_pushed}` : ""}${result.github_error ? `, github_error: ${result.github_error}` : ""}`,
            },
          ],
        };
      },
    );

    this.server.tool(
      "reindex",
      "Re-index a specific file or all files in the Second Brain. Reads raw content from R2 and re-runs chunking + embedding.",
      {
        file_key: z
          .string()
          .optional()
          .describe(
            "The file key to reindex. If omitted, all files are reindexed.",
          ),
      },
      async (params) => {
        if (params.file_key) {
          const file = await this.env.DB.prepare(
            "SELECT file_key, file_type, r2_key FROM files WHERE file_key = ?",
          )
            .bind(params.file_key)
            .first<{ file_key: string; file_type: string; r2_key: string }>();

          if (!file) {
            return {
              content: [
                {
                  type: "text",
                  text: `File ${params.file_key} not found.`,
                },
              ],
              isError: true,
            };
          }

          const r2Obj = await this.env.RAW_BUCKET.get(file.r2_key);
          if (!r2Obj) {
            return {
              content: [
                {
                  type: "text",
                  text: `Raw content for ${params.file_key} not found in R2.`,
                },
              ],
              isError: true,
            };
          }

          const content = await r2Obj.text();
          const result = await ingestCore(this.env, {
            file_key: file.file_key,
            content,
            file_type: file.file_type as "wiki_page" | "ingested",
            push_to_github: false,
          });

          if (result instanceof Response) {
            const body = await result.json();
            return {
              content: [{ type: "text", text: JSON.stringify(body) }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Reindexed ${params.file_key}: ${result.chunk_count} chunks`,
              },
            ],
          };
        }

        const files = await this.env.DB.prepare(
          "SELECT file_key, file_type, r2_key FROM files",
        ).all<{ file_key: string; file_type: string; r2_key: string }>();

        let count = 0;
        for (const file of files.results) {
          const r2Obj = await this.env.RAW_BUCKET.get(file.r2_key);
          if (!r2Obj) continue;
          const content = await r2Obj.text();
          const result = await ingestCore(this.env, {
            file_key: file.file_key,
            content,
            file_type: file.file_type as "wiki_page" | "ingested",
            push_to_github: false,
          });
          if (!(result instanceof Response)) count++;
        }

        return {
          content: [
            {
              type: "text",
              text: `Reindexed ${count} file(s).`,
            },
          ],
        };
      },
    );

    this.server.tool(
      "read",
      "Read the raw text of an indexed file from R2 storage. Returns the text content with optional offset and character limit. Useful for reading the full context around a chunk found via retrieve.",
      {
        file_key: z
          .string()
          .describe("The file key of the indexed file to read."),
        offset: z
          .number()
          .min(0)
          .optional()
          .describe("Character offset to start reading from. Defaults to 0."),
        max_chars: z
          .number()
          .min(1)
          .max(10000)
          .optional()
          .describe(
            "Maximum number of characters to return. Defaults to 2000, max 10000.",
          ),
      },
      async (params) => {
        const result = await readCore(
          this.env,
          params.file_key,
          params.offset ?? 0,
          params.max_chars ?? 2000,
        );

        if (result instanceof Response) {
          const body = await result.json();
          return {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: true,
          };
        }

        const lines = [
          `**File:** ${result.file_key}`,
          `**Offset:** ${result.offset}`,
          `**Total length:** ${result.total_length} chars`,
          `**Truncated:** ${result.truncated}`,
          "",
          result.content,
        ];

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      },
    );

    this.server.tool(
      "move",
      "Move/rename a wiki page to a new file_key (e.g. relocate 'example.md' to 'entities/example.md'). Re-ingests the content under the new key (creating it in GitHub + the index) then removes the old key (from GitHub + the index). Pass `content` to also rewrite the body (e.g. fixed internal links) as part of the move.",
      {
        from_file_key: z
          .string()
          .describe("Existing file_key to move/rename."),
        to_file_key: z.string().describe("New file_key to move it to."),
        content: z
          .string()
          .optional()
          .describe(
            "Optional replacement content (e.g. with internal links rewritten for the new path). If omitted, the existing content is carried over unchanged.",
          ),
      },
      async (params) => {
        const result = await moveFileCore(
          this.env,
          params.from_file_key,
          params.to_file_key,
          params.content,
        );

        if (result instanceof Response) {
          const body = await result.json();
          return {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: true,
          };
        }

        return {
          isError: result.status !== "ok",
          content: [
            {
              type: "text",
              text: `Moved ${result.from_file_key} -> ${result.to_file_key}: status ${result.status}${result.chunk_count !== undefined ? `, ${result.chunk_count} chunks` : ""}${result.github_pushed !== undefined ? `, github_pushed: ${result.github_pushed}` : ""}${result.github_deleted !== undefined ? `, old_github_deleted: ${result.github_deleted}` : ""}${result.github_error ? `, github_error: ${result.github_error}` : ""}${result.github_delete_error ? `, github_delete_error: ${result.github_delete_error}` : ""}`,
            },
          ],
        };
      },
    );

    this.server.tool(
      "delete",
      "Delete a file from the Second Brain knowledge base (R2 + D1 + Vectorize), and for wiki pages also remove it from the GitHub wiki repository.",
      {
        file_key: z.string().describe("The file_key to delete."),
        push_to_github: z
          .boolean()
          .default(true)
          .describe(
            "If true (default) and the file is a wiki_page, also removes it from the GitHub wiki repository. Set to false to only remove it from the index.",
          ),
      },
      async (params) => {
        const result = await deleteFileCore(this.env, params.file_key, {
          push_to_github: params.push_to_github,
        });

        if (result instanceof Response) {
          const body = await result.json();
          return {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: true,
          };
        }

        return {
          isError: result.status !== "ok" && result.status !== "not_found",
          content: [
            {
              type: "text",
              text: `Delete ${result.file_key}: status ${result.status}${result.github_deleted !== undefined ? `, github_deleted: ${result.github_deleted}` : ""}${result.github_error ? `, github_error: ${result.github_error}` : ""}`,
            },
          ],
        };
      },
    );

    this.server.tool(
      "grep",
      "Search for a regex pattern in the raw text of an indexed file. Returns matches with optional surrounding context. Useful for extracting structured data (dates, amounts, IDs) from documents.",
      {
        file_key: z
          .string()
          .describe("The file key of the indexed file to search."),
        pattern: z.string().describe("JavaScript regex pattern to search for."),
        max_matches: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Maximum number of matches to return. Defaults to 10, max 50.",
          ),
        context: z
          .number()
          .min(0)
          .max(200)
          .optional()
          .describe(
            "Number of characters of context around each match. Defaults to 40, max 200.",
          ),
      },
      async (params) => {
        const result = await grepCore(
          this.env,
          params.file_key,
          params.pattern,
          params.max_matches ?? 10,
          params.context ?? 40,
        );

        if (result instanceof Response) {
          const body = await result.json();
          return {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: true,
          };
        }

        if (result.matches.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No matches found for pattern "${params.pattern}" in ${params.file_key}.`,
              },
            ],
          };
        }

        const formatted = result.matches
          .map((m, i) => {
            const lines = [
              `### Match ${i + 1}`,
              `**Match:** \`${m.match}\``,
              `**Position:** ${m.start}-${m.end}`,
              m.context ? `**Context:** ...${m.context.text}...` : "",
            ].filter(Boolean);
            return lines.join("\n");
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${result.total} match(es) in ${params.file_key}:\n\n${formatted}`,
            },
          ],
        };
      },
    );
  }
}
