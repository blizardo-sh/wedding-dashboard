import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { localRepository } from "../src/lib/repository.mjs";
let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
});
test("local notes survive refresh and source data remains separate", async () => {
  const repo = localRepository({ version: "a" });
  await repo.saveDecision("h1", { note: "Synthetic note" });
  const refreshed = localRepository({ version: "b" });
  let latest;
  refreshed.subscribeDecisions((v) => (latest = v));
  assert.equal(latest.h1.note, "Synthetic note");
  assert.equal((await refreshed.history("h1"))[0].after.note, "Synthetic note");
  assert.equal(refreshed.catalog.version, "b");
});
test("stale notes are rejected while unrelated updates remain intact", async () => {
  const repo = localRepository({});
  await repo.saveDecision("h1", { note: "One" });
  await repo.saveDecision("h1", { favorite: true });
  await repo.saveDecision("h1", { note: "Two" }, { expectedNote: "One" });
  await assert.rejects(
    repo.saveDecision("h1", { note: "Stale" }, { expectedNote: "One" }),
  );
  let latest;
  repo.subscribeDecisions((v) => (latest = v));
  assert.equal(latest.h1.favorite, true);
  assert.equal(latest.h1.note, "Two");
});
test("failed storage write cannot create a success or orphan history event", async () => {
  const repo = localRepository({});
  await repo.saveDecision("h1", { note: "Saved" });
  const previous = store.get("wedding:workspace:v2");
  localStorage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  await assert.rejects(repo.saveDecision("h1", { note: "Unsaved" }));
  assert.equal(store.get("wedding:workspace:v2"), previous);
  assert.equal((await repo.history("h1")).length, 1);
});

test("UI verification uses isolated decisions and never inherits real notes", async () => {
  const real = localRepository({});
  await real.saveDecision("h1", { note: "Real note" });
  const qa = localRepository({}, { qa: true });
  let values;
  qa.subscribeDecisions((v) => (values = v));
  assert.equal(values.h1, undefined);
  await qa.saveDecision("h1", { note: "Synthetic QA note" });
  real.subscribeDecisions((v) => (values = v));
  assert.equal(values.h1.note, "Real note");
});
