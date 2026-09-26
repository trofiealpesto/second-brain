/**
 * Tests for rahilp improvements #3 (temporal filter) and #4 (deprecated penalty).
 */
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { parseTemporalWindow } from "../src/retrieve";
import { extractDeprecatedFlag } from "../src/ingest";
import { ensureSchema } from "./setup";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------------
// Unit: parseTemporalWindow (rahilp #3)
// ---------------------------------------------------------------------------

describe("parseTemporalWindow", () => {
  it("returns null for queries with no temporal phrase", () => {
    expect(parseTemporalWindow("what is the llm wiki?")).toBeNull();
    expect(parseTemporalWindow("concepts about architecture")).toBeNull();
  });

  it("parses 'last N days'", () => {
    const cutoff = parseTemporalWindow("entries from last 7 days");
    expect(cutoff).not.toBeNull();
    // cutoff should be exactly 7 days ago (YYYY-MM-DD)
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    expect(cutoff).toBe(expected.toISOString().slice(0, 10));
  });

  it("parses 'last N weeks'", () => {
    const cutoff = parseTemporalWindow("notes from last 2 weeks");
    expect(cutoff).not.toBeNull();
    const expected = new Date();
    expected.setDate(expected.getDate() - 14);
    expect(cutoff).toBe(expected.toISOString().slice(0, 10));
  });

  it("parses 'last week'", () => {
    const cutoff = parseTemporalWindow("what did I write last week?");
    expect(cutoff).not.toBeNull();
    const expected = new Date();
    expected.setDate(expected.getDate() - 14);
    expect(cutoff).toBe(expected.toISOString().slice(0, 10));
  });

  it("parses 'yesterday'", () => {
    const cutoff = parseTemporalWindow("log entries from yesterday");
    expect(cutoff).not.toBeNull();
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    expect(cutoff).toBe(expected.toISOString().slice(0, 10));
  });

  it("parses 'this month'", () => {
    const cutoff = parseTemporalWindow("pages updated this month");
    expect(cutoff).not.toBeNull();
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 1);
    expect(cutoff).toBe(expected.toISOString().slice(0, 10));
  });

  it("parses 'past N months' (case-insensitive)", () => {
    const cutoff = parseTemporalWindow("changes from PAST 3 MONTHS");
    expect(cutoff).not.toBeNull();
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 3);
    expect(cutoff).toBe(expected.toISOString().slice(0, 10));
  });
});

// ---------------------------------------------------------------------------
// Unit: extractDeprecatedFlag (rahilp #4)
// ---------------------------------------------------------------------------

describe("extractDeprecatedFlag", () => {
  it("returns 0 for pages without deprecation markers", () => {
    const content = `---\ntitle: Active Page\nstatus: active\n---\n# Active\n\nContent.`;
    expect(extractDeprecatedFlag(content)).toBe(0);
  });

  it("returns 0 for pages with no frontmatter", () => {
    expect(extractDeprecatedFlag("# Just a page\n\nContent.")).toBe(0);
  });

  it("returns 1 for 'status: deprecated'", () => {
    const content = `---\ntitle: Old\nstatus: deprecated\n---\n# Old\n\nOutdated.`;
    expect(extractDeprecatedFlag(content)).toBe(1);
  });

  it("returns 1 for 'deprecated: true'", () => {
    const content = `---\ntitle: Old\ndeprecated: true\n---\n# Old\n\nOutdated.`;
    expect(extractDeprecatedFlag(content)).toBe(1);
  });

  it("is case-insensitive for status value", () => {
    const content = `---\ntitle: Old\nstatus: Deprecated\n---\n# Old`;
    expect(extractDeprecatedFlag(content)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: deprecated flag stored and reflected in D1 (rahilp #4)
// ---------------------------------------------------------------------------

describe("Ingest stores deprecated flag", () => {
  it("sets deprecated=0 for active pages", async () => {
    await ensureSchema();
    const content = `---\ntitle: Active\nstatus: active\n---\n# Active page\n\nThis page is actively maintained.`;
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "test/active-page.md",
        content,
        file_type: "wiki_page",
        push_to_github: false,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{ status: string }>();
    expect(data.status).toBe("ok");
  });

  it("sets deprecated=1 for deprecated pages", async () => {
    await ensureSchema();
    const content = `---\ntitle: Deprecated\nstatus: deprecated\n---\n# Old page\n\nThis page is no longer maintained.`;
    const response = await apiFetch("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_key: "test/deprecated-page.md",
        content,
        file_type: "wiki_page",
        push_to_github: false,
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json<{ status: string }>();
    expect(data.status).toBe("ok");
  });
});
