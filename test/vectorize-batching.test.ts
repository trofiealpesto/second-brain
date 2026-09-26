import { describe, it, expect } from "vitest";
import { deleteVectorsInBatches } from "../src/ingest";

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
