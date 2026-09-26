import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { wikiApiBase, wikiBranchRef, wikiRepository } from "../src/config";
import { isAllowedGitHubLogin } from "../src/auth";
import { deleteFileCore, ingestCore, moveFileCore } from "../src/ingest";
import { handleGitHubWebhook } from "../src/webhook";
import { handleScheduled } from "../src/cron";
import { ingestWithRetry } from "../src/setup";
import { readCore } from "../src/read";
import { SecondBrainMCP } from "../src/mcp";
import { handleSiriRequest } from "../src/siri";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ensureSchema } from "./setup";
import type { Env } from "../src/types";

const replica = { ...env, WIKI_REPO_OWNER: "another-owner", WIKI_REPO_NAME: "private-notes", WIKI_BRANCH: "notes/active" } as unknown as Env;
const base = "https://api.github.com/repos/another-owner/private-notes";
const page = (body: string) => `---\ntitle: Example\ntype: concept\ntags: [example]\ncreated: 2026-09-27\nupdated: 2026-09-27\nsources: []\nlinks: []\n---\n# Example\n${body}`;

async function signedPush(changes: { modified?: string[]; added?: string[]; removed?: string[] }) {
  const body = JSON.stringify({ ref: "refs/heads/notes/active", commits: [changes] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(replica.WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://replica.example/webhook/github", { method: "POST", headers: { "X-Hub-Signature-256": `sha256=${signature}` }, body });
}

beforeEach(async () => { await ensureSchema(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("independent instance configuration", () => {
  it("requires a vault and fails closed without an explicit login allowlist", () => {
    expect(() => wikiApiBase({} as Env)).toThrow("WIKI_REPO_OWNER");
    expect(isAllowedGitHubLogin("example-user", {} as Env)).toBe(false);
    expect(isAllowedGitHubLogin(" Alice ", { ALLOWED_GITHUB_LOGINS: "alice,BOB" } as Env)).toBe(true);
    expect(wikiApiBase(replica)).toBe(base);
    expect(wikiBranchRef(replica)).toBe("notes/active");
    expect(wikiRepository({ ...replica, WIKI_BRANCH: undefined }).branch).toBe("main");
  });

  it("does not create reminders without an alert destination", async () => {
    const fetcher = vi.fn();
    await handleScheduled({ ...replica, GITHUB_TOKEN_EXPIRY: new Date().toISOString() }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("GitHub write-back and partial failures", () => {
  it("reads and writes the configured branch, then deletes from that branch", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url.startsWith(`${base}/contents/`)).toBe(true);
      if (!init?.method) {
        expect(new URL(url).searchParams.get("ref")).toBe("notes/active");
        return Response.json({ sha: "previous-sha" });
      }
      expect(JSON.parse(String(init.body)).branch).toBe("notes/active");
      return Response.json({ content: { sha: "next-sha" } });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await ingestCore(replica, { file_key: "concepts/write.md", content: page("Written"), file_type: "wiki_page" })).toMatchObject({ status: "ok", github_pushed: true });
    expect(await deleteFileCore(replica, "concepts/write.md")).toMatchObject({ status: "ok", github_deleted: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("reports a partial save and preserves the source when a move cannot save its destination", async () => {
    await ingestCore(replica, { file_key: "concepts/original.md", content: page("Keep me"), file_type: "wiki_page", push_to_github: false });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response("GitHub unavailable", { status: init?.method ? 503 : 404 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await moveFileCore(replica, "concepts/original.md", "concepts/renamed.md");
    expect(result).toMatchObject({ status: "partial", github_pushed: false });
    expect(await readCore(replica, "concepts/original.md", 0, 10000)).toMatchObject({ content: page("Keep me") });
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== "DELETE")).toBe(true);
  });

  it("does not count a partial HTTP 200 as a successful bootstrap", async () => {
    const result = await ingestWithRetry(async () => ({ ok: true, status: 200, json: async () => ({ status: "partial", github_pushed: false, github_error: "GitHub denied write", chunk_count: 1 }) }), "https://replica.example/api/ingest", { file_key: "index.md", content: page("Index"), file_type: "wiki_page" }, 1);
    expect(result).toMatchObject({ success: false, error: "GitHub denied write" });
  });
});

describe("server-style pushes project into an isolated wiki", () => {
  it("syncs contract, page, index and log; updates, renames and deletes without writing back", async () => {
    const canonical = new Map([
      ["SCHEMA.md", page("The contract")],
      ["index.md", page("[[concepts/example]]")],
      ["log.md", page("Created example")],
      ["concepts/example.md", page("First version")],
    ]);
    const forbiddenWrite = vi.fn(async () => { throw new Error("Webhook must not write to GitHub"); });
    vi.stubGlobal("fetch", forbiddenWrite);
    const github = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(String(url).startsWith(`${base}/contents/`)).toBe(true);
      expect(parsed.searchParams.get("ref")).toBe("notes/active");
      const key = decodeURIComponent(parsed.pathname.split("/contents/")[1]);
      return Response.json({ content: Buffer.from(canonical.get(key)!).toString("base64"), encoding: "base64" });
    });
    const push = async (changes: Parameters<typeof signedPush>[0]) => {
      const response = await handleGitHubWebhook(await signedPush(changes), replica, github);
      expect(await response.json()).toMatchObject({ status: "ok", errors: [] });
    };
    await push({ added: [...canonical.keys()] });
    expect(await readCore(replica, "SCHEMA.md", 0, 10000)).toMatchObject({ content: canonical.get("SCHEMA.md") });
    canonical.set("concepts/example.md", page("Updated version"));
    canonical.set("SCHEMA.md", page("Updated contract"));
    await push({ modified: ["concepts/example.md", "SCHEMA.md"] });
    expect(await readCore(replica, "concepts/example.md", 0, 10000)).toMatchObject({ content: page("Updated version") });
    expect(await readCore(replica, "SCHEMA.md", 0, 10000)).toMatchObject({ content: page("Updated contract") });
    canonical.set("concepts/renamed.md", canonical.get("concepts/example.md")!);
    canonical.delete("concepts/example.md");
    await push({ added: ["concepts/renamed.md"], removed: ["concepts/example.md"] });
    expect(await readCore(replica, "concepts/renamed.md", 0, 10000)).toMatchObject({ content: page("Updated version") });
    await push({ removed: ["concepts/renamed.md"] });
    const removed = await readCore(replica, "concepts/renamed.md", 0, 10000);
    expect(removed).toBeInstanceOf(Response);
    expect((removed as Response).status).toBe(404);
    expect(forbiddenWrite).not.toHaveBeenCalled();
  });
});

describe("replica client interfaces", () => {
  it("lets an MCP SDK client read/update the contract and exposes partial saves as tool errors", async () => {
    const server = new McpServer({ name: "replica-test", version: "0.0.0" });
    // Register the production tool callbacks; transport and OAuth are deliberately isolated.
    await SecondBrainMCP.prototype.init.call({ server, env: replica, props: { login: "example-user" } } as unknown as SecondBrainMCP);
    const client = new Client({ name: "isolated-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(["delete", "grep", "ingest", "move", "read", "reindex", "retrieve"]);
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method
        ? Response.json({ content: { sha: "new-sha" } })
        : new Response(null, { status: 404 })));
      const write = (content: string) => client.callTool({ name: "ingest", arguments: { file_key: "SCHEMA.md", content: page(content), file_type: "wiki_page" } });
      expect(await write("Original contract")).toMatchObject({ isError: false });
      expect(await write("Updated contract")).toMatchObject({ isError: false });
      const read = await client.callTool({ name: "read", arguments: { file_key: "SCHEMA.md", max_chars: 10000 } });
      expect(JSON.stringify(read.content)).toContain("Updated contract");
      vi.stubGlobal("fetch", vi.fn(async () => new Response("GitHub unavailable", { status: 503 })));
      const partial = await write("Uncommitted contract");
      expect(partial.isError).toBe(true);
      expect(JSON.stringify(partial.content)).toContain("github_pushed: false");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("commits Siri capture and log together on the configured repository and branch", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url.startsWith(base)).toBe(true);
      const path = url.slice(base.length);
      if (path === "/git/ref/heads/notes/active") return Response.json({ object: { sha: "head-sha" } });
      if (path === "/git/commits/head-sha") return Response.json({ tree: { sha: "tree-sha" } });
      if (path.startsWith("/contents/")) {
        expect(new URL(url).searchParams.get("ref")).toBe("head-sha");
        return new Response(null, { status: 404 });
      }
      if (path === "/git/blobs") return Response.json({ sha: "blob-sha" });
      if (path === "/git/trees") {
        const body = JSON.parse(String(init?.body));
        expect(body.base_tree).toBe("tree-sha");
        expect(body.tree).toHaveLength(2);
        expect(body.tree.map((entry: { path: string }) => entry.path)).toContain("log.md");
        return Response.json({ sha: "new-tree-sha" });
      }
      if (path === "/git/commits") return Response.json({ sha: "commit-sha" });
      expect(path).toBe("/git/refs/heads/notes/active");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ sha: "commit-sha", force: false });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await handleSiriRequest(new Request("https://replica.example/v1/siri/captures", {
      method: "POST", body: JSON.stringify({ title: "Synthetic note", content: "Synthetic voice capture" }),
    }), replica, { login: "example-user" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ canonical_commit: "commit-sha", sync_pending: false });
    expect(fetcher).toHaveBeenCalledTimes(9);
  });
});
