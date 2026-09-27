import { describe, it, expect } from "vitest";
import { chunkVectorId, deleteVectorsInBatches } from "../src/ingest";

/**
 * Vectorize rejects deleteByIds payloads larger than 100 ids with
 * "VECTOR_DELETE_ERROR (code = 40007): too many ids in payload".
 * Pages that had accumulated more chunks than that became impossible to
 * re-ingest, reindex or delete, so the delete must be batched.
 */
function fakeVectorize() {
  const payloads: string[][] = [];
  return {
    payloads,
    binding: {
      deleteByIds: async (ids: string[]) => {
        if (ids.length > 100) {
          throw new Error(
            `VECTOR_DELETE_ERROR (code = 40007): too many ids in payload; max id count is 100, got ${ids.length}`,
          );
        }
        payloads.push(ids);
        return { count: ids.length, ids };
      },
    },
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `chunk:${i}`);

describe("Vectorize ID compatibility", () => {
  it("preserves existing IDs up to the 64-byte boundary", async () => {
    expect(await chunkVectorId("index.md", 0)).toBe("index.md:0");
    expect(await chunkVectorId("a".repeat(62), 0)).toBe("a".repeat(62) + ":0");
  });

  it("bounds Siri voice paths with stable distinct IDs for each chunk", async () => {
    const path = "raw/voice/2026-09-27/synthetic-voice-note-12345678-1234-1234-1234-123456789abc.md";
    const first = await chunkVectorId(path, 0);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await chunkVectorId(path, 0)).toBe(first);
    expect(await chunkVectorId(path, 1)).not.toBe(first);
    expect(await chunkVectorId(path + ".md", 0)).not.toBe(first);
  });

  it("measures UTF-8 bytes rather than character count", async () => {
    const path = "é".repeat(32);
    expect(await chunkVectorId(path, 0)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("deleteVectorsInBatches", () => {
  it("splits payloads over the 100-id limit", async () => {
    const { payloads, binding } = fakeVectorize();
    await deleteVectorsInBatches(binding as never, ids(132));
    expect(payloads.map((p) => p.length)).toEqual([100, 32]);
  });

  it("deletes every id exactly once, in order", async () => {
    const { payloads, binding } = fakeVectorize();
    const input = ids(250);
    await deleteVectorsInBatches(binding as never, input);
    expect(payloads.flat()).toEqual(input);
  });

  it("sends a single call when at or below the limit", async () => {
    const { payloads, binding } = fakeVectorize();
    await deleteVectorsInBatches(binding as never, ids(100));
    expect(payloads).toHaveLength(1);
  });

  it("makes no call for an empty list", async () => {
    const { payloads, binding } = fakeVectorize();
    await deleteVectorsInBatches(binding as never, []);
    expect(payloads).toHaveLength(0);
  });
});
