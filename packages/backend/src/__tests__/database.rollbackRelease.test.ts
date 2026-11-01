import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { withPoolTransaction } from "../database/connection.js";

interface FakeClientRecord {
  readonly queries: string[];
  readonly releases: unknown[];
}

function fakePool(record: FakeClientRecord, rollbackFails: boolean): Pool {
  const client = {
    query: (text: string) => {
      record.queries.push(text);
      return text === "ROLLBACK" && rollbackFails ? Promise.reject(new Error("rollback lost the connection")) : Promise.resolve({ rows: [] });
    },
    release: (error?: unknown) => {
      record.releases.push(error);
    },
  };
  return { connect: () => Promise.resolve(client) } as unknown as Pool;
}

describe("B11 a client whose ROLLBACK failed is destroyed, not returned to the pool", () => {
  it("rethrows the work error and releases the client with the ROLLBACK error", async () => {
    const record: FakeClientRecord = { queries: [], releases: [] };
    const workError = new RangeError("work failed");

    const failure = await withPoolTransaction(fakePool(record, true), () => Promise.reject(workError)).catch((error: unknown) => error);

    expect(failure).toBe(workError);
    expect(record.queries).toEqual(["BEGIN", "ROLLBACK"]);
    expect(record.releases).toHaveLength(1);
    expect(record.releases[0]).toBeInstanceOf(Error);
  });

  it("returns a healthy client to the pool after a clean ROLLBACK", async () => {
    const record: FakeClientRecord = { queries: [], releases: [] };

    await withPoolTransaction(fakePool(record, false), () => Promise.reject(new RangeError("work failed"))).catch(() => undefined);

    expect(record.releases).toEqual([undefined]);
  });
});
