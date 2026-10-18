import { test } from "node:test";
import assert from "node:assert/strict";
import { importGroups } from "../src/domain/import-plan.mjs";
test("a large initial catalogue is split below request limits without dropping records", () => {
  const rows = Array.from({ length: 26 }, (_, i) => [
    "chunk-" + i,
    { items: "x".repeat(650000) },
  ]);
  const groups = importGroups(rows);
  assert.equal(groups.flat().length, 26);
  assert(groups.every((group) => group.length <= 4));
  assert.deepEqual(
    groups.flat().map((r) => r[0]),
    rows.map((r) => r[0]),
  );
});
test("document count is bounded even when documents are small", () => {
  const groups = importGroups(
    Array.from({ length: 2477 }, (_, i) => ["listing-" + i, { id: i }]),
  );
  assert.equal(groups.flat().length, 2477);
  assert(groups.every((g) => g.length <= 100));
});
